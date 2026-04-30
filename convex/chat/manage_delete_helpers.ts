import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  deleteDriveGrantCacheForStorage,
  storageHasOtherFileAttachmentReferences,
} from "../lib/file_attachments";

// Maximum deletes per batch to stay well within Convex transaction limits.
// Each row deletion touches at most ~2 documents (the row + index entries).
const DELETE_BATCH_SIZE = 200;

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
    .collect();
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
): Promise<void> {
  // Batched deletion: process up to DELETE_BATCH_SIZE rows per table.
  // If any table had remaining rows, schedule a continuation mutation
  // to keep draining until the chat graph is fully removed.
  let hasMore = false;

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

  // --- Generation jobs ---
  const generationJobs = await ctx.db
    .query("generationJobs")
    .withIndex("by_chat_status", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const job of generationJobs) {
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
  for (const session of searchSessions) {
    const phases = await ctx.db
      .query("searchPhases")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const phase of phases) {
      await ctx.db.delete(phase._id);
    }
    await ctx.db.delete(session._id);
  }
  if (searchSessions.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Search contexts ---
  const searchContexts = await ctx.db
    .query("searchContexts")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const context of searchContexts) {
    await ctx.db.delete(context._id);
  }
  if (searchContexts.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Canonical documents + extracted text blobs ---
  const documents = await ctx.db
    .query("documents")
    .withIndex("by_origin_chat", (q) => q.eq("originChatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const document of documents) {
    const versions = await ctx.db
      .query("documentVersions")
      .withIndex("by_document", (q) => q.eq("documentId", document._id))
      .collect();
    for (const version of versions) {
      if (version.extractionTextStorageId) {
        try {
          await ctx.storage.delete(version.extractionTextStorageId);
        } catch {
          // Storage blob may already be deleted — continue cleanup
        }
      }
      if (version.extractionMarkdownStorageId) {
        try {
          await ctx.storage.delete(version.extractionMarkdownStorageId);
        } catch {
          // Storage blob may already be deleted — continue cleanup
        }
      }
      await ctx.db.delete(version._id);
    }
    await ctx.db.delete(document._id);
  }
  if (documents.length === DELETE_BATCH_SIZE) hasMore = true;

  // --- Generated files (delete storage blobs to avoid orphans) ---
  const generatedFiles = await ctx.db
    .query("generatedFiles")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .take(DELETE_BATCH_SIZE);
  for (const file of generatedFiles) {
    try {
      await ctx.storage.delete(file.storageId);
    } catch {
      // Storage blob may already be deleted — continue cleanup
    }
    await ctx.db.delete(file._id);
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
    if (!hasOtherRefs) {
      try {
        await ctx.storage.delete(attachment.storageId);
      } catch {
        // Storage blob may already be deleted — continue cleanup
      }
    }
    await ctx.db.delete(attachment._id);
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
      .collect();
    for (const run of runs) {
      await ctx.db.delete(run._id);
    }
    await ctx.db.delete(batch._id);
  }
  if (subagentBatches.length === DELETE_BATCH_SIZE) hasMore = true;

  if (hasMore) {
    // More rows remain — schedule a continuation to keep draining.
    // Don't delete the chat row yet; it will be deleted in the final pass.
    await ctx.scheduler.runAfter(0, internal.chat.manage_internal.deleteChatContinuation, { chatId });
  } else {
    // All child rows drained — safe to delete the chat document itself.
    await ctx.db.delete(chatId);
  }
}
