import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import type { AnalyticsClientMetadata } from "../analytics/client_metadata";
import { cancelGenerationContinuationHandler } from "./mutations_generation_continuation_handlers";
import { RetryContract } from "./retry_contract";
import { TerminalErrorCode } from "./terminal_error";
import {
  createGenerationExecution,
  resolveGenerationExecutionRoute,
} from "../execution/control_plane";
import { cancelExecutionForGenerationJob } from "../execution/cancellation";

export {
  normalizeMessageAttachments,
  type NormalizedAttachment,
} from "./attachment_normalization";

export type SendParticipantConfig = {
  participantKey?: string;
  modelId: string;
  personaId?: Id<"personas"> | null;
  personaName?: string | null;
  personaEmoji?: string | null;
  personaAvatarImageUrl?: string | null;
  systemPrompt?: string | null;
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string | null;
};

function dedupeIds<T extends string>(ids: T[]): T[] {
  const seen = new Set<T>();
  return ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function resolveGroupParents(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  anchorId: Id<"messages">,
  groupId: string,
): Promise<Id<"messages">[]> {
  const siblings = await ctx.db
    .query("messages")
    .withIndex("by_chat_group", (query) =>
      query.eq("chatId", chatId).eq("multiModelGroupId", groupId),
    )
    .collect();

  const siblingIds = siblings
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((message) => message._id);

  return [anchorId, ...siblingIds.filter((id) => id !== anchorId)];
}

export async function resolveParentMessageIdsForSend(
  ctx: MutationCtx,
  args: {
    chatId: Id<"chats">;
    activeBranchLeafId?: Id<"messages">;
    explicitParentIds?: Id<"messages">[];
    expandMultiModelGroups: boolean;
  },
): Promise<Id<"messages">[]> {
  let parentMessageIds: Id<"messages">[] = [];

  if (args.explicitParentIds && args.explicitParentIds.length > 0) {
    const uniqueExplicitParents = dedupeIds(args.explicitParentIds);
    const validatedExplicitParents: Id<"messages">[] = [];

    for (const parentId of uniqueExplicitParents) {
      const parentMessage = await ctx.db.get(parentId);
      if (parentMessage && parentMessage.chatId === args.chatId) {
        validatedExplicitParents.push(parentId);
      }
    }

    parentMessageIds = validatedExplicitParents;
  }

  if (parentMessageIds.length > 0) {
    return parentMessageIds;
  }

  let resolvedParents: Id<"messages">[] = [];

  if (args.activeBranchLeafId) {
    const leaf = await ctx.db.get(args.activeBranchLeafId);
    if (leaf && leaf.chatId === args.chatId) {
      if (args.expandMultiModelGroups && leaf.multiModelGroupId) {
        resolvedParents = await resolveGroupParents(
          ctx,
          args.chatId,
          args.activeBranchLeafId,
          leaf.multiModelGroupId,
        );
      } else {
        resolvedParents = [args.activeBranchLeafId];
      }
    }
  }

  if (resolvedParents.length === 0) {
    const recentMessages = await ctx.db
      .query("messages")
      .withIndex("by_chat", (query) => query.eq("chatId", args.chatId))
      .order("desc")
      .take(1);
    if (recentMessages.length > 0) {
      const latest = recentMessages[0];
      if (args.expandMultiModelGroups && latest.multiModelGroupId) {
        resolvedParents = await resolveGroupParents(
          ctx,
          args.chatId,
          latest._id,
          latest.multiModelGroupId,
        );
      } else {
        resolvedParents = [latest._id];
      }
    }
  }

  return dedupeIds(resolvedParents);
}

export function normalizeParticipants(
  participants: SendParticipantConfig[],
  defaultModelId: string,
): SendParticipantConfig[] {
  return participants.length > 0 ? participants : [{ modelId: defaultModelId }];
}

export function selectMentionedParticipants(
  participants: SendParticipantConfig[],
  mentionedParticipantKeys: string[] | undefined,
): SendParticipantConfig[] {
  if (!mentionedParticipantKeys || mentionedParticipantKeys.length === 0) {
    return participants;
  }

  const requestedKeys = new Set<string>();
  for (const key of mentionedParticipantKeys) {
    if (!key || requestedKeys.has(key)) {
      throw new ConvexError({
        code: "VALIDATION",
        message: "The mentioned participants are invalid. Refresh the chat and try again.",
      });
    }
    requestedKeys.add(key);
  }

  const participantsByKey = new Map<string, SendParticipantConfig>();
  for (const participant of participants) {
    const key = participant.participantKey;
    if (!key) continue;
    if (participantsByKey.has(key)) {
      throw new ConvexError({
        code: "VALIDATION",
        message: "The mentioned participants are invalid. Refresh the chat and try again.",
      });
    }
    participantsByKey.set(key, participant);
  }

  for (const requestedKey of requestedKeys) {
    if (!participantsByKey.has(requestedKey)) {
      throw new ConvexError({
        code: "VALIDATION",
        message: "A mentioned participant is no longer available. Refresh the chat and try again.",
      });
    }
  }

  return participants
    .filter((participant) =>
      participant.participantKey !== undefined && requestedKeys.has(participant.participantKey),
    );
}

export async function createAssistantMessagesAndJobs(
  ctx: MutationCtx,
  args: {
    chatId: Id<"chats">;
    userId: string;
    participants: SendParticipantConfig[];
    parentMessageIds: Id<"messages">[];
    assistantCreatedAt: number;
    jobCreatedAt: number;
    enabledIntegrations?: string[];
    subagentsEnabled?: boolean;
    // M30 — Turn-level overrides for auditing
    turnSkillOverrides?: Array<{ skillId: Id<"skills">; state: "always" | "available" | "never" }>;
    turnIntegrationOverrides?: Array<{ integrationId: string; enabled: boolean }>;
    retryContract?: RetryContract;
    analytics?: AnalyticsClientMetadata;
    analyticsSource?: CancelledAnalyticsSource;
    parentRunId?: Id<"executionRuns">;
    collaboration?: {
      exchangeId: Id<"collaborationExchanges">;
      decisionId: Id<"collaborationDecisions">;
      wave: number;
      participants: Array<{
        chatParticipantId: Id<"chatParticipants">;
        replyToMessageIds: Id<"messages">[];
      }>;
    };
  },
): Promise<{
  assistantMessageIds: Id<"messages">[];
  generationJobIds: Id<"generationJobs">[];
  streamingMessageIds: Id<"streamingMessages">[];
}> {
  const isMultiParticipant = args.participants.length > 1;
  const multiModelGroupId = isMultiParticipant ? crypto.randomUUID() : undefined;

  const assistantMessageIds: Id<"messages">[] = [];
  const generationJobIds: Id<"generationJobs">[] = [];
  const streamingMessageIds: Id<"streamingMessages">[] = [];

  for (let index = 0; index < args.participants.length; index += 1) {
    const participant = args.participants[index];
    const collaboration = args.collaboration?.participants[index];
    const chatParticipantId = collaboration?.chatParticipantId
      ?? participant.participantKey as Id<"chatParticipants"> | undefined;
    const assistantMessageId = await ctx.db.insert("messages", {
      chatId: args.chatId,
      userId: args.userId,
      role: "assistant",
      content: "",
      modelId: participant.modelId,
      participantId: participant.personaId ?? undefined,
      participantName: participant.personaName ?? undefined,
      participantEmoji: participant.personaEmoji ?? undefined,
      participantAvatarImageUrl: participant.personaAvatarImageUrl ?? undefined,
      chatParticipantId,
      collaborationExchangeId: args.collaboration?.exchangeId,
      collaborationDecisionId: args.collaboration?.decisionId,
      collaborationWave: args.collaboration?.wave,
      collaborationReplyToIds: collaboration?.replyToMessageIds,
      parentMessageIds: args.parentMessageIds,
      multiModelGroupId,
      isMultiModelResponse: isMultiParticipant,
      status: "pending",
      enabledIntegrations: args.enabledIntegrations,
      subagentsEnabled: args.subagentsEnabled,
      turnSkillOverrides: args.turnSkillOverrides,
      turnIntegrationOverrides: args.turnIntegrationOverrides,
      retryContract: args.retryContract,
      createdAt: args.assistantCreatedAt,
    });
    assistantMessageIds.push(assistantMessageId);

    const streamingMessageId = await ctx.db.insert("streamingMessages", {
      userId: args.userId,
      messageId: assistantMessageId,
      chatId: args.chatId,
      content: "",
      reasoning: undefined,
      status: "pending",
      toolCalls: undefined,
      createdAt: args.jobCreatedAt,
      updatedAt: args.jobCreatedAt,
    });
    streamingMessageIds.push(streamingMessageId);

    const jobId = await ctx.db.insert("generationJobs", {
      chatId: args.chatId,
      messageId: assistantMessageId,
      streamingMessageId,
      userId: args.userId,
      modelId: participant.modelId,
      status: "queued",
      analytics: args.analytics,
      analyticsSource: args.analyticsSource,
      collaborationExchangeId: args.collaboration?.exchangeId,
      collaborationDecisionId: args.collaboration?.decisionId,
      collaborationWave: args.collaboration?.wave,
      chatParticipantId,
      createdAt: args.jobCreatedAt,
    });
    const route = await resolveGenerationExecutionRoute(ctx, {
      userId: args.userId,
      chatParticipantId,
      personaId: participant.personaId ?? null,
      now: args.jobCreatedAt,
      allowOfflineWait: args.parentRunId === undefined,
    });
    await createGenerationExecution(ctx, {
      jobId,
      userId: args.userId,
      chatId: args.chatId,
      sourceMessageId: assistantMessageId,
      modelId: participant.modelId,
      route,
      parentRunId: args.parentRunId,
      now: args.jobCreatedAt,
    });
    generationJobIds.push(jobId);
  }

  return { assistantMessageIds, generationJobIds, streamingMessageIds };
}

export function mapParticipantsForGeneration(
  participants: SendParticipantConfig[],
  assistantMessageIds: Id<"messages">[],
  generationJobIds: Id<"generationJobs">[],
  streamingMessageIds?: Id<"streamingMessages">[],
) {
  return participants.map((participant, index) => {
    const { participantKey, ...config } = participant;
    return {
      ...config,
      chatParticipantId: participantKey as Id<"chatParticipants"> | undefined,
      personaId: participant.personaId ?? undefined,
      personaName: participant.personaName ?? undefined,
      personaEmoji: participant.personaEmoji ?? undefined,
      systemPrompt: participant.systemPrompt ?? undefined,
      reasoningEffort: participant.reasoningEffort ?? undefined,
      messageId: assistantMessageIds[index],
      jobId: generationJobIds[index],
      streamingMessageId: streamingMessageIds?.[index],
    };
  });
}

export async function cancelGenerationJobsForMessage(
  ctx: MutationCtx,
  messageId: Id<"messages">,
  now: number,
  terminalErrorCode?: Extract<TerminalErrorCode, "cancelled_by_retry" | "cancelled_by_user">,
): Promise<void> {
  const existingJobs = await ctx.db
    .query("generationJobs")
    .withIndex("by_message", (query) => query.eq("messageId", messageId))
    .collect();
  for (const job of existingJobs) {
    if (job.status !== "completed" && job.status !== "failed") {
      await cancelExecutionForGenerationJob(ctx, {
        jobId: job._id,
        requestedBy: terminalErrorCode === "cancelled_by_retry" ? "retry" : "user",
        now,
      });
      await cancelGenerationContinuationHandler(ctx, {
        jobId: job._id,
      });
      await ctx.db.patch(job._id, {
        status: "cancelled",
        completedAt: now,
        terminalErrorCode,
      });
      await scheduleCancelledAssistantResponseAnalytics(ctx, job);
    }
  }
}

type CancelledAnalyticsSource =
  | "chat_generation"
  | "web_search"
  | "research_paper"
  | "subagent_parent_resume"
  | "scheduled_job"
  | "video_generation";

async function cancelledAnalyticsSource(
  ctx: MutationCtx,
  job: Doc<"generationJobs">,
  message: Doc<"messages">,
): Promise<CancelledAnalyticsSource> {
  if (job.sourceJobId) {
    return "scheduled_job";
  }
  if (message.searchSessionId) {
    const session = await ctx.db.get(message.searchSessionId);
    if (session?.mode === "paper") {
      return "research_paper";
    }
    return "web_search";
  }
  const videoJob = await ctx.db
    .query("videoJobs")
    .withIndex("by_messageId", (q) => q.eq("messageId", job.messageId))
    .first();
  if (videoJob) {
    return "video_generation";
  }
  return "chat_generation";
}

export async function scheduleCancelledAssistantResponseAnalytics(
  ctx: MutationCtx,
  job: Doc<"generationJobs">,
  message?: Doc<"messages"> | null,
): Promise<void> {
  const messageDoc = message ?? await ctx.db.get(job.messageId);
  if (!messageDoc) return;
  const scheduler = (ctx as { scheduler?: Pick<MutationCtx["scheduler"], "runAfter"> }).scheduler;
  if (typeof scheduler?.runAfter !== "function") return;
  const deferredContext: Awaited<ReturnType<typeof deferredCancellationContext>> = job.status === "streaming"
    ? await deferredCancellationContext(ctx, job)
    : { isDeferred: false };
  const shouldEmitSyntheticStart = job.status === "queued" ||
    (job.status === "streaming" && job.analyticsStartedAt === undefined);
  if (
    job.status !== "queued" &&
    !(
      job.status === "streaming" &&
      (deferredContext.isDeferred || job.analyticsStartedAt === undefined)
    )
  ) {
    return;
  }
  await scheduler.runAfter(0, internal.chat.actions.captureCancelledAssistantResponse, {
    userId: job.userId,
    chatId: job.chatId,
    messageId: job.messageId,
    jobId: job._id,
    modelId: job.modelId,
    source: deferredContext.source ?? job.analyticsSource ?? await cancelledAnalyticsSource(ctx, job, messageDoc),
    analytics: deferredContext.analytics ?? job.analytics,
    subagentBatchId: deferredContext.subagentBatchId,
    drivePickerBatchId: deferredContext.drivePickerBatchId,
    emitStarted: shouldEmitSyntheticStart,
  });
}

async function deferredCancellationContext(
  ctx: MutationCtx,
  job: Doc<"generationJobs">,
): Promise<{
  isDeferred: boolean;
  source?: CancelledAnalyticsSource;
  analytics?: AnalyticsClientMetadata;
  subagentBatchId?: Id<"subagentBatches">;
  drivePickerBatchId?: Id<"drivePickerBatches">;
}> {
  const subagentBatch = await ctx.db
    .query("subagentBatches")
    .withIndex("by_parent_message", (q) => q.eq("parentMessageId", job.messageId))
    .first();
  if (subagentBatch && subagentBatch.status !== "completed" && subagentBatch.status !== "failed") {
    const params = subagentBatch.paramsSnapshot as {
      analytics?: AnalyticsClientMetadata;
      analyticsSource?: CancelledAnalyticsSource;
    } | undefined;
    return {
      isDeferred: true,
      source: params?.analyticsSource,
      analytics: params?.analytics,
      subagentBatchId: subagentBatch._id,
    };
  }

  const drivePickerBatch = await ctx.db
    .query("drivePickerBatches")
    .withIndex("by_parent_message", (q) => q.eq("parentMessageId", job.messageId))
    .first();
  if (
    drivePickerBatch &&
    drivePickerBatch.status !== "completed" &&
    drivePickerBatch.status !== "failed" &&
    drivePickerBatch.status !== "cancelled"
  ) {
    const params = drivePickerBatch.paramsSnapshot as {
      analytics?: AnalyticsClientMetadata;
      analyticsSource?: CancelledAnalyticsSource;
    } | undefined;
    return {
      isDeferred: true,
      source: params?.analyticsSource,
      analytics: params?.analytics,
      drivePickerBatchId: drivePickerBatch._id,
    };
  }

  const videoJob = await ctx.db
    .query("videoJobs")
    .withIndex("by_messageId", (q) => q.eq("messageId", job.messageId))
    .first();
  if (videoJob && videoJob.status !== "completed" && videoJob.status !== "failed") {
    return {
      isDeferred: true,
      source: "video_generation",
      analytics: job.analytics,
    };
  }

  return { isDeferred: false };
}
