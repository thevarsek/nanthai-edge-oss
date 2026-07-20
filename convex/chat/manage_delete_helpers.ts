import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  deleteDriveGrantCacheForStorage,
  storageHasOtherFileAttachmentReferences,
} from "../lib/file_attachments";
import { deleteChatAdvisorDataBatch } from "./manage_advisor_delete_helpers";
import { deleteChatPresentationDataBatch } from
  "./manage_delete_presentation_helpers";
import { deleteGeneratedMediaForChatBatch } from "./manage_generated_media_helpers";
import { deleteChatExecutionBatch } from "../execution/chat_cleanup";
import { deleteForChatBatch as deleteAnalyticsForChatBatch } from "../analytics_workflows/cleanup";
import {
  storageHasContentReferences,
} from "../knowledge_base/delete_helpers";
import { deleteDocumentVersionsForChatDocument } from "./manage_delete_document_helpers";

// Maximum deletes per batch to stay well within Convex transaction limits.
// Each row deletion touches at most ~2 documents (the row + index entries).
// This function touches many independent child tables in one transaction.
// Keep each table slice tiny so the aggregate mutation remains bounded.
const DELETE_BATCH_SIZE = 5;
// Generated-media deletion also drains canonical document/version state and
// performs shared-storage reference checks per row, so keep this batch much
// smaller than simple row-only tables.
const GENERATED_MEDIA_DELETE_BATCH_SIZE = 2;
const ANALYTICS_DELETE_BATCH_SIZE = 2;

/**
 * Deletes a Convex storage blob for an audio message only if no other message
 * references the same storage ID.  This prevents chat-copy (fork) flows from
 * losing audio: buildCopiedMessageInsert copies audioStorageId verbatim so
 * both chats share the blob until one is deleted.
 */
export async function safeDeleteAudioBlob(
  ctx: MutationCtx,
  audioStorageId: Id<"_storage">,
  excludeMessageId?: Id<"messages">,
): Promise<void> {
  const refs = await ctx.db
    .query("messages")
    .withIndex("by_audio_storage", (q) => q.eq("audioStorageId", audioStorageId))
    .take(2);
  const otherRefs = refs.filter((m) => m._id !== excludeMessageId);
  if (otherRefs.length > 0) {
    // Another message still uses this blob — leave it in storage.
    return;
  }
  try {
    await ctx.storage.delete(audioStorageId);
  } catch {
    // Storage blob may already be deleted — continue cleanup
  }
}

export async function deleteChatGraph(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  deletedParentResidue = false,
): Promise<void> {
  // Batched deletion: process up to DELETE_BATCH_SIZE rows per table.
  // If any table had remaining rows, schedule a continuation mutation
  // to keep draining until the chat graph is fully removed.
  let hasMore = false;

  hasMore = await deleteChatAdvisorDataBatch(ctx, chatId, DELETE_BATCH_SIZE);
  hasMore = await deleteChatPresentationDataBatch(ctx, chatId) || hasMore;
  hasMore = await deleteChatExecutionBatch(ctx, chatId, DELETE_BATCH_SIZE) || hasMore;

  hasMore = await deleteAnalyticsForChatBatch(
    ctx,
    chatId,
    ANALYTICS_DELETE_BATCH_SIZE,
  ) || hasMore;

  const streamingMessages = await ctx.db
    .query("streamingMessages")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const streaming of streamingMessages) await ctx.db.delete(streaming._id);
  if (streamingMessages.length === DELETE_BATCH_SIZE) hasMore = true;

  const videoUploads = await ctx.db
    .query("videoOutputUploads")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const upload of videoUploads) {
    if (upload.storageId) {
      if (!await storageHasContentReferences(ctx, upload.storageId)) {
        await ctx.storage.delete(upload.storageId).catch(() => undefined);
      }
    }
    await ctx.db.delete(upload._id);
  }
  if (videoUploads.length === DELETE_BATCH_SIZE) hasMore = true;

  const videoJobs = await ctx.db
    .query("videoJobs")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const job of videoJobs) await ctx.db.delete(job._id);
  if (videoJobs.length === DELETE_BATCH_SIZE) hasMore = true;

  const drivePickerBatches = await ctx.db
    .query("drivePickerBatches")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const batch of drivePickerBatches) await ctx.db.delete(batch._id);
  if (drivePickerBatches.length === DELETE_BATCH_SIZE) hasMore = true;

  const queryEmbeddings = await ctx.db
    .query("messageQueryEmbeddings")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const embedding of queryEmbeddings) await ctx.db.delete(embedding._id);
  if (queryEmbeddings.length === DELETE_BATCH_SIZE) hasMore = true;

  const memoryContexts = await ctx.db
    .query("messageMemoryContexts")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const context of memoryContexts) await ctx.db.delete(context._id);
  if (memoryContexts.length === DELETE_BATCH_SIZE) hasMore = true;

  const continuations = await ctx.db
    .query("generationContinuations")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const continuation of continuations) {
    if (continuation.scheduledFunctionId) {
      await ctx.scheduler.cancel(continuation.scheduledFunctionId).catch(() => undefined);
    }
    await ctx.db.delete(continuation._id);
  }
  if (continuations.length === DELETE_BATCH_SIZE) hasMore = true;

  const roundJournal = await ctx.db
    .query("generationRoundJournal")
    .withIndex("by_chat_updated", (query) => query.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const round of roundJournal) await ctx.db.delete(round._id);
  if (roundJournal.length === DELETE_BATCH_SIZE) hasMore = true;

  const contextAssemblyLogs = await ctx.db
    .query("contextAssemblyLogs")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const log of contextAssemblyLogs) await ctx.db.delete(log._id);
  if (contextAssemblyLogs.length === DELETE_BATCH_SIZE) hasMore = true;

  const toolMemories = await ctx.db
    .query("toolMemories")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const memory of toolMemories) await ctx.db.delete(memory._id);
  if (toolMemories.length === DELETE_BATCH_SIZE) hasMore = true;

  const toolArtifacts = await ctx.db
    .query("toolExecutionArtifacts")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const artifact of toolArtifacts) {
    if (artifact.argumentsStorageId) {
      await ctx.storage.delete(artifact.argumentsStorageId).catch(() => undefined);
    }
    if (artifact.resultStorageId) {
      await ctx.storage.delete(artifact.resultStorageId).catch(() => undefined);
    }
    await ctx.db.delete(artifact._id);
  }
  if (toolArtifacts.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Messages (heaviest table — likely to hit limits first) ---
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);

  for (const message of messages) {
    if (message.audioStorageId) {
      await safeDeleteAudioBlob(ctx, message.audioStorageId, message._id);
    }
    await ctx.db.delete(message._id);
  }
  if (messages.length === DELETE_BATCH_SIZE) {
    hasMore = true;
  }

  const sandboxArtifacts = await ctx.db
    .query("sandboxArtifacts")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const artifact of sandboxArtifacts) {
    if (artifact.storageId) await ctx.storage.delete(artifact.storageId).catch(() => undefined);
    await ctx.db.delete(artifact._id);
  }
  if (sandboxArtifacts.length === DELETE_BATCH_SIZE) hasMore = true;

  const sandboxEvents = await ctx.db
    .query("sandboxEvents")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const event of sandboxEvents) await ctx.db.delete(event._id);
  if (sandboxEvents.length === DELETE_BATCH_SIZE) hasMore = true;

  const sandboxSessions = await ctx.db
    .query("sandboxSessions")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const session of sandboxSessions) await ctx.db.delete(session._id);
  if (sandboxSessions.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Generation jobs ---
  const generationJobs = await ctx.db
    .query("generationJobs")
    .withIndex("by_chat_status", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const job of generationJobs) {
    if (job.scheduledFunctionId) {
      await ctx.scheduler.cancel(job.scheduledFunctionId).catch(() => undefined);
    }
    await ctx.db.delete(job._id);
  }
  if (generationJobs.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Autonomous sessions ---
  const sessions = await ctx.db
    .query("autonomousSessions")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const session of sessions) {
    await ctx.db.delete(session._id);
  }
  if (sessions.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Usage records ---
  const usageRecords = await ctx.db
    .query("usageRecords")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const record of usageRecords) {
    await ctx.db.delete(record._id);
  }
  if (usageRecords.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Chat participants ---
  const participants = await ctx.db
    .query("chatParticipants")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const participant of participants) {
    await ctx.db.delete(participant._id);
  }
  if (participants.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Node positions ---
  const positions = await ctx.db
    .query("nodePositions")
    .withIndex("by_chat", (query) => query.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const position of positions) {
    await ctx.db.delete(position._id);
  }
  if (positions.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Search sessions + child phases ---
  const searchSessions = await ctx.db
    .query("searchSessions")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  let remainingSearchDeletes = DELETE_BATCH_SIZE;
  for (const session of searchSessions) {
    if (remainingSearchDeletes === 0) {
      hasMore = true;
      break;
    }
    const tasks = await ctx.db
      .query("researchSearchTasks")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .take(remainingSearchDeletes);
    for (const task of tasks) await ctx.db.delete(task._id);
    remainingSearchDeletes -= tasks.length;
    if (remainingSearchDeletes === 0) {
      hasMore = true;
      break;
    }
    const batches = await ctx.db
      .query("researchSearchBatches")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .take(remainingSearchDeletes);
    for (const batch of batches) await ctx.db.delete(batch._id);
    remainingSearchDeletes -= batches.length;
    if (remainingSearchDeletes === 0) {
      hasMore = true;
      break;
    }
    const phases = await ctx.db
      .query("searchPhases")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .take(remainingSearchDeletes);
    for (const phase of phases) {
      await ctx.db.delete(phase._id);
    }
    remainingSearchDeletes -= phases.length;
    if (remainingSearchDeletes === 0) {
      hasMore = true;
      break;
    }
    await ctx.db.delete(session._id);
    remainingSearchDeletes--;
  }
  if (searchSessions.length === DELETE_BATCH_SIZE || remainingSearchDeletes === 0) {
    hasMore = true;
  }

  // --- Search contexts ---
  const searchContexts = await ctx.db
    .query("searchContexts")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const context of searchContexts) {
    await ctx.db.delete(context._id);
  }
  if (searchContexts.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Generated media (images/videos + shared storage blobs) ---
  const generatedMediaCount = await deleteGeneratedMediaForChatBatch(
    ctx,
    chatId,
    GENERATED_MEDIA_DELETE_BATCH_SIZE,
  );
  if (generatedMediaCount === GENERATED_MEDIA_DELETE_BATCH_SIZE) hasMore = true;

  // --- Canonical documents + extracted text blobs ---
  const documents = await ctx.db
    .query("documents")
    .withIndex("by_origin_chat", (q) => q.eq("originChatId", chatId))
    .take(1);
  for (const document of documents) {
    const editBatch = await ctx.db
      .query("documentEditBatches")
      .withIndex("by_document", (q) => q.eq("documentId", document._id))
      .first();
    if (editBatch) {
      const edits = await ctx.db
        .query("documentEdits")
        .withIndex("by_batch", (q) => q.eq("batchId", editBatch._id))
        .take(DELETE_BATCH_SIZE);
      for (const edit of edits) {
        await ctx.db.delete(edit._id);
      }
      if (edits.length < DELETE_BATCH_SIZE) await ctx.db.delete(editBatch._id);
      hasMore = true;
      continue;
    }

    const versionCount = await deleteDocumentVersionsForChatDocument(
      ctx,
      document,
      DELETE_BATCH_SIZE,
    );
    if (versionCount > 0) {
      hasMore = true;
      continue;
    }
    await ctx.db.delete(document._id);
  }
  if (documents.length > 0) hasMore = true;

  // --- Generated files (delete storage blobs to avoid orphans) ---
  const generatedFiles = await ctx.db
    .query("generatedFiles")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const file of generatedFiles) {
    await ctx.db.delete(file._id);
    if (!await storageHasContentReferences(ctx, file.storageId)) {
      await ctx.storage.delete(file.storageId).catch(() => undefined);
    }
  }
  if (generatedFiles.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Generated charts ---
  const generatedCharts = await ctx.db
    .query("generatedCharts")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const chart of generatedCharts) {
    await ctx.db.delete(chart._id);
  }
  if (generatedCharts.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- File attachments ---
  const fileAttachments = await ctx.db
    .query("fileAttachments")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const attachment of fileAttachments) {
    const hasOtherRefs = await storageHasOtherFileAttachmentReferences(
      ctx,
      attachment.userId,
      attachment.storageId,
      attachment._id,
    );
    if (attachment.driveFileId && !hasOtherRefs) {
      await deleteDriveGrantCacheForStorage(ctx, attachment.userId, attachment.storageId);
    }
    await ctx.db.delete(attachment._id);
    if (!await storageHasContentReferences(ctx, attachment.storageId)) {
      await ctx.storage.delete(attachment.storageId).catch(() => undefined);
    }
  }
  if (fileAttachments.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Subagent batches + child runs ---
  const subagentBatches = await ctx.db
    .query("subagentBatches")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const batch of subagentBatches) {
    const runs = await ctx.db
      .query("subagentRuns")
      .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
      .take(DELETE_BATCH_SIZE);
    for (const run of runs) {
      for (const file of run.generatedFiles ?? []) {
        if (!await storageHasContentReferences(ctx, file.storageId)) {
          await ctx.storage.delete(file.storageId).catch(() => undefined);
        }
      }
      await ctx.db.delete(run._id);
    }
    if (runs.length === 0) await ctx.db.delete(batch._id);
    else hasMore = true;
  }
  if (subagentBatches.length === DELETE_BATCH_SIZE) hasMore = true;

  if (hasMore) {
    // More rows remain — schedule a continuation to keep draining.
    // Don't delete the chat row yet; it will be deleted in the final pass.
    const continuation = deletedParentResidue
      ? internal.chat.manage_internal.deleteDeletedChatResidue
      : internal.chat.manage_internal.deleteChatContinuation;
    await ctx.scheduler.runAfter(0, continuation, { chatId });
  } else if (!deletedParentResidue) {
    // All child rows drained — safe to delete the chat document itself.
    await ctx.db.delete(chatId);
  }
}
