import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { SendParticipantConfig } from "../chat/mutation_send_helpers";
import type { IntegrationOverrideEntry } from "../skills/resolver";
import { scheduleBackendAnalytics } from "../analytics/backend_events";
import { MAX_ADVISOR_BRIEF_CHARS, MAX_ADVISORS_PER_CHAT } from "./constants";
import { durableWorkflow } from "../execution/components";
import {
  createAndClaimDomainExecution,
  linkDomainComponent,
} from "../execution/domain_lifecycle";
import { ownedWorkflowCompletionRef } from "../execution/workflow_lifecycle";
import { scheduleOwnedWorkflowWatchdog } from
  "../execution/owned_workflow_watchdog";
import {
  advisorEligibilityMessage,
  resolveAdvisorModelAvailability,
  resolveAdvisorEligibility,
} from "./eligibility";
import {
  advisorInstanceName,
  buildAdvisorInstructions,
  personaSnapshot,
  resolveAdvisorModel,
  sanitizeAdvisorBrief,
} from "./shared";
import type {
  AdvisorEligibilityReason,
  AdvisorSelectionInput,
  DeferredGenerationSnapshot,
} from "./types";

type EffectiveAdvisor = {
  personaId: Id<"personas">;
  instanceName: string;
  sortOrder: number;
  allowWebSearch: boolean;
};

export async function createAdvisorBatchForTurn(
  ctx: MutationCtx,
  args: {
    userId: string;
    chat: Doc<"chats">;
    userMessageId: Id<"messages">;
    assistantMessageIds: Id<"messages">[];
    participants: SendParticipantConfig[];
    selections?: AdvisorSelectionInput[];
    brief?: string;
    enabledIntegrations?: string[];
    turnIntegrationOverrides?: IntegrationOverrideEntry[];
    generationSnapshot: DeferredGenerationSnapshot;
    parentRunId?: Id<"executionRuns">;
  },
): Promise<Id<"advisorBatches"> | null> {
  const existingBatch = await ctx.db
    .query("advisorBatches")
    .withIndex("by_user_message", (query) =>
      query.eq("userMessageId", args.userMessageId),
    )
    .first();
  if (existingBatch) return existingBatch._id;
  validateSelections(args.selections);
  if ((args.brief?.trim().length ?? 0) > MAX_ADVISOR_BRIEF_CHARS) {
    throw new ConvexError({
      code: "ADVISOR_BRIEF_TOO_LONG",
      message: `Advisor brief must be ${MAX_ADVISOR_BRIEF_CHARS} characters or fewer.`,
    });
  }

  const assignments = await ctx.db
    .query("chatAdvisors")
    .withIndex("by_chat", (query) => query.eq("chatId", args.chat._id))
    .collect();
  // Omitted selections inherit the chat's kept Advisors. A supplied array is
  // an exact turn snapshot, including [] for a queued turn that deliberately
  // had no Advisors when it was composed.
  const inheritedAssignments = args.selections === undefined ? assignments : [];
  if (
    inheritedAssignments.length === 0 &&
    (args.selections?.length ?? 0) === 0
  ) {
    if (args.brief?.trim()) {
      throw new ConvexError({
        code: "ADVISOR_REQUIRED",
        message: "Choose at least one Advisor for this brief.",
      });
    }
    return null;
  }
  const eligibility = await resolveAdvisorEligibility(ctx, {
    userId: args.userId,
    chat: args.chat,
    participants: args.participants,
    keptPersonaIds: inheritedAssignments.map(
      (assignment) => assignment.personaId,
    ),
    selectedPersonaIds: args.selections?.map(
      (selection) => selection.personaId,
    ),
    enabledIntegrations: args.enabledIntegrations,
    turnIntegrationOverrides: args.turnIntegrationOverrides,
  });
  if (!eligibility.isAvailable) {
    if ((args.selections?.length ?? 0) === 0 && !args.brief?.trim())
      return null;
    throw eligibilityError(eligibility.reasonCode);
  }

  const effective = mergeEffectiveAdvisors(
    inheritedAssignments,
    args.selections,
  );
  if (effective.length > MAX_ADVISORS_PER_CHAT) {
    throw new ConvexError({
      code: "ADVISOR_LIMIT",
      message: `Remove an existing Advisor before adding another. A chat supports up to ${MAX_ADVISORS_PER_CHAT}.`,
    });
  }
  const preferences = await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (query) => query.eq("userId", args.userId))
    .first();
  const participantPersonaIds = new Set(
    args.participants.flatMap((participant) =>
      participant.personaId ? [String(participant.personaId)] : [],
    ),
  );
  const prepared = await Promise.all(
    effective.map(async (advisor) => {
      const persona = await ctx.db.get(advisor.personaId);
      if (!persona || persona.userId !== args.userId) {
        return {
          personaId: String(advisor.personaId),
          owned: false,
          resolved: null,
        };
      }
      const model = resolveAdvisorModel(
        persona.modelId,
        preferences?.defaultModelId,
      );
      if (participantPersonaIds.has(String(persona._id))) {
        return { personaId: String(persona._id), owned: true, resolved: null };
      }
      const availability = await resolveAdvisorModelAvailability(
        ctx,
        model.modelId,
      );
      if (!availability.isAvailable) {
        return { personaId: String(persona._id), owned: true, resolved: null };
      }
      const avatarImageUrl = persona.avatarImageStorageId
        ? await ctx.storage.getUrl(persona.avatarImageStorageId)
        : null;
      return {
        personaId: String(persona._id),
        owned: true,
        resolved: {
          advisor: {
            ...advisor,
            allowWebSearch: advisor.allowWebSearch || model.legacyOnline,
          },
          persona,
          avatarImageUrl: avatarImageUrl ?? undefined,
          modelId: model.modelId,
        },
      };
    }),
  );
  const resolved = prepared.flatMap((entry) =>
    entry.resolved ? [entry.resolved] : [],
  );
  const availablePersonaIds = new Set(
    resolved.map((entry) => String(entry.persona._id)),
  );

  const now = Date.now();
  await persistKeptSelections(ctx, args, assignments, availablePersonaIds, now);
  if (resolved.length === 0) return null;
  const batchId = await ctx.db.insert("advisorBatches", {
    userId: args.userId,
    chatId: args.chat._id,
    userMessageId: args.userMessageId,
    assistantMessageIds: args.assistantMessageIds,
    status: "queued",
    brief: sanitizeAdvisorBrief(args.brief),
    expectedRunCount: resolved.length,
    completedRunCount: 0,
    failedRunCount: 0,
    generationSnapshot: args.generationSnapshot,
    createdAt: now,
    updatedAt: now,
  });
  for (const messageId of args.assistantMessageIds) {
    await ctx.db.patch(messageId, { advisorBatchId: batchId });
  }
  for (const entry of resolved) {
    await ctx.db.insert("advisorRuns", {
      batchId,
      userId: args.userId,
      chatId: args.chat._id,
      userMessageId: args.userMessageId,
      personaId: entry.persona._id,
      personaAvatarStorageId: entry.persona.avatarImageStorageId,
      personaSnapshot: personaSnapshot(entry.persona, entry.avatarImageUrl),
      instanceName: entry.advisor.instanceName,
      sortOrder: entry.advisor.sortOrder,
      status: "queued",
      stage: "queued",
      brief: sanitizeAdvisorBrief(args.brief),
      allowWebSearch: entry.advisor.allowWebSearch,
      resolvedInstructions: buildAdvisorInstructions(entry.persona),
      requestedModelId: entry.modelId,
      createdAt: now,
      updatedAt: now,
    });
  }
  const claimantId = `advisor-workflow:${String(batchId)}`;
  const execution = await createAndClaimDomainExecution(ctx, {
    userId: args.userId,
    runKey: `advisor:${String(batchId)}`,
    kind: "advisor",
    domainType: "advisor_batch",
    domainId: String(batchId),
    claimantId,
    chatId: args.chat._id,
    sourceMessageId: args.userMessageId,
    parentRunId: args.parentRunId,
  });
  const parentRun = await ctx.db.get(execution.runId);
  for (const messageId of args.assistantMessageIds) {
    const job = await ctx.db
      .query("generationJobs")
      .withIndex("by_message", (query) => query.eq("messageId", messageId))
      .first();
    if (!job?.executionRunId) continue;
    const generationRun = await ctx.db.get(job.executionRunId);
    if (
      generationRun
      && generationRun.userId === args.userId
      && !generationRun.parentRunId
      && generationRun.state === "queued"
    ) {
      await ctx.db.patch(generationRun._id, {
        parentRunId: execution.runId,
        rootRunId: parentRun?.rootRunId ?? execution.runId,
        updatedAt: now,
      });
    }
  }
  const workflowId = await durableWorkflow.start(
    ctx,
    internal.advisors.advisor_workflow.runAdvisorBatchWorkflow,
    { batchId },
    { startAsync: true, onComplete: ownedWorkflowCompletionRef, context: {} },
  );
  await linkDomainComponent(ctx, execution, {
    adapterId: "convex-workflow",
    operationId: workflowId,
    role: "advisor-batch-workflow",
  });
  await scheduleOwnedWorkflowWatchdog(ctx, { workflowId, context: {} });
  await ctx.db.patch(batchId, {
    workflowId,
    executionRunId: execution.runId,
    executionAttemptId: execution.attemptId,
    executionFence: execution.fence,
    executionClaimantId: claimantId,
  });
  return batchId;
}

function mergeEffectiveAdvisors(
  assignments: Doc<"chatAdvisors">[],
  selections: AdvisorSelectionInput[] | undefined,
): EffectiveAdvisor[] {
  const ordered = assignments.map((assignment) => ({
    personaId: assignment.personaId,
    instanceName: assignment.instanceName,
    sortOrder: assignment.sortOrder,
    allowWebSearch: assignment.allowWebSearch,
  }));
  const byPersona = new Map(
    ordered.map((advisor) => [String(advisor.personaId), advisor]),
  );
  for (const selection of selections ?? []) {
    const current = byPersona.get(String(selection.personaId));
    if (current) {
      current.allowWebSearch = selection.allowWebSearch;
    } else {
      const advisor = {
        personaId: selection.personaId,
        instanceName: advisorInstanceName(selection.personaId),
        sortOrder: ordered.length,
        allowWebSearch: selection.allowWebSearch,
      };
      ordered.push(advisor);
      byPersona.set(String(selection.personaId), advisor);
    }
  }
  return ordered
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((advisor, index) => ({ ...advisor, sortOrder: index }));
}

async function persistKeptSelections(
  ctx: MutationCtx,
  args: Parameters<typeof createAdvisorBatchForTurn>[1],
  assignments: Doc<"chatAdvisors">[],
  availablePersonaIds: Set<string>,
  now: number,
): Promise<void> {
  const byPersona = new Map(
    assignments.map((assignment) => [String(assignment.personaId), assignment]),
  );
  let nextSortOrder = assignments.reduce(
    (maximum, assignment) => Math.max(maximum, assignment.sortOrder + 1),
    0,
  );
  let remainingCapacity = Math.max(
    0,
    MAX_ADVISORS_PER_CHAT - assignments.length,
  );
  for (const selection of args.selections ?? []) {
    if (
      !selection.keepAvailable ||
      !availablePersonaIds.has(String(selection.personaId))
    )
      continue;
    const existing = byPersona.get(String(selection.personaId));
    if (existing) {
      await ctx.db.patch(existing._id, {
        allowWebSearch: selection.allowWebSearch,
        updatedAt: now,
      });
      continue;
    }
    if (remainingCapacity === 0) continue;
    await ctx.db.insert("chatAdvisors", {
      userId: args.userId,
      chatId: args.chat._id,
      personaId: selection.personaId,
      instanceName: advisorInstanceName(selection.personaId),
      sortOrder: nextSortOrder,
      allowWebSearch: selection.allowWebSearch,
      createdAt: now,
      updatedAt: now,
    });
    nextSortOrder += 1;
    remainingCapacity -= 1;
    await scheduleBackendAnalytics(ctx, args.userId, "advisor_kept_for_chat", {
      chat_id: String(args.chat._id),
      persona_id: String(selection.personaId),
      web_search_enabled: selection.allowWebSearch,
    });
  }
}

function validateSelections(
  selections: AdvisorSelectionInput[] | undefined,
): void {
  const ids = selections?.map((selection) => String(selection.personaId)) ?? [];
  if (new Set(ids).size !== ids.length || ids.length > MAX_ADVISORS_PER_CHAT) {
    throw new ConvexError({
      code: "ADVISOR_LIMIT",
      message: "Choose up to three distinct Advisors.",
    });
  }
}

function eligibilityError(
  reason: AdvisorEligibilityReason | undefined,
): ConvexError<{ code: string; message: string }> {
  return new ConvexError({
    code: "ADVISORS_UNAVAILABLE",
    message: advisorEligibilityMessage(reason),
  });
}
