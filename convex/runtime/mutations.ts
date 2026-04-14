import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const upsertSessionInternal = internalMutation({
  args: {
    sessionId: v.optional(v.id("sandboxSessions")),
    userId: v.string(),
    chatId: v.id("chats"),
    environment: v.union(v.literal("python"), v.literal("node")),
    providerSandboxId: v.optional(v.string()),
    status: v.union(
      v.literal("pendingCreate"),
      v.literal("running"),
      v.literal("failed"),
      v.literal("deleted"),
    ),
    cwd: v.string(),
    lastActiveAt: v.number(),
    lastPausedAt: v.optional(v.number()),
    lastResumedAt: v.optional(v.number()),
    lastHealthcheckAt: v.optional(v.number()),
    timeoutMs: v.number(),
    internetEnabled: v.boolean(),
    publicTrafficEnabled: v.boolean(),
    pendingDeletionReason: v.optional(v.union(v.string(), v.null())),
    failureCount: v.optional(v.number()),
    metadata: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const patch: Record<string, unknown> = {
      provider: "vercel" as const,
      environment: args.environment,
      status: args.status,
      cwd: args.cwd,
      lastActiveAt: args.lastActiveAt,
      lastPausedAt: args.lastPausedAt,
      lastResumedAt: args.lastResumedAt,
      lastHealthcheckAt: args.lastHealthcheckAt,
      timeoutMs: args.timeoutMs,
      internetEnabled: args.internetEnabled,
      publicTrafficEnabled: args.publicTrafficEnabled,
      pendingDeletionReason:
        args.pendingDeletionReason === null ? undefined : args.pendingDeletionReason,
      failureCount: args.failureCount ?? 0,
      updatedAt: now,
    };

    if (Object.prototype.hasOwnProperty.call(args, "providerSandboxId")) {
      patch.providerSandboxId = args.providerSandboxId;
    }
    if (Object.prototype.hasOwnProperty.call(args, "metadata")) {
      patch.metadata = args.metadata;
    }

    if (args.sessionId) {
      await ctx.db.patch(args.sessionId, patch);
      return args.sessionId;
    }

    return await ctx.db.insert("sandboxSessions", {
      userId: args.userId,
      chatId: args.chatId,
      createdAt: now,
      ...patch,
    } as any);
  },
});

export const recordSandboxArtifactInternal = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    // Links the artifact to its sandbox session for cascade deletion
    // during account purge (the account-deletion flow walks sessions
    // and queries sandboxArtifacts via the by_session index).
    sandboxSessionId: v.optional(v.id("sandboxSessions")),
    path: v.string(),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    storageId: v.optional(v.id("_storage")),
    isDurable: v.boolean(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sandboxArtifacts", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const recordSandboxEventInternal = internalMutation({
  args: {
    // Links the event to its sandbox session for cascade deletion.
    sandboxSessionId: v.optional(v.id("sandboxSessions")),
    userId: v.string(),
    chatId: v.id("chats"),
    eventType: v.string(),
    details: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sandboxEvents", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Stale session cleanup (used by cleanup cron action)
// ---------------------------------------------------------------------------

/**
 * Batch-mark sandbox sessions as "deleted". Called by the cleanup action
 * after it has attempted Sandbox.stop() on any live VMs.
 */
export const markSessionsDeletedInternal = internalMutation({
  args: {
    sessionIds: v.array(v.id("sandboxSessions")),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    let marked = 0;
    for (const sessionId of args.sessionIds) {
      const session = await ctx.db.get(sessionId);
      if (!session) continue;
      // Only mark if not already deleted (idempotent).
      if (session.status === "deleted") continue;
      await ctx.db.patch(sessionId, {
        status: "deleted",
        pendingDeletionReason: args.reason,
        updatedAt: now,
      });
      marked++;
    }
    return { marked };
  },
});
