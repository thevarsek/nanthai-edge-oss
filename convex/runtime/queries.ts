import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

// ---------------------------------------------------------------------------
// Sandbox session cleanup constants (shared with cleanup.ts action)
// ---------------------------------------------------------------------------

/** Sessions with lastActiveAt older than this are considered stale. */
const STALE_RUNNING_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/** Failed/pendingCreate sessions older than this get cleaned up (DB-only). */
const STALE_FAILED_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Max sessions to process per cron invocation. */
const CLEANUP_BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Existing queries
// ---------------------------------------------------------------------------

export const getSessionByChatInternal = internalQuery({
  args: { userId: v.string(), chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sandboxSessions")
      .withIndex("by_chat_user", (q) =>
        q.eq("chatId", args.chatId).eq("userId", args.userId),
      )
      .collect();

    return sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  },
});

export const hasActiveGenerationForChatInternal = internalQuery({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const active = await ctx.db
      .query("generationJobs")
      .withIndex("by_chat_status", (q) =>
        q.eq("chatId", args.chatId).eq("status", "streaming"),
      )
      .first();
    return active !== null;
  },
});

export const resolveOwnedStorageFileInternal = internalQuery({
  args: { userId: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const uploaded = await ctx.db
      .query("fileAttachments")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (uploaded && uploaded.userId === args.userId) {
      return {
        storageId: uploaded.storageId,
        filename: uploaded.filename,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        source: "upload" as const,
      };
    }

    const generated = await ctx.db
      .query("generatedFiles")
      .withIndex("by_storage", (q) => q.eq("storageId", args.storageId))
      .first();
    if (generated && generated.userId === args.userId) {
      return {
        storageId: generated.storageId,
        filename: generated.filename,
        mimeType: generated.mimeType,
        sizeBytes: generated.sizeBytes,
        source: "generated" as const,
      };
    }

    return null;
  },
});

// ---------------------------------------------------------------------------
// Stale sandbox session query (used by cleanup cron)
// ---------------------------------------------------------------------------

/**
 * Find sandbox sessions that are stale and should be cleaned up.
 * Uses the by_status_last_active index: ["status", "lastActiveAt"].
 *
 * Returns sessions grouped by whether they may have a live VM to stop.
 */
export const getStaleSessionsInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const runningCutoff = now - STALE_RUNNING_THRESHOLD_MS;
    const failedCutoff = now - STALE_FAILED_THRESHOLD_MS;

    // "running" sessions with lastActiveAt before the cutoff — likely dead VMs.
    const staleRunning = await ctx.db
      .query("sandboxSessions")
      .withIndex("by_status_last_active", (q) =>
        q.eq("status", "running").lt("lastActiveAt", runningCutoff),
      )
      .take(CLEANUP_BATCH_SIZE);

    const remaining = CLEANUP_BATCH_SIZE - staleRunning.length;

    // "pendingCreate" sessions — never made it to a running VM.
    const stalePending = remaining > 0
      ? await ctx.db
          .query("sandboxSessions")
          .withIndex("by_status_last_active", (q) =>
            q.eq("status", "pendingCreate").lt("lastActiveAt", runningCutoff),
          )
          .take(remaining)
      : [];

    const remaining2 = CLEANUP_BATCH_SIZE - staleRunning.length - stalePending.length;

    // Old "failed" records — no VM to stop, just DB hygiene.
    const staleFailed = remaining2 > 0
      ? await ctx.db
          .query("sandboxSessions")
          .withIndex("by_status_last_active", (q) =>
            q.eq("status", "failed").lt("lastActiveAt", failedCutoff),
          )
          .take(remaining2)
      : [];

    return {
      sessions: [
        ...staleRunning.map((s) => ({
          id: s._id,
          providerSandboxId: s.providerSandboxId,
          status: s.status as string,
          hasVm: true,
        })),
        ...stalePending.map((s) => ({
          id: s._id,
          providerSandboxId: s.providerSandboxId,
          status: s.status as string,
          hasVm: !!s.providerSandboxId,
        })),
        ...staleFailed.map((s) => ({
          id: s._id,
          providerSandboxId: s.providerSandboxId,
          status: s.status as string,
          hasVm: false,
        })),
      ],
      hitBatchLimit:
        staleRunning.length + stalePending.length + staleFailed.length >=
        CLEANUP_BATCH_SIZE,
    };
  },
});
