import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import {
  RUNTIME_CAP_EXCESS_DELETE_MS,
  RUNTIME_INACTIVITY_DELETE_MS,
  RUNTIME_MAX_PAUSED_PER_USER,
} from "./shared";

export const upsertSessionInternal = internalMutation({
  args: {
    sessionId: v.optional(v.id("sandboxSessions")),
    userId: v.string(),
    chatId: v.id("chats"),
    providerSandboxId: v.optional(v.string()),
    templateName: v.string(),
    templateVersion: v.string(),
    status: v.union(
      v.literal("pendingCreate"),
      v.literal("running"),
      v.literal("paused"),
      v.literal("resuming"),
      v.literal("failed"),
      v.literal("resetting"),
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
      provider: "e2b" as const,
      templateName: args.templateName,
      templateVersion: args.templateVersion,
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
    sandboxSessionId: v.id("sandboxSessions"),
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

export const markCleanupCandidatesInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const paused = await ctx.db
      .query("sandboxSessions")
      .withIndex("by_status_last_active", (q) => q.eq("status", "paused"))
      .collect();

    const byUser = new Map<string, typeof paused>();
    for (const session of paused) {
      const sessions = byUser.get(session.userId) ?? [];
      sessions.push(session);
      byUser.set(session.userId, sessions);
    }

    for (const sessions of byUser.values()) {
      sessions.sort((a, b) => a.lastActiveAt - b.lastActiveAt);

      for (const session of sessions) {
        const ageMs = now - session.lastActiveAt;
        const shouldDeleteForAge = ageMs >= RUNTIME_INACTIVITY_DELETE_MS;
        const overCapIndex = sessions.length - RUNTIME_MAX_PAUSED_PER_USER;
        const shouldDeleteForCap =
          overCapIndex > 0 &&
          sessions.indexOf(session) < overCapIndex &&
          ageMs >= RUNTIME_CAP_EXCESS_DELETE_MS;

        const pendingDeletionReason =
          shouldDeleteForAge
            ? "inactive_ttl"
            : shouldDeleteForCap
              ? "paused_cap"
              : undefined;

        await ctx.db.patch(session._id, {
          pendingDeletionReason,
          updatedAt: now,
        });
      }
    }
  },
});
