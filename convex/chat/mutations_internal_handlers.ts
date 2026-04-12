import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { mapFinalMessageStatusToJobStatus } from "./lifecycle_helpers";
import { normalizeMemoryRecord } from "../memory/shared";
import { isAudioBasedUserMessage, resolveAutoAudioResponseEnabled } from "./audio_shared";
import { isPlaceholderTitle } from "./title_helpers";
import {
  deleteStreamingMessage,
  getStreamingMessageByMessageId,
  isTerminalMessageStatus,
  upsertStreamingMessage,
} from "./streaming_state";

const CHAT_COMPLETION_PUSH_CATEGORY = "CHAT_COMPLETION";

export interface UpdateMessageContentArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  content: string;
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
}

export async function updateMessageContentHandler(
  ctx: MutationCtx,
  args: UpdateMessageContentArgs,
): Promise<void> {
  const existing = await ctx.db.get(args.messageId);
  if (!existing) return;
  if (isTerminalMessageStatus(existing.status)) {
    return;
  }

  await upsertStreamingMessage(ctx, existing, {
    content: args.content,
    status: args.status,
  });
}

export interface UpdateMessageReasoningArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  reasoning: string;
}

export async function updateMessageReasoningHandler(
  ctx: MutationCtx,
  args: UpdateMessageReasoningArgs,
): Promise<void> {
  const existing = await ctx.db.get(args.messageId);
  if (!existing) return;
  if (isTerminalMessageStatus(existing.status)) return;

  await upsertStreamingMessage(ctx, existing, {
    reasoning: args.reasoning,
  });
}

export interface MarkChatCompletionNotifiedArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

export async function markChatCompletionNotifiedHandler(
  ctx: MutationCtx,
  args: MarkChatCompletionNotifiedArgs,
): Promise<boolean> {
  const existing = await ctx.db.get(args.messageId);
  if (!existing || existing.chatCompletionNotifiedAt != null) {
    return false;
  }

  await ctx.db.patch(args.messageId, {
    chatCompletionNotifiedAt: Date.now(),
  });
  return true;
}

export interface FinalizeGenerationArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  chatId: Id<"chats">;
  content: string;
  status: "completed" | "failed" | "cancelled";
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
    isByok?: boolean;
    cachedTokens?: number;
    cacheWriteTokens?: number;
    audioPromptTokens?: number;
    videoTokens?: number;
    reasoningTokens?: number;
    imageCompletionTokens?: number;
    audioCompletionTokens?: number;
    upstreamInferenceCost?: number;
    upstreamInferencePromptCost?: number;
    upstreamInferenceCompletionsCost?: number;
  };
  reasoning?: string;
  imageUrls?: string[];
  userId: string;
  // M10 — Tool execution metadata
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  toolResults?: Array<{
    toolCallId: string;
    toolName: string;
    result: string;
    isError?: boolean;
  }>;
  generatedFileIds?: Id<"generatedFiles">[];
  generatedChartIds?: Id<"generatedCharts">[];
  /** Raw generated-file metadata — handler inserts rows and derives IDs. */
  generatedFiles?: Array<{
    storageId: Id<"_storage">;
    filename: string;
    mimeType: string;
    sizeBytes?: number;
    toolName: string;
  }>;
  generatedCharts?: Array<{
    toolName: string;
    chartType: "line" | "bar" | "scatter" | "pie" | "box" | "png_image";
    title?: string;
    xLabel?: string;
    yLabel?: string;
    xUnit?: string;
    yUnit?: string;
    elements: unknown;
    pngBase64?: string;
  }>;
  /** Perplexity citation annotations (structured for rich UI rendering). */
  citations?: Array<{ url: string; title: string }>;
  // M26 — Lyria inline audio
  audioStorageId?: Id<"_storage">;
  audioDurationMs?: number;
  audioGeneratedAt?: number;
  triggerUserMessageId?: Id<"messages">;
  /** OpenRouter generation ID — used post-finalization to fetch authoritative usage. */
  openrouterGenerationId?: string;
}

export async function finalizeGenerationHandler(
  ctx: MutationCtx,
  args: FinalizeGenerationArgs,
): Promise<void> {
  const now = Date.now();
  const generationJob = await ctx.db.get(args.jobId);
  const shouldTreatLateCompletionAsCancelled =
    generationJob?.status === "cancelled" && args.status === "completed";
  const finalStatus = shouldTreatLateCompletionAsCancelled
    ? "cancelled"
    : args.status;

  // Guard: if the job was already cancelled by the user, don't overwrite
  // with "completed" or "streaming" results.  We still allow overwriting
  // with "failed" so error details are preserved.
  // AUDIT-6: When the guard blocks a "completed" finalization for a
  // cancelled job, we must still continue/fail any associated scheduled-job
  // pipeline, otherwise the pipeline stalls indefinitely.
  if (shouldTreatLateCompletionAsCancelled) {
    if (generationJob.sourceJobId && generationJob.sourceExecutionId) {
      await ctx.scheduler.runAfter(
        0,
        internal.scheduledJobs.actions.failScheduledJobExecution,
        {
          jobId: generationJob.sourceJobId,
          executionId: generationJob.sourceExecutionId,
          error: "Generation was cancelled by user.",
        },
      );
    }
  }

  const continuation = await ctx.db
    .query("generationContinuations")
    .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
    .first();
  if (continuation) {
    await ctx.db.delete(continuation._id);
  }

  const streamingMessage = await getStreamingMessageByMessageId(ctx, args.messageId);
  const persistedMessage = await ctx.db.get(args.messageId);

  let finalContent = args.content;
  if (!finalContent.trim() && streamingMessage?.content?.trim()) {
    finalContent = streamingMessage.content;
  }
  if (finalStatus === "cancelled") {
    if (streamingMessage?.content && streamingMessage.content.trim().length > 0) {
      finalContent = streamingMessage.content;
    } else if (persistedMessage?.content && persistedMessage.content.trim().length > 0) {
      finalContent = persistedMessage.content;
    }
  }

  const msgPatch: Record<string, unknown> = {
    content: finalContent,
    status: finalStatus,
    usage: args.usage,
  };
  const finalReasoning = args.reasoning ?? streamingMessage?.reasoning;
  if (finalReasoning) msgPatch.reasoning = finalReasoning;
  if (args.imageUrls) msgPatch.imageUrls = args.imageUrls;
  const finalToolCalls = args.toolCalls ?? streamingMessage?.toolCalls;
  if (finalToolCalls) msgPatch.toolCalls = finalToolCalls;
  if (args.toolResults) msgPatch.toolResults = args.toolResults;
  if (args.citations && args.citations.length > 0) msgPatch.citations = args.citations;

  // M26: Lyria inline audio — persist audio fields directly onto the message.
  if (args.audioStorageId) {
    msgPatch.audioStorageId = args.audioStorageId;
    if (args.audioDurationMs != null) msgPatch.audioDurationMs = args.audioDurationMs;
    if (args.audioGeneratedAt != null) msgPatch.audioGeneratedAt = args.audioGeneratedAt;
  }

  // M10: Insert generatedFiles rows and collect their IDs.
  let fileIds = args.generatedFileIds;
  if (args.generatedFiles && args.generatedFiles.length > 0) {
    fileIds = [];
    for (const file of args.generatedFiles) {
      const id = await ctx.db.insert("generatedFiles", {
        userId: args.userId,
        chatId: args.chatId,
        messageId: args.messageId,
        storageId: file.storageId,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        toolName: file.toolName,
        createdAt: now,
      });
      fileIds.push(id);
    }
  }
  if (fileIds && fileIds.length > 0) msgPatch.generatedFileIds = fileIds;

  let chartIds = args.generatedChartIds;
  if (args.generatedCharts && args.generatedCharts.length > 0) {
    chartIds = [];
    for (const chart of args.generatedCharts) {
      const id = await ctx.db.insert("generatedCharts", {
        userId: args.userId,
        chatId: args.chatId,
        messageId: args.messageId,
        toolName: chart.toolName,
        chartType: chart.chartType,
        title: chart.title,
        xLabel: chart.xLabel,
        yLabel: chart.yLabel,
        xUnit: chart.xUnit,
        yUnit: chart.yUnit,
        elements: chart.elements,
        pngBase64: chart.pngBase64,
        createdAt: now,
      });
      chartIds.push(id);
    }
  }
  if (chartIds && chartIds.length > 0) msgPatch.generatedChartIds = chartIds;

  // M26: Insert a generatedFiles row for Lyria audio so it appears in Knowledge Base.
  if (args.audioStorageId) {
    const audioFileId = await ctx.db.insert("generatedFiles", {
      userId: args.userId,
      chatId: args.chatId,
      messageId: args.messageId,
      storageId: args.audioStorageId,
      filename: "lyria-music.mp3",
      mimeType: "audio/mpeg",
      sizeBytes: undefined,
      toolName: "lyria_music_generation",
      createdAt: now,
    });
    // Append to any existing file IDs.
    const allFileIds = fileIds ? [...fileIds, audioFileId] : [audioFileId];
    msgPatch.generatedFileIds = allFileIds;
  }

  await ctx.db.patch(args.messageId, msgPatch);
  await deleteStreamingMessage(ctx, args.messageId);

  await ctx.db.patch(args.jobId, {
    status: mapFinalMessageStatusToJobStatus(finalStatus),
    error: args.error,
    completedAt: now,
    scheduledFunctionId: undefined,
  });

  const chat = await ctx.db.get(args.chatId);
  if (chat) {
    // Skip updatedAt — sendMessage already bumped it when the user message
    // was created, and the chat is already at the top of the list.  Patching
    // updatedAt again here would trigger a redundant listChats re-evaluation
    // across all connected clients.
    const chatPatch: Record<string, unknown> = {};
    if (finalStatus === "completed" && finalContent.trim()) {
      chatPatch.lastMessagePreview = finalContent.trim().substring(0, 200);
      chatPatch.lastMessageDate = now;
    }
    if (Object.keys(chatPatch).length > 0) {
      await ctx.db.patch(args.chatId, chatPatch);
    }

    // Update jobRuns duration for scheduled-job-created chats.
    // The run record was inserted with dispatch-only timing; now patch it
    // with the real completedAt / durationMs that includes generation time.
    if (chat.sourceJobId) {
      const jobRun = await ctx.db
        .query("jobRuns")
        .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
        .first();
      if (jobRun) {
        const realDuration = now - jobRun.startedAt;
        await ctx.db.patch(jobRun._id, {
          completedAt: now,
          durationMs: realDuration,
        });
      }

      // Push notification when a scheduled-job generation finishes
      if (generationJob?.sourceJobId && generationJob.sourceExecutionId) {
        if (finalStatus === "completed") {
          await ctx.scheduler.runAfter(
            0,
            internal.scheduledJobs.actions.continueScheduledJobExecution,
            {
              jobId: generationJob.sourceJobId,
              chatId: args.chatId,
              executionId: generationJob.sourceExecutionId,
              completedStepIndex: generationJob.sourceStepIndex ?? 0,
              assistantMessageId: args.messageId,
            },
          );
        } else {
          await ctx.scheduler.runAfter(
            0,
            internal.scheduledJobs.actions.failScheduledJobExecution,
            {
              jobId: generationJob.sourceJobId,
              executionId: generationJob.sourceExecutionId,
              error: args.error ?? "Generation failed.",
            },
          );
        }
      }
    }
  }

  if (
    finalStatus === "completed" &&
    args.triggerUserMessageId &&
    !args.audioStorageId
  ) {
    await maybeScheduleChatCompletionPush(
      ctx,
      args.chatId,
      args.userId,
      args.triggerUserMessageId,
    );
  }

  if (!args.usage || finalStatus !== "completed") {
    // Even without SSE-based usage, schedule a Generations API fetch if we
    // have a generation ID — it is the authoritative source for token counts.
    if (finalStatus === "completed" && args.openrouterGenerationId) {
      await ctx.scheduler.runAfter(
        2000,
        internal.chat.actions.fetchAndStoreGenerationUsage,
        {
          messageId: args.messageId,
          chatId: args.chatId,
          userId: args.userId,
          openrouterGenerationId: args.openrouterGenerationId,
        },
      );
    }
    if (finalStatus === "completed" && args.triggerUserMessageId && !args.audioStorageId) {
      await maybeScheduleAutoAudio(ctx, args.messageId, args.chatId, args.triggerUserMessageId);
    }
    return;
  }

  const msg = await ctx.db.get(args.messageId);
  if (!msg) {
    return;
  }

  let cost = args.usage.cost;
  if (cost == null && msg.modelId) {
    const model = await ctx.db
      .query("cachedModels")
      .withIndex("by_modelId", (q) => q.eq("modelId", msg.modelId!))
      .first();
    if (model?.inputPricePer1M != null && model?.outputPricePer1M != null) {
      cost =
        (args.usage.promptTokens * model.inputPricePer1M) / 1_000_000 +
        (args.usage.completionTokens * model.outputPricePer1M) / 1_000_000;
    }
  }

  // If we computed cost from model pricing, patch it back onto the message's
  // usage field so the UI has the full picture.
  if (cost != null && args.usage.cost == null) {
    const currentMsg = await ctx.db.get(args.messageId);
    if (currentMsg?.usage) {
      await ctx.db.patch(args.messageId, {
        usage: { ...currentMsg.usage, cost },
      });
    }
  }

  // Extract optional detail fields from the SSE usage for the usageRecords row.
  const detailFields: Record<string, number | boolean | undefined> = {
    isByok: args.usage.isByok,
    cachedTokens: args.usage.cachedTokens,
    cacheWriteTokens: args.usage.cacheWriteTokens,
    audioPromptTokens: args.usage.audioPromptTokens,
    videoTokens: args.usage.videoTokens,
    reasoningTokens: args.usage.reasoningTokens,
    imageCompletionTokens: args.usage.imageCompletionTokens,
    audioCompletionTokens: args.usage.audioCompletionTokens,
    upstreamInferenceCost: args.usage.upstreamInferenceCost,
    upstreamInferencePromptCost: args.usage.upstreamInferencePromptCost,
    upstreamInferenceCompletionsCost: args.usage.upstreamInferenceCompletionsCost,
  };

  await ctx.db.insert("usageRecords", {
    userId: args.userId,
    chatId: args.chatId,
    messageId: args.messageId,
    modelId: msg.modelId ?? "unknown",
    promptTokens: args.usage.promptTokens,
    completionTokens: args.usage.completionTokens,
    totalTokens: args.usage.totalTokens,
    cost,
    ...detailFields,
    createdAt: now,
  });

  // Only schedule a Generations API fetch as a fallback when SSE did not
  // provide cost data. When SSE already gave us usage, the data is accurate
  // enough and scheduling an extra fetch causes a second reactive update to
  // getChatCostSummary, making the cost display flicker.
  if (args.openrouterGenerationId && cost == null) {
    await ctx.scheduler.runAfter(
      2000,
      internal.chat.actions.fetchAndStoreGenerationUsage,
      {
        messageId: args.messageId,
        chatId: args.chatId,
        userId: args.userId,
        openrouterGenerationId: args.openrouterGenerationId,
      },
    );
  }

  if (args.triggerUserMessageId && !args.audioStorageId) {
    await maybeScheduleAutoAudio(ctx, args.messageId, args.chatId, args.triggerUserMessageId);
  }
}

async function maybeScheduleAutoAudio(
  ctx: MutationCtx,
  messageId: Id<"messages">,
  chatId: Id<"chats">,
  triggerUserMessageId: Id<"messages">,
): Promise<void> {
  const [triggerMessage, chat] = await Promise.all([
    ctx.db.get(triggerUserMessageId),
    ctx.db.get(chatId),
  ]);
  if (!triggerMessage || !chat) return;
  if (!isAudioBasedUserMessage(triggerMessage as any)) return;

  const preferences = await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (q) => q.eq("userId", chat.userId))
    .first();
  if (!resolveAutoAudioResponseEnabled(chat as any, preferences as any)) return;

  await ctx.scheduler.runAfter(0, internal.chat.actions.generateAudioForMessage, {
    messageId,
  });
}

// M10 — Live tool-call streaming: progressively patch toolCalls onto a message
// so the iOS accordion appears during generation (not just after finalization).
export interface UpdateMessageToolCallsArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
}

export interface PatchMessageAudioArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  audioStorageId: Id<"_storage">;
  audioDurationMs?: number;
  audioVoice?: string;
  audioTranscript?: string;
  audioGeneratedAt?: number;
}

export async function patchMessageAudioHandler(
  ctx: MutationCtx,
  args: PatchMessageAudioArgs,
): Promise<void> {
  // Delete the previous audio storage blob if it differs from the new one,
  // to avoid orphaned blobs when audio is regenerated.
  const existing = await ctx.db.get(args.messageId);
  if (
    existing?.audioStorageId &&
    existing.audioStorageId !== args.audioStorageId
  ) {
    try {
      await ctx.storage.delete(existing.audioStorageId);
    } catch {
      // Storage blob may already be deleted — continue
    }
  }
  await ctx.db.patch(args.messageId, {
    audioStorageId: args.audioStorageId,
    audioDurationMs: args.audioDurationMs,
    audioVoice: args.audioVoice,
    audioTranscript: args.audioTranscript,
    audioGeneratedAt: args.audioGeneratedAt,
    audioGenerating: undefined,
  });
}

export async function updateMessageToolCallsHandler(
  ctx: MutationCtx,
  args: UpdateMessageToolCallsArgs,
): Promise<void> {
  const existing = await ctx.db.get(args.messageId);
  if (!existing) return;
  if (isTerminalMessageStatus(existing.status)) return;

  await upsertStreamingMessage(ctx, existing, {
    toolCalls: args.toolCalls,
  });
}

export interface UpdateJobStatusArgs extends Record<string, unknown> {
  jobId: Id<"generationJobs">;
  status:
    | "queued"
    | "streaming"
    | "completed"
    | "failed"
    | "cancelled"
    | "timedOut";
  startedAt?: number;
  error?: string;
}

export async function updateJobStatusHandler(
  ctx: MutationCtx,
  args: UpdateJobStatusArgs,
): Promise<void> {
  // Guard: never overwrite a terminal status (cancelled, completed, failed,
  // timedOut) with a non-terminal one (e.g. "streaming").  This prevents a
  // late-arriving runGeneration from reviving a job the user already cancelled.
  const existing = await ctx.db.get(args.jobId);
  if (existing) {
    const terminalStatuses = new Set(["cancelled", "completed", "failed", "timedOut"]);
    if (terminalStatuses.has(existing.status as string) && !terminalStatuses.has(args.status)) {
      return; // silently skip — job already finished
    }
  }

  const patch: Record<string, unknown> = { status: args.status };
  if (args.startedAt) patch.startedAt = args.startedAt;
  if (args.error) patch.error = args.error;
  if (
    args.status === "completed" ||
    args.status === "failed" ||
    args.status === "cancelled" ||
    args.status === "timedOut"
  ) {
    patch.completedAt = Date.now();
  }
  await ctx.db.patch(args.jobId, patch);
}

export interface IsJobCancelledArgs extends Record<string, unknown> {
  jobId: Id<"generationJobs">;
}

export async function isJobCancelledHandler(
  ctx: Pick<MutationCtx, "db">,
  args: IsJobCancelledArgs,
): Promise<boolean> {
  const job = await ctx.db.get(args.jobId);
  return !job || job.status === "cancelled";
}

export interface UpdateChatTitleArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  title: string;
}

export async function updateChatTitleHandler(
  ctx: MutationCtx,
  args: UpdateChatTitleArgs,
): Promise<void> {
  // Intentionally skip updatedAt — title generation is a background refinement
  // and should not re-sort the chat list or trigger an extra listChats cascade.
  // sendMessage already bumped updatedAt when the chat was created/sent.
  await ctx.db.patch(args.chatId, {
    title: args.title,
  });
}

export interface CreateMemoryArgs extends Record<string, unknown> {
  userId: string;
  content: string;
  category?: string;
  memoryType?: "profile" | "responsePreference" | "workContext" | "transient";
  importanceScore?: number;
  confidenceScore?: number;
  reinforcementCount?: number;
  lastReinforcedAt?: number;
  expiresAt?: number;
  supersedesMemoryId?: Id<"memories">;
  sourceMessageId?: Id<"messages">;
  sourceChatId?: Id<"chats">;
  retrievalMode?: string;
  scopeType?: string;
  personaIds?: string[];
  sourceType?: string;
  sourceFileName?: string;
  tags?: string[];
  isPending?: boolean;
  createdAt: number;
}

export async function createMemoryHandler(
  ctx: MutationCtx,
  args: CreateMemoryArgs,
): Promise<Id<"memories">> {
  const normalized = normalizeMemoryRecord({
    content: args.content,
    category: args.category,
    memoryType: args.memoryType,
    retrievalMode: args.retrievalMode,
    scopeType: args.scopeType,
    personaIds: args.personaIds,
    sourceType: args.sourceType,
    sourceFileName: args.sourceFileName,
    tags: args.tags,
    importanceScore: args.importanceScore,
  });
  return await ctx.db.insert("memories", {
    userId: args.userId,
    content: args.content,
    category: normalized.category,
    sourceMessageId: args.sourceMessageId,
    sourceChatId: args.sourceChatId,
    isPinned: false,
    isPending: args.isPending ?? false,
    accessCount: 0,
    memoryType: args.memoryType ?? "workContext",
    retrievalMode: normalized.retrievalMode,
    scopeType: normalized.scopeType,
    personaIds: normalized.personaIds,
    sourceType: normalized.sourceType,
    sourceFileName: normalized.sourceFileName,
    tags: normalized.tags,
    importanceScore: args.importanceScore ?? 0.6,
    confidenceScore: args.confidenceScore ?? 0.6,
    reinforcementCount: args.reinforcementCount ?? 1,
    lastReinforcedAt: args.lastReinforcedAt ?? args.createdAt,
    expiresAt: args.expiresAt,
    isSuperseded: false,
    supersedesMemoryId: args.supersedesMemoryId,
    createdAt: args.createdAt,
    updatedAt: args.createdAt,
  });
}

// ---------------------------------------------------------------------------
// storeGenerationUsage — called by the fetchAndStoreGenerationUsage action
// after fetching authoritative usage from the OpenRouter Generations API.
// ---------------------------------------------------------------------------

export interface StoreGenerationUsageArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  chatId: Id<"chats">;
  userId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  isByok?: boolean;
  cachedTokens?: number;
  cacheWriteTokens?: number;
  audioPromptTokens?: number;
  videoTokens?: number;
  reasoningTokens?: number;
  imageCompletionTokens?: number;
  audioCompletionTokens?: number;
  upstreamInferenceCost?: number;
  upstreamInferencePromptCost?: number;
  upstreamInferenceCompletionsCost?: number;
}

/** Helper: pick only the non-undefined optional usage detail fields from args. */
function usageDetailFields(args: StoreGenerationUsageArgs): Record<string, number | boolean | undefined> {
  return {
    isByok: args.isByok,
    cachedTokens: args.cachedTokens,
    cacheWriteTokens: args.cacheWriteTokens,
    audioPromptTokens: args.audioPromptTokens,
    videoTokens: args.videoTokens,
    reasoningTokens: args.reasoningTokens,
    imageCompletionTokens: args.imageCompletionTokens,
    audioCompletionTokens: args.audioCompletionTokens,
    upstreamInferenceCost: args.upstreamInferenceCost,
    upstreamInferencePromptCost: args.upstreamInferencePromptCost,
    upstreamInferenceCompletionsCost: args.upstreamInferenceCompletionsCost,
  };
}

export async function storeGenerationUsageHandler(
  ctx: MutationCtx,
  args: StoreGenerationUsageArgs,
): Promise<void> {
  const now = Date.now();
  const msg = await ctx.db.get(args.messageId);
  if (!msg) return;

  // Compute cost from model pricing if not provided by the API.
  let cost = args.cost;
  if (cost == null && msg.modelId) {
    const model = await ctx.db
      .query("cachedModels")
      .withIndex("by_modelId", (q) => q.eq("modelId", msg.modelId!))
      .first();
    if (model?.inputPricePer1M != null && model?.outputPricePer1M != null) {
      cost =
        (args.promptTokens * model.inputPricePer1M) / 1_000_000 +
        (args.completionTokens * model.outputPricePer1M) / 1_000_000;
    }
  }

  const details = usageDetailFields(args);

  // Patch the usage field on the message.
  await ctx.db.patch(args.messageId, {
    usage: {
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      totalTokens: args.totalTokens,
      cost,
      ...details,
    },
  });

  // Upsert the usageRecords row: insert only if one doesn't already exist for
  // this message (avoids duplicates if finalizeGeneration already wrote one).
  // IMPORTANT: filter by source === undefined to avoid overwriting ancillary
  // cost rows (title, compaction, etc.) that share the same messageId.
  const existing = await ctx.db
    .query("usageRecords")
    .withIndex("by_message", (q) => q.eq("messageId", args.messageId))
    .filter((q) => q.eq(q.field("source"), undefined))
    .first();

  if (existing) {
    await ctx.db.patch(existing._id, {
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      totalTokens: args.totalTokens,
      cost,
      ...details,
    });
  } else {
    await ctx.db.insert("usageRecords", {
      userId: args.userId,
      chatId: args.chatId,
      messageId: args.messageId,
      modelId: msg.modelId ?? "unknown",
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      totalTokens: args.totalTokens,
      cost,
      ...details,
      createdAt: now,
    });
  }
}

async function maybeScheduleChatCompletionPush(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  userId: string,
  triggerUserMessageId: Id<"messages">,
): Promise<void> {
  const [chat, prefs, pendingMessages, streamingMessages, completedMessages] =
    await Promise.all([
      ctx.db.get(chatId),
      ctx.db
        .query("userPreferences")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first(),
      ctx.db
        .query("messages")
        .withIndex("by_chat_status", (q) =>
          q.eq("chatId", chatId).eq("status", "pending"),
        )
        .collect(),
      ctx.db
        .query("messages")
        .withIndex("by_chat_status", (q) =>
          q.eq("chatId", chatId).eq("status", "streaming"),
        )
        .collect(),
      ctx.db
        .query("messages")
        .withIndex("by_chat_status", (q) =>
          q.eq("chatId", chatId).eq("status", "completed"),
        )
        .collect(),
    ]);

  if (!chat || prefs?.chatCompletionNotificationsEnabled !== true) {
    return;
  }

  const isTriggeredAssistant = (message: {
    role: string;
    parentMessageIds?: Id<"messages">[];
  }) =>
    message.role === "assistant" &&
    Array.isArray(message.parentMessageIds) &&
    message.parentMessageIds.includes(triggerUserMessageId);

  const hasInFlightTriggeredAssistant = [...pendingMessages, ...streamingMessages]
    .some(isTriggeredAssistant);
  if (hasInFlightTriggeredAssistant) {
    return;
  }

  const completedTriggeredAssistants = completedMessages.filter(
    (message) =>
      isTriggeredAssistant(message) &&
      typeof message.content === "string" &&
      message.content.trim() !== "",
  );
  if (completedTriggeredAssistants.length === 0) {
    return;
  }

  const shouldSendCompletionPush = await markChatCompletionNotifiedHandler(ctx, {
    messageId: triggerUserMessageId,
  });
  if (!shouldSendCompletionPush) {
    return;
  }

  const body = isPlaceholderTitle(chat.title)
    ? "A new reply is ready."
    : `A new reply is ready in ${chat.title}.`;
  await ctx.scheduler.runAfter(0, internal.push.actions.sendPushNotification, {
    userId,
    title: "Reply complete",
    body,
    chatId,
    category: CHAT_COMPLETION_PUSH_CATEGORY,
  });
}

// ---------------------------------------------------------------------------
// storeAncillaryCost — M23: stores usage for non-generation API calls
// (title gen, compaction, memory extraction, embeddings, search pipeline,
// subagents). Does NOT patch the message's `usage` field — that stays
// reserved for the primary generation.
// ---------------------------------------------------------------------------

export interface StoreAncillaryCostArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  chatId: Id<"chats">;
  userId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  source: string;
  generationId?: string;
}

export async function storeAncillaryCostHandler(
  ctx: MutationCtx,
  args: StoreAncillaryCostArgs,
): Promise<void> {
  const now = Date.now();

  // Compute cost from model pricing if not provided by the API.
  let cost = args.cost;
  if (cost == null) {
    const model = await ctx.db
      .query("cachedModels")
      .withIndex("by_modelId", (q) => q.eq("modelId", args.modelId))
      .first();
    if (model?.inputPricePer1M != null && model?.outputPricePer1M != null) {
      cost =
        (args.promptTokens * model.inputPricePer1M) / 1_000_000 +
        (args.completionTokens * model.outputPricePer1M) / 1_000_000;
    }
  }

  await ctx.db.insert("usageRecords", {
    userId: args.userId,
    chatId: args.chatId,
    messageId: args.messageId,
    modelId: args.modelId,
    promptTokens: args.promptTokens,
    completionTokens: args.completionTokens,
    totalTokens: args.totalTokens,
    cost,
    source: args.source,
    createdAt: now,
  });
}
