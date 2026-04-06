// convex/account/mutations.ts
// Internal mutations for batch-deleting user data during account deletion.
// Called by the deleteAccount action in batches to stay within transaction limits.

import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

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
  },
  handler: async (ctx, args) => {
    const { userId, tableName } = args;
    let deleted = 0;

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
      const sessions = await ctx.db
        .query("searchSessions")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const session of sessions) {
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
      return { deleted };
    }

    if (tableName === "memoryEmbeddings") {
      // memoryEmbeddings → keyed by memoryId; cascade via user's memories
      const memories = await ctx.db
        .query("memories")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const memory of memories) {
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
      return { deleted };
    }

    if (tableName === "messages") {
      // messages have no by_user index — cascade via user's chats
      const chats = await ctx.db
        .query("chats")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const chat of chats) {
        if (deleted >= BATCH_SIZE) break;
        const remaining = BATCH_SIZE - deleted;
        const msgs = await ctx.db
          .query("messages")
          .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
          .take(remaining);
        for (const msg of msgs) {
          // Clean up audio storage blob
          if ((msg as any).audioStorageId) {
            try {
              await ctx.storage.delete((msg as any).audioStorageId);
            } catch {
              // Already deleted
            }
          }
          // Clean up storage blobs in attachments
          if (msg.attachments) {
            for (const att of msg.attachments) {
              if (att.storageId) {
                try {
                  await ctx.storage.delete(att.storageId);
                } catch {
                  // Already deleted
                }
              }
            }
          }
          await ctx.db.delete(msg._id);
          deleted++;
        }
      }
      return { deleted };
    }

    if (tableName === "nodePositions") {
      // nodePositions has userId but only by_chat/by_chat_message indexes
      // Cascade via user's chats
      const chats = await ctx.db
        .query("chats")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const chat of chats) {
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
      return { deleted };
    }

    if (tableName === "subagentRuns") {
      // subagentRuns → keyed by batchId; cascade via user's subagentBatches.
      // Inline generatedFiles may contain storageId fields needing blob cleanup.
      const batches = await ctx.db
        .query("subagentBatches")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      for (const batch of batches) {
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
      return { deleted };
    }

    if (tableName === "sandboxArtifacts") {
      // sandboxArtifacts → keyed by sandboxSessionId; cascade via user's sessions.
      // storageId needs blob cleanup before row deletion.
      const sessions = await ctx.db
        .query("sandboxSessions")
        .withIndex("by_user_status", (q) => q.eq("userId", userId))
        .collect();
      for (const session of sessions) {
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
      return { deleted };
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
      const rows = await (ctx.db as any)
        // TypeScript limitation: `integrationRequestGates` is not in the generated
        // DataModel for this helper because it has no simple "by_user" index.
        // The cast is safe — the table and index exist in schema.ts.
        .query("integrationRequestGates")
        .withIndex("by_user_provider", (q: any) => q.eq("userId", userId))
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

    // ---------------------------------------------------------------
    // Storage-bearing tables: delete blobs alongside rows
    // ---------------------------------------------------------------

    if (tableName === "generatedFiles" || tableName === "fileAttachments") {
      const rows = await ctx.db
        .query(tableName as "generatedFiles" | "fileAttachments")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .take(BATCH_SIZE);
      for (const row of rows) {
        if (row.storageId) {
          try {
            await ctx.storage.delete(row.storageId);
          } catch {
            // Storage blob may already be deleted
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

    const rows = await (ctx.db as any)
      // TypeScript limitation: `tableName` is a dynamic string so TypeScript
      // cannot infer the table type. The cast is safe — callers validate
      // `tableName` against the fixed allowlist above before reaching this branch.
      .query(tableName)
      .withIndex("by_user", (q: any) => q.eq("userId", userId))
      .take(BATCH_SIZE);
    for (const row of rows) {
      await ctx.db.delete(row._id);
      deleted++;
    }
    return { deleted };
  },
});
