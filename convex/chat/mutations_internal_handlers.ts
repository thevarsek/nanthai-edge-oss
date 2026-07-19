import { Id } from "../_generated/dataModel";
import { MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { ConvexError } from "convex/values";
import { mapFinalMessageStatusToJobStatus } from "./lifecycle_helpers";
import { normalizeMemoryRecord } from "../memory/shared";
import { classifyTerminalErrorCode, TerminalErrorCode } from "./terminal_error";
import { isAudioBasedUserMessage, resolveAutoAudioResponseEnabled } from "./audio_shared";
import { isPlaceholderTitle } from "./title_helpers";
import { preferCurrentPresentationSnapshot } from "./presentation_generated_file_snapshot";
import {
  deleteStreamingMessageById,
  deleteStreamingMessage,
  getStreamingMessageById,
  getStreamingMessageByMessageId,
  isTerminalMessageStatus,
  patchStreamingMessageById,
  upsertStreamingMessage,
} from "./streaming_state";
import { assertCurrentFence, terminalizeExecution } from "../execution/control_plane";
import { assertCurrentExecution } from "../execution/attempts";
import { notifyScheduledStepTerminal } from "../scheduledJobs/workflow_signals";
import { assertUserDataWritable } from "../lib/write_fence";

const CHAT_COMPLETION_PUSH_CATEGORY = "CHAT_COMPLETION";

export interface UpdateMessageContentArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  streamingMessageId?: Id<"streamingMessages">;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
  content: string;
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
}

export async function updateMessageContentHandler(
  ctx: MutationCtx,
  args: UpdateMessageContentArgs,
): Promise<void> {
  if (args.executionAttemptId !== undefined && args.executionFence !== undefined) {
    await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
  }
  const existing = await ctx.db.get(args.messageId);
  if (!existing) return;
  if (isTerminalMessageStatus(existing.status)) {
    return;
  }

  if (args.streamingMessageId) {
    const streamingMessage = await getStreamingMessageById(ctx, args.streamingMessageId);
    if (streamingMessage) {
      await patchStreamingMessageById(ctx, args.streamingMessageId, {
        content: args.content,
        status: args.status,
      });
      return;
    }
  }

  await upsertStreamingMessage(ctx, existing, {
    content: args.content,
    status: args.status,
  });
}

export interface UpdateMessageReasoningArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  streamingMessageId?: Id<"streamingMessages">;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
  reasoning: string;
}

export async function updateMessageReasoningHandler(
  ctx: MutationCtx,
  args: UpdateMessageReasoningArgs,
): Promise<void> {
  if (args.executionAttemptId !== undefined && args.executionFence !== undefined) {
    await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
  }
  const existing = await ctx.db.get(args.messageId);
  if (!existing) return;
  if (isTerminalMessageStatus(existing.status)) return;

  if (args.streamingMessageId) {
    const streamingMessage = await getStreamingMessageById(ctx, args.streamingMessageId);
    if (streamingMessage) {
      await patchStreamingMessageById(ctx, args.streamingMessageId, {
        reasoning: args.reasoning,
      });
      return;
    }
  }

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
    cacheDiscount?: number;
    webSearchRequests?: number;
  };
  reasoning?: string;
  imageUrls?: string[];
  imageMimeTypes?: string[];
  imageGenerationResult?: {
    requestedCount: number;
    generatedCount: number;
    failedCount: number;
  };
  videoUrls?: string[];
  userId: string;
  /** The owned Workflow callback already terminalized the execution attempt. */
  skipExecutionTerminalization?: boolean;
  allowExpiredExecutionLease?: boolean;
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
    originalStorageId?: Id<"_storage">;
    filename: string;
    mimeType: string;
    sizeBytes?: number;
    toolName: string;
    title?: string;
    summary?: string;
    presentationProjectId?: Id<"presentationProjects">;
    presentationRevision?: number;
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
  /** M32 document citation annotations (quote-backed, version-aware). */
  documentCitations?: Array<{
    ref: number;
    documentId: Id<"documents">;
    versionId?: Id<"documentVersions">;
    filename: string;
    quote: string;
    page?: number | string;
    locator?: string;
  }>;
  documentEvents?: DocumentEvent[];
  // M26 — Lyria inline audio
  audioStorageId?: Id<"_storage">;
  audioDurationMs?: number;
  audioGeneratedAt?: number;
  triggerUserMessageId?: Id<"messages">;
  /** OpenRouter generation ID — used post-finalization to fetch authoritative usage. */
  openrouterGenerationId?: string;
  terminalErrorCode?: TerminalErrorCode;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
}

type DocumentEvent = {
  type: "document_created" | "document_updated";
  documentId: Id<"documents">;
  versionId: Id<"documentVersions">;
  storageId: Id<"_storage">;
  generatedFileId?: Id<"generatedFiles">;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  title?: string;
  summary?: string;
};

type GeneratedFileInput = NonNullable<FinalizeGenerationArgs["generatedFiles"]>[number];

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function isDocxGeneratedFile(file: GeneratedFileInput): boolean {
  return file.mimeType === DOCX_MIME_TYPE || file.filename.toLowerCase().endsWith(".docx");
}

async function nextDocumentVersionNumber(
  ctx: MutationCtx,
  documentId: Id<"documents">,
): Promise<number> {
  const latest = await ctx.db
    .query("documentVersions")
    .withIndex("by_document", (q) => q.eq("documentId", documentId))
    .order("desc")
    .first();
  return (latest?.versionNumber ?? 0) + 1;
}

async function createOrUpdateDocumentForGeneratedFile(
  ctx: MutationCtx,
  args: {
    userId: string;
    chatId: Id<"chats">;
    generatedFileId: Id<"generatedFiles">;
    file: GeneratedFileInput;
  },
): Promise<DocumentEvent | undefined> {
  if (!isDocxGeneratedFile(args.file)) return undefined;

  const now = Date.now();
  const chat = await ctx.db.get(args.chatId);
  const folderId = chat?.folderId ? chat.folderId as Id<"folders"> : undefined;

  if (args.file.toolName === "edit_docx" && args.file.originalStorageId) {
    const sourceVersion = await ctx.db
      .query("documentVersions")
      .withIndex("by_storage", (q) => q.eq("storageId", args.file.originalStorageId!))
      .first();
    const sourceDocument = sourceVersion ? await ctx.db.get(sourceVersion.documentId) : null;
    if (sourceVersion && sourceDocument && sourceDocument.userId === args.userId) {
      if (
        sourceDocument.currentVersionId &&
        sourceDocument.currentVersionId !== sourceVersion._id
      ) {
        throw new ConvexError({
          code: "SUPERSEDED_VERSION" as const,
          message: "This document changed while the edit was being prepared. Re-open the latest version and try again.",
        });
      }
      const versionNumber = await nextDocumentVersionNumber(ctx, sourceDocument._id);
      const versionId = await ctx.db.insert("documentVersions", {
        documentId: sourceDocument._id,
        userId: args.userId,
        storageId: args.file.storageId,
        filename: args.file.filename,
        mimeType: args.file.mimeType,
        versionNumber,
        source: "assistant_edit",
        parentVersionId: sourceVersion._id,
        extractionStatus: "pending",
        createdAt: now,
      });
      await ctx.db.patch(sourceDocument._id, {
        currentVersionId: versionId,
        sourceStorageId: args.file.storageId,
        generatedFileId: args.generatedFileId,
        folderId,
        status: "ready",
        updatedAt: now,
      });
      await ctx.db.patch(args.generatedFileId, {
        documentId: sourceDocument._id,
        documentVersionId: versionId,
      });
      return {
        type: "document_updated",
        documentId: sourceDocument._id,
        versionId,
        storageId: args.file.storageId,
        generatedFileId: args.generatedFileId,
        filename: args.file.filename,
        mimeType: args.file.mimeType,
        sizeBytes: args.file.sizeBytes,
        title: args.file.title ?? sourceDocument.title,
        summary: args.file.summary,
      };
    }
  }

  const documentId = await ctx.db.insert("documents", {
    userId: args.userId,
    title: args.file.title ?? args.file.filename,
    filename: args.file.filename,
    mimeType: args.file.mimeType,
    source: "generated",
    originChatId: args.chatId,
    folderId,
    sourceStorageId: args.file.storageId,
    generatedFileId: args.generatedFileId,
    status: "ready",
    createdAt: now,
    updatedAt: now,
  });
  const versionId = await ctx.db.insert("documentVersions", {
    documentId,
    userId: args.userId,
    storageId: args.file.storageId,
    filename: args.file.filename,
    mimeType: args.file.mimeType,
    versionNumber: 1,
    source: "generated",
    extractionStatus: "pending",
    createdAt: now,
  });
  await ctx.db.patch(documentId, {
    currentVersionId: versionId,
    updatedAt: now,
  });
  await ctx.db.patch(args.generatedFileId, {
    documentId,
    documentVersionId: versionId,
  });
  return {
    type: "document_created",
    documentId,
    versionId,
    storageId: args.file.storageId,
    generatedFileId: args.generatedFileId,
    filename: args.file.filename,
    mimeType: args.file.mimeType,
    sizeBytes: args.file.sizeBytes,
    title: args.file.title,
    summary: args.file.summary,
  };
}

export async function finalizeGenerationHandler(
  ctx: MutationCtx,
  args: FinalizeGenerationArgs,
): Promise<void> {
  const now = Date.now();
  const generationJob = await ctx.db.get(args.jobId);
  if (
    generationJob
    && ["completed", "failed", "cancelled", "timedOut"].includes(generationJob.status)
    && generationJob.status !== "cancelled"
  ) {
    return;
  }
  const executionAttemptId = args.executionAttemptId ?? generationJob?.executionAttemptId;
  const executionFence = args.executionFence ?? generationJob?.executionFence;
  if ((executionAttemptId === undefined) !== (executionFence === undefined)) {
    throw new Error("INCOMPLETE_EXECUTION_FENCE");
  }
  if (
    !args.skipExecutionTerminalization
    && executionAttemptId
    && executionFence !== undefined
  ) {
    if (args.allowExpiredExecutionLease) {
      await assertCurrentExecution(ctx, {
        attemptId: executionAttemptId,
        fence: executionFence,
        allowExpiredLease: true,
      });
    } else {
      await assertCurrentFence(ctx, executionAttemptId, executionFence);
    }
  }
  const shouldTreatLateTerminalResultAsCancelled =
    generationJob?.status === "cancelled"
    && (args.status === "completed" || args.status === "failed");
  const finalStatus = shouldTreatLateTerminalResultAsCancelled
    ? "cancelled"
    : args.status;
  const terminalErrorCode = classifyTerminalErrorCode({
    status: finalStatus,
    error: args.error,
    existingCode: generationJob?.terminalErrorCode ?? args.terminalErrorCode,
  });

  // Guard: if the job was already cancelled by the user, don't overwrite
  // with "completed" or "streaming" results.  We still allow overwriting
  // neither "completed" nor "failed" should revive a cancelled job.
  // Scheduled executions are resumed exclusively through the retained
  // Workflow event emitted below. A second legacy failure callback here can
  // race that event and terminalize the same occurrence twice.

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
  if (args.openrouterGenerationId) msgPatch.openrouterGenerationId = args.openrouterGenerationId;
  if (terminalErrorCode) msgPatch.terminalErrorCode = terminalErrorCode;
  const finalReasoning = args.reasoning ?? streamingMessage?.reasoning;
  if (finalReasoning) msgPatch.reasoning = finalReasoning;
  if (args.imageUrls) msgPatch.imageUrls = args.imageUrls;
  if (args.imageMimeTypes) msgPatch.imageMimeTypes = args.imageMimeTypes;
  if (args.imageGenerationResult) {
    msgPatch.imageGenerationResult = args.imageGenerationResult;
  }
  if (args.videoUrls) msgPatch.videoUrls = args.videoUrls;
  const finalToolCalls = args.toolCalls ?? streamingMessage?.toolCalls;
  if (finalToolCalls) msgPatch.toolCalls = finalToolCalls;
  if (args.toolResults) msgPatch.toolResults = args.toolResults;
  if (args.citations && args.citations.length > 0) msgPatch.citations = args.citations;
  if (args.documentCitations && args.documentCitations.length > 0) {
    msgPatch.documentCitations = args.documentCitations;
  }
  const documentEvents: DocumentEvent[] = args.documentEvents ? [...args.documentEvents] : [];

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
      const storedFile = await preferCurrentPresentationSnapshot(ctx, args.userId, file);
      const id = await ctx.db.insert("generatedFiles", {
        userId: args.userId,
        chatId: args.chatId,
        messageId: args.messageId,
        storageId: storedFile.storageId,
        filename: storedFile.filename,
        mimeType: storedFile.mimeType,
        sizeBytes: storedFile.sizeBytes,
        toolName: storedFile.toolName,
        presentationProjectId: storedFile.presentationProjectId,
        presentationRevision: storedFile.presentationRevision,
        createdAt: now,
      });
      fileIds.push(id);
      const event = await createOrUpdateDocumentForGeneratedFile(ctx, {
        userId: args.userId,
        chatId: args.chatId,
        generatedFileId: id,
        file: storedFile,
      });
      if (event) documentEvents.push(event);
    }
  }
  if (fileIds && fileIds.length > 0) msgPatch.generatedFileIds = fileIds;
  if (documentEvents.length > 0) msgPatch.documentEvents = documentEvents;

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
  if (generationJob?.streamingMessageId) {
    await deleteStreamingMessageById(ctx, generationJob.streamingMessageId);
  }
  await deleteStreamingMessage(ctx, args.messageId);

  await ctx.db.patch(args.jobId, {
    status: mapFinalMessageStatusToJobStatus(finalStatus),
    error: args.error,
    openrouterGenerationId: args.openrouterGenerationId,
    terminalErrorCode,
    completedAt: now,
    scheduledFunctionId: undefined,
  });
  if (
    !args.skipExecutionTerminalization
    && executionAttemptId
    && executionFence !== undefined
  ) {
    await terminalizeExecution(ctx, {
      attemptId: executionAttemptId,
      fence: executionFence,
      outcome: finalStatus,
      summary: args.error,
      now,
      allowExpiredLease: args.allowExpiredExecutionLease,
    });
  }

  const chat = await ctx.db.get(args.chatId);
  if (chat) {
    // Skip updatedAt — sendMessage already bumped it when the user message
    // was created, and the chat is already at the top of the list.  Patching
    // updatedAt again here would trigger a redundant listChats re-evaluation
    // across all connected clients.
    const chatPatch: Record<string, unknown> = {};
    if (finalStatus === "completed") {
      if (finalContent.trim()) {
        chatPatch.lastMessagePreview = finalContent.trim().substring(0, 200);
        chatPatch.lastMessageDate = now;
      } else if (args.videoUrls && args.videoUrls.length > 0) {
        // Video-only messages have no text content — show a descriptive preview
        chatPatch.lastMessagePreview = "Generated video";
        chatPatch.lastMessageDate = now;
      } else if (args.imageUrls && args.imageUrls.length > 0) {
        // Image-only messages (if content is empty) — show a descriptive preview
        chatPatch.lastMessagePreview = "Generated image";
        chatPatch.lastMessageDate = now;
      }
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

      // Signal the durable scheduled-execution Workflow. Events are retained
      // when generation completes before the Workflow reaches awaitEvent.
      if (generationJob?.sourceJobId && generationJob.sourceExecutionId) {
        await notifyScheduledStepTerminal(ctx, {
          jobId: generationJob.sourceJobId,
          executionId: generationJob.sourceExecutionId,
          stepIndex: generationJob.sourceStepIndex ?? 0,
          assistantMessageId: args.messageId,
          status: finalStatus,
          error: args.error,
        });
      }
    }
  }

  if (
    finalStatus === "completed" &&
    args.triggerUserMessageId
  ) {
    await maybeScheduleChatCompletionPush(
      ctx,
      args.chatId,
      args.userId,
      args.triggerUserMessageId,
      {
        _id: args.messageId,
        role: persistedMessage?.role ?? "assistant",
        parentMessageIds: persistedMessage?.parentMessageIds,
        content: finalContent,
        imageUrls: args.imageUrls ?? persistedMessage?.imageUrls,
        videoUrls: args.videoUrls ?? persistedMessage?.videoUrls,
        audioStorageId: args.audioStorageId ?? persistedMessage?.audioStorageId,
      },
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
    cacheDiscount: args.usage.cacheDiscount,
    webSearchRequests: args.usage.webSearchRequests,
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
  if (!isAudioBasedUserMessage(triggerMessage)) return;

  const preferences = await ctx.db
    .query("userPreferences")
    .withIndex("by_user", (q) => q.eq("userId", chat.userId))
    .first();
  if (!resolveAutoAudioResponseEnabled(chat, preferences)) return;

  await ctx.scheduler.runAfter(0, internal.chat.actions.generateAudioForMessage, {
    messageId,
  });
}

// M10 — Live tool-call streaming: progressively patch toolCalls onto a message
// so the iOS accordion appears during generation (not just after finalization).
export interface UpdateMessageToolCallsArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
  streamingMessageId?: Id<"streamingMessages">;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
  activeToolCallIds?: string[];
  toolResults?: Array<{
    toolCallId: string;
    toolName: string;
    result: string;
    isError?: boolean;
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
  if (args.executionAttemptId !== undefined && args.executionFence !== undefined) {
    await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
  }
  const existing = await ctx.db.get(args.messageId);
  if (!existing) return;
  if (isTerminalMessageStatus(existing.status)) return;

  if (args.streamingMessageId) {
    const streamingMessage = await getStreamingMessageById(ctx, args.streamingMessageId);
    if (streamingMessage) {
      await patchStreamingMessageById(ctx, args.streamingMessageId, {
        toolCalls: args.toolCalls,
        activeToolCallIds: args.activeToolCallIds,
        toolResults: args.toolResults,
      });
      return;
    }
  }

  await upsertStreamingMessage(ctx, existing, {
    toolCalls: args.toolCalls,
    activeToolCallIds: args.activeToolCallIds,
    toolResults: args.toolResults,
  });
}

export interface UpdateJobStatusArgs extends Record<string, unknown> {
  jobId: Id<"generationJobs">;
  messageId?: Id<"messages">;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
  status:
    | "queued"
    | "streaming"
    | "completed"
    | "failed"
    | "cancelled"
  | "timedOut";
  startedAt?: number;
  analyticsStartedAt?: number;
  error?: string;
  openrouterGenerationId?: string;
  terminalErrorCode?: TerminalErrorCode;
}

export async function updateJobStatusHandler(
  ctx: MutationCtx,
  args: UpdateJobStatusArgs,
): Promise<void> {
  if (args.executionAttemptId !== undefined && args.executionFence !== undefined) {
    await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
  }
  // Guard: never overwrite a terminal status (cancelled, completed, failed,
  // timedOut) with a non-terminal one (e.g. "streaming").  This prevents a
  // late-arriving runGeneration from reviving a job the user already cancelled.
  const existing = await ctx.db.get(args.jobId);
  if (existing) {
    if (args.messageId && existing.messageId && existing.messageId !== args.messageId) {
      throw new ConvexError({
        code: "VALIDATION" as const,
        message: "messageId does not match the generation job",
      });
    }
    const terminalStatuses = new Set(["cancelled", "completed", "failed", "timedOut"]);
    if (terminalStatuses.has(existing.status as string) && !terminalStatuses.has(args.status)) {
      return; // silently skip — job already finished
    }
  }

  const patch: Record<string, unknown> = { status: args.status };
  if (args.startedAt) patch.startedAt = args.startedAt;
  if (args.analyticsStartedAt) patch.analyticsStartedAt = args.analyticsStartedAt;
  if (args.error) patch.error = args.error;
  if (args.openrouterGenerationId) patch.openrouterGenerationId = args.openrouterGenerationId;
  if (args.terminalErrorCode) patch.terminalErrorCode = args.terminalErrorCode;
  if (
    args.status === "completed" ||
    args.status === "failed" ||
    args.status === "cancelled" ||
    args.status === "timedOut"
  ) {
    patch.completedAt = Date.now();
  }
  await ctx.db.patch(args.jobId, patch);
  if (args.messageId && (args.openrouterGenerationId || args.terminalErrorCode)) {
    const messagePatch: Record<string, unknown> = {};
    if (args.openrouterGenerationId) {
      messagePatch.openrouterGenerationId = args.openrouterGenerationId;
    }
    if (args.terminalErrorCode) {
      messagePatch.terminalErrorCode = args.terminalErrorCode;
    }
    await ctx.db.patch(args.messageId, messagePatch);
  }
}

export interface IsJobCancelledArgs extends Record<string, unknown> {
  jobId: Id<"generationJobs">;
}

export async function isJobCancelledHandler(
  ctx: Pick<QueryCtx, "db">,
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
  const chat = await ctx.db.get(args.chatId);
  if (!chat) return;
  await assertUserDataWritable(ctx, chat.userId, chat._id);
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
  await assertUserDataWritable(ctx, args.userId, args.sourceChatId);
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

interface UsageDetailFieldArgs {
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
  cacheDiscount?: number;
  webSearchRequests?: number;
}

export interface StoreGenerationUsageArgs extends Record<string, unknown>, UsageDetailFieldArgs {
  messageId: Id<"messages">;
  chatId: Id<"chats">;
  userId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Helper: pick only the non-undefined optional usage detail fields from args. */
function usageDetailFields(args: UsageDetailFieldArgs): Record<string, number | boolean | undefined> {
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
    cacheDiscount: args.cacheDiscount,
    webSearchRequests: args.webSearchRequests,
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
  currentFinalizedMessage?: {
    _id: Id<"messages">;
    role: string;
    parentMessageIds?: Id<"messages">[];
    content?: string;
    imageUrls?: string[];
    videoUrls?: string[];
    audioStorageId?: Id<"_storage">;
  },
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
      ((typeof message.content === "string" && message.content.trim() !== "") ||
        (Array.isArray(message.imageUrls) && message.imageUrls.length > 0) ||
        (Array.isArray(message.videoUrls) && message.videoUrls.length > 0) ||
        typeof message.audioStorageId === "string"),
  );
  const currentFinalizedTriggeredAssistant = currentFinalizedMessage &&
    isTriggeredAssistant(currentFinalizedMessage) &&
    ((typeof currentFinalizedMessage.content === "string" && currentFinalizedMessage.content.trim() !== "") ||
      (Array.isArray(currentFinalizedMessage.imageUrls) && currentFinalizedMessage.imageUrls.length > 0) ||
      (Array.isArray(currentFinalizedMessage.videoUrls) && currentFinalizedMessage.videoUrls.length > 0) ||
      typeof currentFinalizedMessage.audioStorageId === "string");

  if (completedTriggeredAssistants.length === 0 && !currentFinalizedTriggeredAssistant) {
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

export interface StoreAncillaryCostArgs extends Record<string, unknown>, UsageDetailFieldArgs {
  messageId: Id<"messages">;
  chatId: Id<"chats">;
  userId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  source: string;
  generationId?: string;
  idempotencyKey?: string;
}

export async function storeAncillaryCostHandler(
  ctx: MutationCtx,
  args: StoreAncillaryCostArgs,
): Promise<void> {
  const now = Date.now();

  if (args.idempotencyKey) {
    const existing = await ctx.db
      .query("usageRecords")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .first();
    if (existing) return;
  }

  if (args.generationId) {
    const existing = await ctx.db
      .query("usageRecords")
      .withIndex("by_generation_source", (q) => q
        .eq("generationId", args.generationId)
        .eq("source", args.source))
      .first();
    if (existing) return;
  }

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

  const details = usageDetailFields(args);

  await ctx.db.insert("usageRecords", {
    userId: args.userId,
    chatId: args.chatId,
    messageId: args.messageId,
    modelId: args.modelId,
    promptTokens: args.promptTokens,
    completionTokens: args.completionTokens,
    totalTokens: args.totalTokens,
    cost,
    ...details,
    source: args.source,
    generationId: args.generationId,
    idempotencyKey: args.idempotencyKey,
    createdAt: now,
  });
}
