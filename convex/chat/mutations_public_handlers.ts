import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import { ConvexError } from "convex/values";
import { requireAuth, requirePro, getIsProUnlocked } from "../lib/auth";
import { assertRateLimit } from "../lib/rate_limit";
import { validateSameModality } from "../lib/modality_utils";
import { filterParticipantToolOptions } from "../lib/tool_capability";
import { MODEL_IDS } from "../lib/model_constants";
import { isTerminalSubagentStatus } from "../subagents/shared";
import { requestAudioGenerationHandler as requestAudioGenerationImpl } from "./audio_public_handlers";
import { isAudioAttachment } from "./audio_shared";
import { patchStreamingMessageStatus } from "./streaming_state";
import { buildSeedTitle, isPlaceholderTitle } from "./title_helpers";
import { cancelGenerationContinuationHandler } from "./mutations_generation_continuation_handlers";
import {
  createAssistantMessagesAndJobs,
  mapParticipantsForGeneration,
  normalizeMessageAttachments,
  normalizeParticipants,
  resolveParentMessageIdsForSend,
  SendParticipantConfig,
} from "./mutation_send_helpers";

const DEFAULT_CHAT_MODEL = MODEL_IDS.appDefault;

export interface CreateChatArgs extends Record<string, unknown> {
  title?: string;
  mode: "chat" | "ideascape";
  folderId?: string;
  participants?: SendParticipantConfig[];
}

export async function createChatHandler(
  ctx: MutationCtx,
  args: CreateChatArgs,
): Promise<Id<"chats">> {
  const { userId } = await requireAuth(ctx);
  const now = Date.now();
  const chatId = await ctx.db.insert("chats", {
    userId,
    title: args.title ?? "New conversation",
    mode: args.mode,
    folderId: args.folderId,
    createdAt: now,
    updatedAt: now,
  });

  // When participants is explicitly provided (web), normalize and insert them
  // atomically. When undefined (iOS/Android), skip — those clients add
  // participants separately via addParticipant after chat creation.
  const participants = args.participants != null
    ? normalizeParticipants(args.participants, DEFAULT_CHAT_MODEL).slice(0, 3)
    : [];

  if (participants.length > 0) {
    for (let index = 0; index < participants.length; index += 1) {
      const participant = participants[index];
      await ctx.db.insert("chatParticipants", {
        chatId,
        userId,
        modelId: participant.modelId,
        personaId: participant.personaId ?? undefined,
        personaName: participant.personaName ?? undefined,
        personaEmoji: participant.personaEmoji ?? undefined,
        personaAvatarImageUrl: participant.personaAvatarImageUrl ?? undefined,
        sortOrder: index,
        createdAt: now,
      });
    }
  }

  return chatId;
}

export async function createUploadUrlHandler(ctx: MutationCtx): Promise<string> {
  await requireAuth(ctx);
  return await ctx.storage.generateUploadUrl();
}

export interface SendMessageAttachment {
  type: string;
  url?: string;
  storageId?: Id<"_storage">;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface SendMessageArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  text: string;
  recordedAudio?: {
    storageId: Id<"_storage">;
    transcript: string;
    durationMs?: number;
    mimeType?: string;
  };
  attachments?: SendMessageAttachment[];
  participants: SendParticipantConfig[];
  explicitParentIds?: Id<"messages">[];
  expandMultiModelGroups?: boolean;
  webSearchEnabled?: boolean;
  // M9 — Internet Search
  searchMode?: "normal" | "web";
  complexity?: number;
  // M10 Phase B — integration toggles (e.g. ["gmail", "drive", "calendar"])
  enabledIntegrations?: string[];
  subagentsEnabled?: boolean;
  // M29 — Video generation config
  videoConfig?: {
    resolution?: string;
    aspectRatio?: string;
    duration?: number;
    generateAudio?: boolean;
  };
}

export interface SendMessageResult {
  userMessageId: Id<"messages">;
  assistantMessageIds: Id<"messages">[];
}

export async function sendMessageHandler(
  ctx: MutationCtx,
  args: SendMessageArgs,
): Promise<SendMessageResult> {
  const { userId } = await requireAuth(ctx);
  const now = Date.now();

  // Parallel batch 1: rate-limit check, chat fetch, and attachment normalization
  // are independent after auth — run concurrently to reduce sequential reads.
  const [, chat, normalizedAttachments] = await Promise.all([
    assertRateLimit(ctx, userId),
    ctx.db.get(args.chatId),
    normalizeMessageAttachments(ctx, args.attachments),
  ]);
  if (!chat || chat.userId !== userId) {
    throw new ConvexError({ code: "NOT_FOUND" as const, message: "Chat not found" });
  }

  const trimmedText = args.text.trim();
  if (
    !trimmedText &&
    (!args.attachments || args.attachments.length === 0) &&
    !args.recordedAudio
  ) {
    throw new ConvexError({ code: "VALIDATION" as const, message: "Empty input" });
  }

  const effectiveSearchMode = args.searchMode ?? undefined;
  const effectiveComplexity = Math.max(1, Math.min(3, Math.round(args.complexity ?? 1)));

  if (
    effectiveSearchMode === "web" &&
    effectiveComplexity === 3 &&
    (normalizedAttachments?.length ?? 0) > 0
  ) {
    throw new ConvexError({ code: "VALIDATION" as const, message: "Complexity 3 search does not support attachments." });
  }

  const participants = normalizeParticipants(
    args.participants,
    DEFAULT_CHAT_MODEL,
  );

  // M29: Enforce same-modality constraint when multiple participants are present.
  if (participants.length > 1) {
    const modelIds = participants.map((p) => p.modelId);
    try {
      await validateSameModality(ctx, modelIds);
    } catch (e: unknown) {
      throw new ConvexError({
        code: "VALIDATION" as const,
        message: e instanceof Error ? e.message : "Models must share the same output modality.",
      });
    }
  }

  const hasPersona = participants.some((p) => p.personaId);
  const requestedSubagents = args.subagentsEnabled === true && participants.length === 1;
  const requiresPro = args.searchMode === "web" || hasPersona || requestedSubagents;

  // Parallel batch 2: parent resolution and Pro check are independent after
  // chat is loaded — run concurrently.
  const expandMultiModelGroups = args.expandMultiModelGroups ?? true;
  const [parentMessageIds, isPro] = await Promise.all([
    resolveParentMessageIdsForSend(ctx, {
      chatId: args.chatId,
      activeBranchLeafId: chat.activeBranchLeafId,
      explicitParentIds: args.explicitParentIds,
      expandMultiModelGroups,
    }),
    requiresPro ? getIsProUnlocked(ctx, userId) : Promise.resolve(false),
  ]);

  const effectiveSubagentsEnabled = requestedSubagents && isPro;
  if ((args.searchMode === "web" || hasPersona) && !isPro) {
    await requirePro(ctx, userId);
  }

  // Silently strip tool-dependent features when any participant model
  // lacks tool support ("always on" = "always on where supported").
  const toolFilter = await filterParticipantToolOptions(ctx, {
    enabledIntegrations: args.enabledIntegrations,
    participants,
    requireToolUse: effectiveSubagentsEnabled,
  });
  const effectiveIntegrations = toolFilter.enabledIntegrations;
  const effectiveSubagents = toolFilter.strippedModelIds.length > 0
    ? false
    : effectiveSubagentsEnabled;

  const audioAttachmentCount = normalizedAttachments?.filter((attachment) =>
    isAudioAttachment(attachment),
  ).length ?? 0;
  if (args.recordedAudio && audioAttachmentCount > 0) {
    throw new ConvexError({ code: "VALIDATION" as const, message: "Choose one audio source before sending." });
  }
  const audioTranscript =
    args.recordedAudio?.transcript?.trim() ||
    (audioAttachmentCount > 0 ? trimmedText : undefined);

  const userMessageId = await ctx.db.insert("messages", {
    chatId: args.chatId,
    userId,
    role: "user",
    content: trimmedText,
    parentMessageIds,
    status: "completed",
    audioStorageId: args.recordedAudio?.storageId,
    audioTranscript,
    audioDurationMs: args.recordedAudio?.durationMs,
    attachments: normalizedAttachments,
    createdAt: now,
  });

  // Populate fileAttachments lookup table for KB queries (avoids O(chats×messages) scans)
  if (normalizedAttachments && normalizedAttachments.length > 0) {
    for (const att of normalizedAttachments) {
      if (att.storageId) {
        await ctx.db.insert("fileAttachments", {
          userId,
          chatId: args.chatId,
          messageId: userMessageId,
          storageId: att.storageId,
          filename: att.name ?? "attachment",
          mimeType: att.mimeType ?? "application/octet-stream",
          sizeBytes: att.sizeBytes,
          createdAt: now,
        });
      }
    }
  }

  const { assistantMessageIds, generationJobIds } =
    await createAssistantMessagesAndJobs(ctx, {
      chatId: args.chatId,
      userId,
      participants,
      parentMessageIds: [userMessageId],
      assistantCreatedAt: now + 1,
      jobCreatedAt: now,
      enabledIntegrations: effectiveIntegrations,
      subagentsEnabled: effectiveSubagents,
    });

  const shouldSeedTitle =
    (chat.messageCount ?? 0) === 0 &&
    trimmedText.length > 0 &&
    isPlaceholderTitle(chat.title);
  const seededTitle = shouldSeedTitle ? buildSeedTitle(trimmedText) : "";

  const chatPatch: Record<string, unknown> = {
    updatedAt: now,
    lastMessageDate: now,
    // P1-5: Don't write lastMessagePreview here — finalizeGeneration overwrites
    // it moments later with the AI response, causing OCC contention on the chats
    // document. The seed title + messageCount updates are sufficient.
    messageCount: (chat.messageCount ?? 0) + 1 + assistantMessageIds.length,
    activeBranchLeafId: assistantMessageIds[0],
  };
  if (seededTitle) {
    chatPatch.title = seededTitle;
  }
  await ctx.db.patch(chat._id, chatPatch);

  if ((chat.messageCount ?? 0) === 0 && trimmedText.length > 0) {
    const prefs = await ctx.db
      .query("userPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const configuredTitleModel = prefs?.titleModelId?.trim() || undefined;

    await ctx.scheduler.runAfter(0, internal.chat.actions.generateTitle, {
      chatId: args.chatId,
      sourceContent: trimmedText,
      assistantContent: undefined,
      titleModel: configuredTitleModel,
      seedTitle: seededTitle || undefined,
      userId,
      messageId: assistantMessageIds[0], // M23: cost attribution
    });
  }

  // ─── M9 BRANCH POINT ───
  // Path A (no search) or Path B (normal search) → runGeneration
  // Path C (web search) → create searchSession per participant + runWebSearch
  if (!effectiveSearchMode || effectiveSearchMode === "normal") {
    // Path A or Path B: schedule runGeneration for all participants
    const forceWebSearch =
      effectiveSearchMode === "normal" ? true : (args.webSearchEnabled ?? false);

    await ctx.scheduler.runAfter(0, internal.chat.actions.runGeneration, {
      chatId: args.chatId,
      userMessageId,
      assistantMessageIds,
      generationJobIds,
      participants: mapParticipantsForGeneration(
        participants,
        assistantMessageIds,
        generationJobIds,
      ),
      userId,
      expandMultiModelGroups,
      webSearchEnabled: forceWebSearch,
      enabledIntegrations: effectiveIntegrations,
      subagentsEnabled: effectiveSubagents,
      videoConfig: args.videoConfig,
    });
  } else if (effectiveSearchMode === "web") {
    // Path C: Web Search — create searchSession + schedule runWebSearch per participant
    const mappedParticipants = mapParticipantsForGeneration(
      participants,
      assistantMessageIds,
      generationJobIds,
    );
    const trimmedQuery = args.text.trim();

    for (const participant of mappedParticipants) {
      const sessionId = await ctx.db.insert("searchSessions", {
        chatId: args.chatId,
        userId,
        assistantMessageId: participant.messageId,
        query: trimmedQuery,
        mode: "web",
        complexity: effectiveComplexity,
        status: effectiveComplexity === 1 ? "searching" : "planning",
        progress: 0,
        currentPhase: effectiveComplexity === 1 ? "searching" : "planning",
        phaseOrder: 0,
        participantId: participant.personaId ?? undefined,
        startedAt: now,
      });

      // Link assistant message to search session
      await ctx.db.patch(participant.messageId, { searchSessionId: sessionId });

      await ctx.scheduler.runAfter(
        0,
        internal.search.actions.runWebSearch,
        {
          sessionId,
          assistantMessageId: participant.messageId,
          jobId: participant.jobId,
          chatId: args.chatId,
          userMessageId,
          userId,
          query: trimmedQuery,
          complexity: effectiveComplexity,
          expandMultiModelGroups,
          // Participant model config for synthesis step
          modelId: participant.modelId,
          personaId: participant.personaId ?? undefined,
          systemPrompt: participant.systemPrompt ?? undefined,
          temperature: participant.temperature,
          maxTokens: participant.maxTokens,
          includeReasoning: participant.includeReasoning,
          reasoningEffort: participant.reasoningEffort ?? undefined,
          // M10: Pass tool/integration config so post-search synthesis can use tools
          enabledIntegrations: effectiveIntegrations,
          subagentsEnabled: effectiveSubagents,
        },
      );
    }
  }

  return { userMessageId, assistantMessageIds };
}

export interface CancelGenerationArgs extends Record<string, unknown> {
  jobId: Id<"generationJobs">;
}

export async function requestAudioGenerationHandler(
  ctx: MutationCtx,
  args: { messageId: Id<"messages"> },
): Promise<{ scheduled: true }> {
  return await requestAudioGenerationImpl(ctx, args);
}

export async function cancelGenerationHandler(
  ctx: MutationCtx,
  args: CancelGenerationArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);

  const job = await ctx.db.get(args.jobId);
  if (!job || job.userId !== userId) {
    throw new ConvexError({ code: "NOT_FOUND" as const, message: "Job not found" });
  }

  if (job.status === "completed" || job.status === "failed") {
    return;
  }

  await cancelGenerationContinuationHandler(ctx, {
    jobId: args.jobId,
  });
  await ctx.db.patch(args.jobId, {
    status: "cancelled",
    completedAt: Date.now(),
    scheduledFunctionId: undefined,
  });

  const message = await ctx.db.get(job.messageId);
  if (message && message.status !== "completed") {
    await ctx.db.patch(job.messageId, { status: "cancelled" });
    await patchStreamingMessageStatus(ctx, job.messageId, "cancelled");

    const batch = await ctx.db
      .query("subagentBatches")
      .withIndex("by_parent_message", (q) => q.eq("parentMessageId", job.messageId))
      .first();
    if (batch && batch.status !== "completed" && batch.status !== "failed") {
      const now = Date.now();
      await ctx.db.patch(batch._id, { status: "cancelled", updatedAt: now });
      const runs = await ctx.db
        .query("subagentRuns")
        .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
        .collect();
      for (const run of runs) {
        if (isTerminalSubagentStatus(run.status)) {
          continue;
        }
        await ctx.db.patch(run._id, {
          status: "cancelled",
          completedAt: now,
          updatedAt: now,
        });
      }
    }

    // Also cancel the search session linked to this message (if any).
    if (message.searchSessionId) {
      const session = await ctx.db.get(message.searchSessionId);
      if (
        session &&
        session.status !== "completed" &&
        session.status !== "failed" &&
        session.status !== "cancelled"
      ) {
        await ctx.db.patch(session._id, {
          status: "cancelled",
          currentPhase: "cancelled",
          completedAt: Date.now(),
        });
      }
    }
  }
}

// MARK: - Cancel Active Generation (by chatId)

export interface CancelActiveGenerationArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
}

/**
 * Cancel all active (queued/streaming) generation jobs for a chat.
 * Used by the iOS client to interrupt the current stream before sending
 * a queued follow-up message.
 */
export async function cancelActiveGenerationHandler(
  ctx: MutationCtx,
  args: CancelActiveGenerationArgs,
): Promise<{ cancelledCount: number }> {
  const { userId } = await requireAuth(ctx);

  const chat = await ctx.db.get(args.chatId);
  if (!chat || chat.userId !== userId) {
    throw new ConvexError({ code: "NOT_FOUND" as const, message: "Chat not found" });
  }

  const now = Date.now();
  let cancelledCount = 0;

  // Cancel queued jobs
  const queuedJobs = await ctx.db
    .query("generationJobs")
    .withIndex("by_chat_status", (q) =>
      q.eq("chatId", args.chatId).eq("status", "queued"),
    )
    .collect();

  for (const job of queuedJobs) {
    await cancelGenerationContinuationHandler(ctx, {
      jobId: job._id,
    });
    await ctx.db.patch(job._id, {
      status: "cancelled",
      completedAt: now,
      scheduledFunctionId: undefined,
    });
    const message = await ctx.db.get(job.messageId);
    if (message && message.status !== "completed") {
      await ctx.db.patch(job.messageId, { status: "cancelled" });
      await patchStreamingMessageStatus(ctx, job.messageId, "cancelled");
    }
    const batch = await ctx.db
      .query("subagentBatches")
      .withIndex("by_parent_message", (q) => q.eq("parentMessageId", job.messageId))
      .first();
    if (batch && batch.status !== "completed" && batch.status !== "failed") {
      await ctx.db.patch(batch._id, { status: "cancelled", updatedAt: now });
      const runs = await ctx.db
        .query("subagentRuns")
        .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
        .collect();
      for (const run of runs) {
        if (isTerminalSubagentStatus(run.status)) {
          continue;
        }
        await ctx.db.patch(run._id, {
          status: "cancelled",
          completedAt: now,
          updatedAt: now,
        });
      }
    }
    cancelledCount++;
  }

  // Cancel streaming jobs
  const streamingJobs = await ctx.db
    .query("generationJobs")
    .withIndex("by_chat_status", (q) =>
      q.eq("chatId", args.chatId).eq("status", "streaming"),
    )
    .collect();

  for (const job of streamingJobs) {
    await cancelGenerationContinuationHandler(ctx, {
      jobId: job._id,
    });
    await ctx.db.patch(job._id, {
      status: "cancelled",
      completedAt: now,
      scheduledFunctionId: undefined,
    });
    const message = await ctx.db.get(job.messageId);
    if (message && message.status !== "completed") {
      await ctx.db.patch(job.messageId, { status: "cancelled" });
      await patchStreamingMessageStatus(ctx, job.messageId, "cancelled");
    }
    const batch = await ctx.db
      .query("subagentBatches")
      .withIndex("by_parent_message", (q) => q.eq("parentMessageId", job.messageId))
      .first();
    if (batch && batch.status !== "completed" && batch.status !== "failed") {
      await ctx.db.patch(batch._id, { status: "cancelled", updatedAt: now });
      const runs = await ctx.db
        .query("subagentRuns")
        .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
        .collect();
      for (const run of runs) {
        if (isTerminalSubagentStatus(run.status)) {
          continue;
        }
        await ctx.db.patch(run._id, {
          status: "cancelled",
          completedAt: now,
          updatedAt: now,
        });
      }
    }
    cancelledCount++;
  }

  // Cancel any active search sessions linked to this chat.
  // Active = any non-terminal status (not completed/failed/cancelled).
  const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
  const chatSearchSessions = await ctx.db
    .query("searchSessions")
    .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
    .collect();
  for (const session of chatSearchSessions) {
    if (!terminalStatuses.has(session.status)) {
      await ctx.db.patch(session._id, {
        status: "cancelled",
        currentPhase: "cancelled",
        completedAt: now,
      });
    }
  }

  return { cancelledCount };
}

// MARK: - Knowledge Base

export interface DeleteKnowledgeBaseFileArgs extends Record<string, unknown> {
  storageId: Id<"_storage">;
  source: "upload" | "generated";
}

/**
 * Delete a file from the Knowledge Base.
 *
 * For "generated" files: deletes the `generatedFiles` row, removes the ID
 * from the parent message's `generatedFileIds`, and deletes the storage blob.
 *
 * For "upload" files: removes the attachment entry from the parent message's
 * `attachments` array and deletes the storage blob.
 */
export async function deleteKnowledgeBaseFileHandler(
  ctx: MutationCtx,
  args: DeleteKnowledgeBaseFileArgs,
): Promise<void> {
  const { userId } = await requireAuth(ctx);

  if (args.source === "generated") {
    // Find the generatedFiles row by storageId (indexed, O(1))
    const file = await ctx.db
      .query("generatedFiles")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();

    if (!file || file.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "File not found or not owned by user." });
    }

    // Remove from parent message's generatedFileIds
    const message = await ctx.db.get(file.messageId);
    if (message) {
      const updatedIds = (message.generatedFileIds ?? []).filter(
        (id) => id !== file._id,
      );
      await ctx.db.patch(file.messageId, { generatedFileIds: updatedIds });
    }

    // Delete the generatedFiles row
    await ctx.db.delete(file._id);

    // Delete the storage blob
    await ctx.storage.delete(args.storageId);
  } else {
    // source === "upload"
    // Look up the fileAttachments row by storageId (indexed, O(1))
    const fileAtt = await ctx.db
      .query("fileAttachments")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();

    if (!fileAtt || fileAtt.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Attachment not found or not owned by user." });
    }

    // Also remove the attachment entry from the parent message
    const msg = await ctx.db.get(fileAtt.messageId);
    if (msg && msg.attachments) {
      const idx = msg.attachments.findIndex(
        (a) => a.storageId === args.storageId,
      );
      if (idx !== -1) {
        const updatedAttachments = [...msg.attachments];
        updatedAttachments.splice(idx, 1);
        await ctx.db.patch(msg._id, { attachments: updatedAttachments });
      }
    }

    // Delete the lookup row
    await ctx.db.delete(fileAtt._id);

    // Delete the storage blob
    await ctx.storage.delete(args.storageId);
  }
}
