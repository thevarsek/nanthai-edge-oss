import { internalQuery } from "../_generated/server";
import { v } from "convex/values";

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

export const listPausedSessionsForUserInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("sandboxSessions")
      .withIndex("by_user_status", (q) =>
        q.eq("userId", args.userId).eq("status", "paused"),
      )
      .collect();
  },
});

export const listMarkedForCleanupInternal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const paused = await ctx.db
      .query("sandboxSessions")
      .withIndex("by_status_last_active", (q) => q.eq("status", "paused"))
      .collect();

    return paused.filter((session) => Boolean(session.pendingDeletionReason));
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
