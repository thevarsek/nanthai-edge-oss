import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";
import { assertCurrentExecution } from "../execution/attempts";
import { resolveEffectiveParticipantRoute } from "../runtime_host/route_resolution";
import { createAssistantMessagesAndJobs, mapParticipantsForGeneration } from "../chat/mutation_send_helpers";
import { linkExecutionComponent } from "../execution/component_refs";
import { getDecisionContextHandler } from "./decision_context";
import { runCycleArgs } from "./actions_args";
import type { GenerationParticipantWorkflowArgs } from "../chat/workflow_contract";

export const participantIds = internalQuery({
  args: { sessionId: v.id("autonomousSessions") },
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return [];
    const participants = await ctx.db.query("chatParticipants").withIndex("by_chat", q => q.eq("chatId", session.chatId)).collect();
    const byId = new Map(participants.filter(participant => participant.userId === session.userId).map(participant => [String(participant._id), participant._id]));
    return session.turnOrder.flatMap(id => { const participantId = byId.get(id); return participantId ? [participantId] : []; });
  },
});

export const route = internalQuery({
  args: { sessionId: v.id("autonomousSessions"), participantIndex: v.number() },
  returns: v.union(v.literal("local"), v.literal("cloud")),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) return "cloud";
    const id = ctx.db.normalizeId("chatParticipants", session.turnOrder[args.participantIndex] ?? "");
    if (!id) return "cloud"; // Retained legacy cloud session labels are not route IDs.
    const participant = await ctx.db.get(id);
    if (participant?.chatId !== session.chatId) return "cloud";
    const route = await resolveEffectiveParticipantRoute(ctx, { userId: session.userId, chatParticipantId: id });
    return route?.placement === "local" ? "local" : "cloud";
  },
});

export const createTurn = internalMutation({
  args: { ...runCycleArgs, participantIndex: v.number(), moderatorDirective: v.optional(v.string()) },
  handler: async (ctx, args): Promise<GenerationParticipantWorkflowArgs | null> => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status !== "running" || session.userId !== args.userId
      || session.executionEpoch !== args.executionEpoch || !args.executionAttemptId || args.executionFence === undefined
      || session.activeTurnCycle !== args.cycle || session.activeTurnParticipantIndex !== args.participantIndex
      || session.activeTurnExecutionEpoch !== args.executionEpoch) return null;
    const { run } = await assertCurrentExecution(ctx, { attemptId: args.executionAttemptId, fence: args.executionFence });
    if (run._id !== session.executionRunId) throw new Error("AUTONOMOUS_PARENT_MISMATCH");
    const config = args.participantConfigs.find(item => item.participantId === session.turnOrder[args.participantIndex]);
    const participantId = ctx.db.normalizeId("chatParticipants", config?.participantId ?? "");
    if (!config || !participantId) throw new Error("AUTONOMOUS_PARTICIPANT_MISSING");
    const participant = await ctx.db.get(participantId);
    if (participant?.userId !== args.userId || participant.chatId !== session.chatId) throw new Error("AUTONOMOUS_PARTICIPANT_MISMATCH");
    const context = await getDecisionContextHandler(ctx, { chatId: session.chatId, userId: args.userId, parentMessageIds: session.parentMessageIds });
    if (!context) throw new Error("AUTONOMOUS_SOURCE_MISSING");
    const participants = [{
      participantKey: String(participantId), modelId: config.modelId, personaId: participant.personaId,
      personaName: config.displayName, temperature: config.temperature, maxTokens: config.maxTokens,
      includeReasoning: config.includeReasoning, reasoningEffort: config.reasoningEffort ?? undefined,
    }];
    const now = Date.now();
    const setup = await createAssistantMessagesAndJobs(ctx, {
      chatId: session.chatId, userId: args.userId, participants,
      parentMessageIds: session.parentMessageIds.slice(0, 1), assistantCreatedAt: now, jobCreatedAt: now, parentRunId: run._id,
    });
    const [messageId] = setup.assistantMessageIds;
    const [jobId] = setup.generationJobIds;
    const job = await ctx.db.get(jobId);
    if (!job?.executionAttemptId || job.executionFence === undefined) throw new Error("AUTONOMOUS_CHILD_MISSING");
    const attempt = await ctx.db.get(job.executionAttemptId);
    if (attempt?.placement !== "local") throw new Error("AUTONOMOUS_LOCAL_ROUTE_CHANGED");
    await ctx.db.patch(messageId, { autonomousParticipantId: config.participantId, moderatorDirective: args.moderatorDirective });
    await ctx.db.patch(session._id, { activeTurnMessageId: messageId, activeTurnJobId: jobId, currentCycle: args.cycle, currentParticipantIndex: args.participantIndex, updatedAt: now });
    const chat = await ctx.db.get(session.chatId);
    await ctx.db.patch(session.chatId, { activeBranchLeafId: messageId, activeBranchLeafFocusOrder: undefined, messageCount: (chat?.messageCount ?? 0) + 1, updatedAt: now });
    return {
      chatId: session.chatId, userId: args.userId, userMessageId: context.messageId,
      assistantMessageIds: setup.assistantMessageIds, generationJobIds: setup.generationJobIds,
      participant: mapParticipantsForGeneration(participants, setup.assistantMessageIds, setup.generationJobIds, setup.streamingMessageIds)[0],
      executionAttemptId: job.executionAttemptId, executionFence: job.executionFence,
      expandMultiModelGroups: false, webSearchEnabled: args.webSearchEnabled,
      effectiveIntegrations: [], isPro: true, allowSubagents: false, journalProtocolVersion: 1,
    };
  },
});

export const bindWorkflow = internalMutation({
  args: { jobId: v.id("generationJobs"), workflowId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job?.executionRunId || !job.executionAttemptId || job.executionFence === undefined) throw new Error("AUTONOMOUS_CHILD_MISSING");
    await linkExecutionComponent(ctx, { runId: job.executionRunId, attemptId: job.executionAttemptId, fence: job.executionFence, adapterId: "convex-workflow", operationId: args.workflowId, role: "generation-workflow-primary" });
    return null;
  },
});

export const outcome = internalQuery({
  args: { jobId: v.id("generationJobs") }, returns: v.union(v.literal("completed"), v.literal("failed")),
  handler: async (ctx, { jobId }) => (await ctx.db.get(jobId))?.status === "completed" ? "completed" : "failed",
});
