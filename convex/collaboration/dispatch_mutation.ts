import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { createAdvisorBatchForTurn } from "../advisors/batch_creation";
import {
  createAssistantMessagesAndJobs,
  mapParticipantsForGeneration,
  type SendParticipantConfig,
} from "../chat/mutation_send_helpers";
import { enqueueRunGeneration } from "../chat/run_generation_queue";
import {
  collaborationExecutionRef,
  type CollaborationParticipantSnapshot,
} from "./validators";
import { assertExchangeExecution } from "./lifecycle_mutations";
import { assertCollaborationDecisionDeadline } from "../runtime_host/decision_deadline";
import { resolveChatParticipantConfigs } from "../chat/participant_resolution";
import { eligibleWork, freezeWorkContext } from "./work_context";
import { selectedWork } from "./work_selection";
import { claimWorkForJob } from "./work_claims";

export function projectCollaborationParticipant(
  participant: CollaborationParticipantSnapshot,
): SendParticipantConfig {
  const isPersona = participant.personaId !== undefined;
  return {
    participantKey: String(participant.participantId),
    modelId: participant.modelId,
    personaId: participant.personaId,
    personaName: isPersona ? participant.displayName : undefined,
    personaEmoji: isPersona ? participant.personaEmoji : undefined,
    personaAvatarImageUrl: isPersona
      ? participant.personaAvatarImageUrl
      : undefined,
    temperature: participant.temperature,
    maxTokens: participant.maxTokens,
    includeReasoning: participant.includeReasoning,
    reasoningEffort: participant.reasoningEffort,
  };
}

async function attachAdvisorBatch(
  ctx: Parameters<typeof createAdvisorBatchForTurn>[0],
  batchId: Id<"advisorBatches">,
  messageIds: Id<"messages">[],
): Promise<void> {
  for (const messageId of messageIds) {
    await ctx.db.patch(messageId, { advisorBatchId: batchId });
  }
}

export const dispatchDecision = internalMutation({
  args: {
    exchangeId: v.id("collaborationExchanges"),
    decisionId: v.id("collaborationDecisions"),
    execution: collaborationExecutionRef,
  },
  handler: async (ctx, args) => {
    const exchange = await assertExchangeExecution(ctx, args.exchangeId, args.execution);
    const decision = await ctx.db.get(args.decisionId);
    if (!decision || decision.exchangeId !== exchange._id) {
      throw new Error("COLLABORATION_DECISION_NOT_FOUND");
    }
    if (decision.status === "dispatched" || decision.status === "settled") {
      return {
        assistantMessageIds: decision.assistantMessageIds ?? [],
        generationJobIds: decision.generationJobIds ?? [],
      };
    }
    assertCollaborationDecisionDeadline(exchange.bounds.deadlineAt);
    if (
      decision.status !== "selected" ||
      exchange.status !== "dispatching" ||
      exchange.currentWave !== decision.wave
    ) {
      throw new Error("COLLABORATION_STALE_DISPATCH");
    }
    const currentWork = exchange.workEnabled ? await eligibleWork(ctx, exchange.chatId, exchange.workIds) : null;
    const selectedGoals = new Set<string>();
    const selections = decision.selections.filter(selection => {
      if (!currentWork) return true;
      const work = selectedWork(currentWork.candidates, selection);
      if (!selection.workId && !["owned_work", "review_work"].includes(selection.reasonCode)) return true;
      if (!work || selectedGoals.has(String(work._id))) return false;
      selectedGoals.add(String(work._id)); return true;
    });
    if (selections.length !== decision.selections.length) {
      await ctx.db.patch(decision._id, { selections, updatedAt: Date.now() });
    }
    if (selections.length === 0 && exchange.workEnabled) {
      await ctx.db.patch(decision._id, { status: "settled", generationJobIds: [], assistantMessageIds: [], settledAt: Date.now() });
      await ctx.db.patch(exchange._id, { status: "queued", updatedAt: Date.now() });
      return { assistantMessageIds: [], generationJobIds: [] };
    }
    const snapshotById = new Map(exchange.participantSnapshot.map((participant) => [
      String(participant.participantId),
      participant,
    ]));
    const requestedParticipants: SendParticipantConfig[] = selections.map((selection) => {
      const participant = snapshotById.get(String(selection.participantId));
      if (!participant) throw new Error("COLLABORATION_PARTICIPANT_NOT_FOUND");
      return projectCollaborationParticipant(participant);
    });
    const participants = await resolveChatParticipantConfigs(ctx, {
      userId: exchange.userId, chatId: exchange.chatId, participants: requestedParticipants,
    });
    const frontierMessages = (await Promise.all(
      decision.frontierMessageIds.map((messageId) => ctx.db.get(messageId)),
    )).filter((message) => message !== null);
    const sourceUserMessage = [...frontierMessages]
      .reverse()
      .find((message) => message.role === "user");
    const userMessageId = sourceUserMessage?._id ?? exchange.initiatingMessageId;
    const now = Date.now();
    const setup = await createAssistantMessagesAndJobs(ctx, {
      chatId: exchange.chatId,
      userId: exchange.userId,
      participants,
      parentMessageIds: decision.frontierMessageIds,
      assistantCreatedAt: now,
      jobCreatedAt: now,
      enabledIntegrations: exchange.generationSnapshot.enabledIntegrations,
      subagentsEnabled: exchange.generationSnapshot.subagentsEnabled,
      turnSkillOverrides: exchange.generationSnapshot.turnSkillOverrides,
      turnIntegrationOverrides: exchange.generationSnapshot.turnIntegrationOverrides,
      retryContract: exchange.generationSnapshot.retryContract,
      analytics: exchange.generationSnapshot.analytics,
      analyticsSource: exchange.generationSnapshot.videoConfig
        ? "video_generation"
        : undefined,
      parentRunId: args.execution.runId,
      collaboration: {
        exchangeId: exchange._id,
        decisionId: decision._id,
        wave: decision.wave,
        participants: selections.map((selection) => ({
          chatParticipantId: selection.participantId,
          replyToMessageIds: selection.replyToMessageIds,
        })),
      },
    });
    if (exchange.workEnabled) {
      const { candidates } = await eligibleWork(ctx, exchange.chatId, exchange.workIds);
      for (let index = 0; index < selections.length; index += 1) {
        const selection = selections[index];
        const work = selectedWork(candidates, selection);
        if (!work) continue; // Ordinary discussion remains available alongside goals.
        const job = await ctx.db.get(setup.generationJobIds[index]);
        if (!job) throw new Error("COLLABORATION_WORK_JOB_MISSING");
        const context = await freezeWorkContext(ctx, work, work.status === "review" ? "reviewer" : "owner");
        await claimWorkForJob(ctx, work, job, exchange.bounds.deadlineAt);
        await ctx.db.patch(setup.assistantMessageIds[index], { collaborationWorkContext: context,
          collaborationReadOnlyReview: work.status === "review" && work.readOnlyReview === true });
      }
    }
    const generationArgs = {
      chatId: exchange.chatId,
      userMessageId,
      assistantMessageIds: setup.assistantMessageIds,
      generationJobIds: setup.generationJobIds,
      participants: mapParticipantsForGeneration(
        participants,
        setup.assistantMessageIds,
        setup.generationJobIds,
        setup.streamingMessageIds,
      ),
      userId: exchange.userId,
      expandMultiModelGroups: exchange.generationSnapshot.expandMultiModelGroups,
      webSearchEnabled: exchange.generationSnapshot.webSearchEnabled,
      enabledIntegrations: exchange.generationSnapshot.enabledIntegrations,
      subagentsEnabled: exchange.generationSnapshot.subagentsEnabled,
      videoConfig: exchange.generationSnapshot.videoConfig,
      imageConfig: exchange.generationSnapshot.imageConfig,
      turnSkillOverrides: exchange.generationSnapshot.turnSkillOverrides,
      turnIntegrationOverrides: exchange.generationSnapshot.turnIntegrationOverrides,
      analytics: exchange.generationSnapshot.analytics,
      enqueuedAt: now,
    };
    const chat = await ctx.db.get(exchange.chatId);
    if (!chat) throw new Error("COLLABORATION_CHAT_NOT_FOUND");
    const existingAdvisorBatch = await ctx.db
      .query("advisorBatches")
      .withIndex("by_user_message", (query) =>
        query.eq("userMessageId", userMessageId)
      )
      .first();
    if (existingAdvisorBatch) {
      await attachAdvisorBatch(
        ctx,
        existingAdvisorBatch._id,
        setup.assistantMessageIds,
      );
      await enqueueRunGeneration(ctx, generationArgs);
    } else {
      const advisorBatchId = await createAdvisorBatchForTurn(ctx, {
        userId: exchange.userId,
        chat,
        userMessageId,
        assistantMessageIds: setup.assistantMessageIds,
        participants,
        selections: exchange.generationSnapshot.advisorSelections,
        brief: exchange.generationSnapshot.advisorBrief,
        enabledIntegrations: exchange.generationSnapshot.enabledIntegrations,
        turnIntegrationOverrides:
          exchange.generationSnapshot.turnIntegrationOverrides,
        generationSnapshot: { kind: "generation", args: generationArgs },
        parentRunId: args.execution.runId,
      });
      if (!advisorBatchId) await enqueueRunGeneration(ctx, generationArgs);
    }
    if (setup.assistantMessageIds[0]) {
      await ctx.db.patch(chat._id, {
        activeBranchLeafId: setup.assistantMessageIds[0],
        activeBranchLeafFocusOrder: undefined,
        messageCount: (chat.messageCount ?? 0) + setup.assistantMessageIds.length,
        updatedAt: now,
        lastMessageDate: now,
      });
    }
    await ctx.db.patch(decision._id, {
      status: "dispatched",
      assistantMessageIds: setup.assistantMessageIds,
      generationJobIds: setup.generationJobIds,
      updatedAt: now,
    });
    await ctx.db.patch(exchange._id, {
      status: "waiting",
      updatedAt: now,
    });
    return {
      assistantMessageIds: setup.assistantMessageIds,
      generationJobIds: setup.generationJobIds,
    };
  },
});
