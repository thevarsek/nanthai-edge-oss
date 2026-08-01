// convex/account/mutations.ts
// Internal mutations for batch-deleting user data during account deletion.
// Called by the deleteAccount action in batches to stay within transaction limits.

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import {
  deleteUserAdvisorBatchesBatch,
  deleteUserAdvisorRunsBatch,
} from "./mutations_advisor_cleanup";
import { deleteDurableOrchestrationBatch } from "./mutations_durable_cleanup";
import { deleteAccountStorageBatch } from "./mutations_storage_cleanup";
import { isPurgeTable } from "./purge_tables";
import { deleteGeneratedMediaRecord } from "../chat/manage_generated_media_helpers";
import {
  storageHasContentReferences,
} from "../knowledge_base/delete_helpers";
import { safeDeleteAudioBlob } from "../chat/manage_delete_helpers";

const BATCH_SIZE = 200;

/**
 * Delete a batch of rows from a single table for a given user.
 * Returns the number of rows deleted so the caller knows whether to continue.
 *
 * The action loop uses `deleted >= BATCH_SIZE` to decide if more batches are
 * needed. Cascade handlers therefore accumulate deletions across parents one
 * at a time and stop as soon as BATCH_SIZE is reached, guaranteeing that
 * `deleted < BATCH_SIZE` truly means "nothing left".
 *
 * Handles four categories of tables:
 * 1. Tables with a `by_user` index (most tables) — direct query + delete
 * 2. Tables with alternative userId indexes — special-cased
 * 3. Tables without userId — cascaded via parent table
 * 4. nodePositions — has userId but no by_user index, cascaded via chats
 */
export const deleteUserTableBatch = internalMutation({
  args: {
    userId: v.string(),
    tableName: v.string(),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, tableName } = args;
    if (!isPurgeTable(tableName)) {
      throw new Error("INVALID_ACCOUNT_PURGE_TABLE");
    }
    let deleted = 0;
    const durableDeleted = await deleteDurableOrchestrationBatch(
      ctx,
      tableName,
      userId,
      BATCH_SIZE,
      args.cursor,
    );
    if (durableDeleted !== undefined) {
      return typeof durableDeleted === "number"
        ? { deleted: durableDeleted }
        : durableDeleted;
    }
    const storageDeleted = await deleteAccountStorageBatch(
      ctx,
      tableName,
      userId,
      BATCH_SIZE,
    );
    if (storageDeleted !== undefined) return { deleted: storageDeleted };

    // ---------------------------------------------------------------
    // Cascade tables (no direct userId, or no by_user index)
    //
    // Strategy: iterate parents one at a time, drain children from
    // each until BATCH_SIZE total deletions are reached. This ensures
    // `deleted < BATCH_SIZE` only when every parent's children are
    // fully drained, so the action loop correctly terminates.
    // ---------------------------------------------------------------

    if (tableName === "searchPhases") {
      // searchPhases → keyed by sessionId; cascade via user's sessions
      const page = await ctx.db
        .query("searchSessions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .paginate({ cursor: args.cursor ?? null, numItems: 25 });
      for (const session of page.page) {
        if (deleted >= BATCH_SIZE) break;
        const remaining = BATCH_SIZE - deleted;
        const phases = await ctx.db
          .query("searchPhases")
          .withIndex("by_session", (q) => q.eq("sessionId", session._id))
          .take(remaining);
        for (const phase of phases) {
          await ctx.db.delete(phase._id);
          deleted++;
        }
      }
      return deleted >= BATCH_SIZE
        ? { deleted, cursor: args.cursor, done: false }
        : { deleted, cursor: page.continueCursor, done: page.isDone };
    }

    if (tableName === "memoryEmbeddings") {
      // memoryEmbeddings → keyed by memoryId; cascade via user's memories
      const page = await ctx.db
        .query("memories")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .paginate({ cursor: args.cursor ?? null, numItems: 25 });
      for (const memory of page.page) {
        if (deleted >= BATCH_SIZE) break;
        const remaining = BATCH_SIZE - deleted;
        const embeddings = await ctx.db
          .query("memoryEmbeddings")
          .withIndex("by_memory", (q) => q.eq("memoryId", memory._id))
          .take(remaining);
        for (const emb of embeddings) {
          await ctx.db.delete(emb._id);
          deleted++;
        }
      }
      return deleted >= BATCH_SIZE
        ? { deleted, cursor: args.cursor, done: false }
        : { deleted, cursor: page.continueCursor, done: page.isDone };
    }

    if (tableName === "messages") {
      // messages have no by_user index — cascade via user's chats
      const page = await ctx.db
        .query("chats")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .paginate({ cursor: args.cursor ?? null, numItems: 25 });
      for (const chat of page.page) {
        if (deleted >= BATCH_SIZE) break;
        const remaining = BATCH_SIZE - deleted;
        const msgs = await ctx.db
          .query("messages")
          .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
          .take(remaining);
        for (const msg of msgs) {
          const storageIds = new Set(
            (msg.attachments ?? []).flatMap((attachment) =>
              attachment.storageId ? [attachment.storageId] : []
            ),
          );
          await ctx.db.delete(msg._id);
          if (msg.audioStorageId) {
            await safeDeleteAudioBlob(ctx, msg.audioStorageId);
          }
          for (const storageId of storageIds) {
            if (!await storageHasContentReferences(ctx, storageId)) {
              await ctx.storage.delete(storageId).catch(() => undefined);
            }
          }
          deleted++;
        }
      }
      return deleted >= BATCH_SIZE
        ? { deleted, cursor: args.cursor, done: false }
        : { deleted, cursor: page.continueCursor, done: page.isDone };
    }

    if (tableName === "mcpInvocations") {
      const rows = await ctx.db
        .query("mcpInvocations")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        for (const item of row.contentItems ?? []) {
          if (item.storageId) await ctx.storage.delete(item.storageId).catch(() => undefined);
        }
        await ctx.db.delete(row._id);
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "nodePositions") {
      // nodePositions has userId but only by_chat/by_chat_message indexes
      // Cascade via user's chats
      const page = await ctx.db
        .query("chats")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .paginate({ cursor: args.cursor ?? null, numItems: 25 });
      for (const chat of page.page) {
        if (deleted >= BATCH_SIZE) break;
        const remaining = BATCH_SIZE - deleted;
        const positions = await ctx.db
          .query("nodePositions")
          .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
          .take(remaining);
        for (const pos of positions) {
          await ctx.db.delete(pos._id);
          deleted++;
        }
      }
      return deleted >= BATCH_SIZE
        ? { deleted, cursor: args.cursor, done: false }
        : { deleted, cursor: page.continueCursor, done: page.isDone };
    }

    if (tableName === "subagentRuns") {
      // subagentRuns → keyed by batchId; cascade via user's subagentBatches.
      // Inline generatedFiles may contain storageId fields needing blob cleanup.
      const page = await ctx.db
        .query("subagentBatches")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .paginate({ cursor: args.cursor ?? null, numItems: 25 });
      for (const batch of page.page) {
        if (deleted >= BATCH_SIZE) break;
        const remaining = BATCH_SIZE - deleted;
        const runs = await ctx.db
          .query("subagentRuns")
          .withIndex("by_batch", (q) => q.eq("batchId", batch._id))
          .take(remaining);
        for (const run of runs) {
          // Clean up storage blobs from inline generatedFiles
          if (run.generatedFiles) {
            for (const file of run.generatedFiles) {
              if (file.storageId) {
                try {
                  await ctx.storage.delete(file.storageId);
                } catch {
                  // Already deleted
                }
              }
            }
          }
          await ctx.db.delete(run._id);
          deleted++;
        }
      }
      return deleted >= BATCH_SIZE
        ? { deleted, cursor: args.cursor, done: false }
        : { deleted, cursor: page.continueCursor, done: page.isDone };
    }

    if (tableName === "advisorRuns") {
      deleted = await deleteUserAdvisorRunsBatch(ctx, userId, BATCH_SIZE);
      return { deleted };
    }

    if (tableName === "sandboxArtifacts") {
      // sandboxArtifacts → keyed by sandboxSessionId; cascade via user's sessions.
      // storageId needs blob cleanup before row deletion.
      const page = await ctx.db
        .query("sandboxSessions")
        .withIndex("by_user_status", (q) => q.eq("userId", userId))
        .paginate({ cursor: args.cursor ?? null, numItems: 25 });
      for (const session of page.page) {
        if (deleted >= BATCH_SIZE) break;
        const remaining = BATCH_SIZE - deleted;
        const artifacts = await ctx.db
          .query("sandboxArtifacts")
          .withIndex("by_session", (q) => q.eq("sandboxSessionId", session._id))
          .take(remaining);
        for (const artifact of artifacts) {
          if (artifact.storageId) {
            try {
              await ctx.storage.delete(artifact.storageId);
            } catch {
              // Already deleted
            }
          }
          await ctx.db.delete(artifact._id);
          deleted++;
        }
      }
      return deleted >= BATCH_SIZE
        ? { deleted, cursor: args.cursor, done: false }
        : { deleted, cursor: page.continueCursor, done: page.isDone };
    }

    // ---------------------------------------------------------------
    // Tables with alternative userId indexes
    // ---------------------------------------------------------------

    if (tableName === "sandboxSessions") {
      // Uses by_user_status index: ["userId", "status"]
      const rows = await ctx.db
        .query("sandboxSessions")
        .withIndex("by_user_status", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        await ctx.db.delete(row._id);
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "integrationRequestGates") {
      // Uses by_user_provider index: ["userId", "provider"] — no by_user index
      // Collect all providers for this user by scanning the index prefix
      const rows = await ctx.db
        .query("integrationRequestGates")
        .withIndex("by_user_provider", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        await ctx.db.delete(row._id);
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "skills") {
      // User-scoped skills: by_owner index ["ownerUserId", "status"]
      // Only delete skills where ownerUserId matches (scope="user")
      const rows = await ctx.db
        .query("skills")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        await ctx.db.delete(row._id);
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "generationJobs") {
      // Uses by_user_status index: ["userId", "status"]
      const rows = await ctx.db
        .query("generationJobs")
        .withIndex("by_user_status", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        await ctx.db.delete(row._id);
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "autonomousSessions") {
      // Uses by_user_status index: ["userId", "status"]
      const rows = await ctx.db
        .query("autonomousSessions")
        .withIndex("by_user_status", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        await ctx.db.delete(row._id);
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "personas") {
      const rows = await ctx.db
        .query("personas")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        if (row.avatarImageStorageId) {
          try {
            await ctx.storage.delete(row.avatarImageStorageId);
          } catch {
            // Historical Advisor cleanup may already have reclaimed the blob.
          }
        }
        await ctx.db.delete(row._id);
        deleted++;
      }
      return { deleted };
    }

    // ---------------------------------------------------------------
    // scheduledJobs: cancel pending functions before deleting
    // ---------------------------------------------------------------

    if (tableName === "scheduledJobs") {
      const jobs = await ctx.db
        .query("scheduledJobs")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const job of jobs) {
        if (job.scheduledFunctionId) {
          try {
            await ctx.scheduler.cancel(job.scheduledFunctionId);
          } catch {
            // Already executed or cancelled
          }
        }
        await ctx.db.delete(job._id);
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "advisorBatches") {
      deleted = await deleteUserAdvisorBatchesBatch(ctx, userId, BATCH_SIZE);
      return { deleted };
    }

    // ---------------------------------------------------------------
    // Storage-bearing tables: delete blobs alongside rows
    // ---------------------------------------------------------------

    if (tableName === "generatedFiles" || tableName === "fileAttachments") {
      const rows = await ctx.db
        .query(tableName as "generatedFiles" | "fileAttachments")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        await ctx.db.delete(row._id);
        if (row.storageId && !await storageHasContentReferences(ctx, row.storageId)) {
          await ctx.storage.delete(row.storageId).catch(() => undefined);
        }
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "presentationAssets") {
      const rows = await ctx.db
        .query("presentationAssets")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        const siblings = await ctx.db
          .query("presentationAssets")
          .withIndex("by_user_storage", (q) =>
            q.eq("userId", userId).eq("storageId", row.storageId)
          )
          .take(2);
        if (row.kind === "pptx_extracted" && siblings.length === 1) {
          const [attachment, generatedFile] = await Promise.all([
            ctx.db
              .query("fileAttachments")
              .withIndex("by_storage", (q) => q.eq("storageId", row.storageId))
              .first(),
            ctx.db
              .query("generatedFiles")
              .withIndex("by_storage", (q) => q.eq("storageId", row.storageId))
              .first(),
          ]);
          if (!attachment && !generatedFile) {
            try {
              await ctx.storage.delete(row.storageId);
            } catch {
              // Storage blob may already be deleted.
            }
          }
        }
        await ctx.db.delete(row._id);
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "presentationGenerationBatches") {
      const rows = await ctx.db
        .query("presentationGenerationBatches")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        if (row.candidateStorageId) {
          try {
            await ctx.storage.delete(row.candidateStorageId);
          } catch {
            // Scheduled cleanup may already have removed the private candidate.
          }
        }
        await ctx.db.delete(row._id);
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "presentationProjects") {
      const rows = await ctx.db
        .query("presentationProjects")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        if (row.snapshotStorageId) {
          const generatedFile = await ctx.db
            .query("generatedFiles")
            .withIndex("by_storage", (q) => q.eq("storageId", row.snapshotStorageId!))
            .first();
          if (!generatedFile) {
            try {
              await ctx.storage.delete(row.snapshotStorageId);
            } catch {
              // Storage blob may already be deleted.
            }
          }
        }
        await ctx.db.delete(row._id);
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "generatedMedia") {
      const rows = await ctx.db
        .query("generatedMedia")
        .withIndex("by_userId", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        await deleteGeneratedMediaRecord(ctx, row);
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "googleDriveFileGrants") {
      // Drive grant rows may carry a cached `_storage` blob (the ingested
      // Drive file bytes). Clean up the blob alongside the row.
      const rows = await ctx.db
        .query("googleDriveFileGrants")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        if (row.cachedStorageId) {
          const attachment = await ctx.db
            .query("fileAttachments")
            .withIndex("by_storage", (q) => q.eq("storageId", row.cachedStorageId!))
            .first();
          if (!attachment) {
            try {
              await ctx.storage.delete(row.cachedStorageId);
            } catch {
              // Storage blob may already be deleted
            }
          }
        }
        await ctx.db.delete(row._id);
        deleted++;
      }
      return { deleted };
    }

    if (tableName === "toolExecutionArtifacts") {
      const rows = await ctx.db
        .query("toolExecutionArtifacts")
        .withIndex("by_user_status", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        const storageIds = [row.argumentsStorageId, row.resultStorageId].filter(
          (id): id is NonNullable<typeof id> => !!id,
        );
        for (const storageId of storageIds) {
          try {
            await ctx.storage.delete(storageId);
          } catch {
            // Already deleted or shared storage cleanup handled elsewhere.
          }
        }
        await ctx.db.delete(row._id);
        deleted++;
      }
      return { deleted };
    }

    // ---------------------------------------------------------------
    // Generic: tables with a standard by_user index
    // ---------------------------------------------------------------

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (ctx.db as any)
      // TypeScript limitation: `tableName` is a dynamic string so TypeScript
      // cannot infer the table type. The cast is safe — callers validate
      // `tableName` against the fixed allowlist above before reaching this branch.
      .query(tableName)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .take(BATCH_SIZE);
    for (const row of rows) {
      await ctx.db.delete(row._id);
      deleted++;
    }
    return { deleted };
  },
});
