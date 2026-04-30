// convex/folders/mutations.ts
// =============================================================================
// Folder CRUD mutations for chat organization.
// =============================================================================

import { v, ConvexError } from "convex/values";
import { mutation } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { resolveNextFolderSortOrder } from "./shared";

/** Create a new folder. */
export const create = mutation({
  args: {
    name: v.string(),
    color: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  returns: v.id("folders"),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const now = Date.now();
    const userFolders = await ctx.db
      .query("folders")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    return await ctx.db.insert("folders", {
      userId,
      name: args.name,
      color: args.color,
      sortOrder: args.sortOrder ?? resolveNextFolderSortOrder(userFolders),
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Update a folder. */
export const update = mutation({
  args: {
    folderId: v.id("folders"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Folder not found or unauthorized" });
    }

    const { folderId, ...updates } = args;
    await ctx.db.patch(folderId, {
      ...updates,
      updatedAt: Date.now(),
    });
  },
});

/** Delete a folder. Chats in the folder become unfiled. */
export const remove = mutation({
  args: { folderId: v.id("folders") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const folder = await ctx.db.get(args.folderId);
    if (!folder || folder.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Folder not found or unauthorized" });
    }

    // Un-file chats in this folder
    const folderIdStr = args.folderId as string;
    const chats = await ctx.db
      .query("chats")
      .withIndex("by_user_folder", (q) =>
        q.eq("userId", userId).eq("folderId", folderIdStr),
      )
      .collect();
    for (const chat of chats) {
      await ctx.db.patch(chat._id, { folderId: undefined });
      const docs = await ctx.db
        .query("documents")
        .withIndex("by_origin_chat", (q) => q.eq("originChatId", chat._id))
        .collect();
      for (const doc of docs) {
        if (doc.userId === userId && doc.originChatId === chat._id) {
          await ctx.db.patch(doc._id, {
            folderId: undefined,
            updatedAt: Date.now(),
          });
        }
      }
    }

    await ctx.db.delete(args.folderId);
  },
});

/** Move a chat to a folder (or unfiled). */
export const moveChat = mutation({
  args: {
    chatId: v.id("chats"),
    folderId: v.optional(v.id("folders")),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found or unauthorized" });
    }

    // Verify folder exists if provided
    if (args.folderId) {
      const folder = await ctx.db.get(args.folderId);
      if (!folder || folder.userId !== userId) {
        throw new ConvexError({ code: "NOT_FOUND", message: "Folder not found or unauthorized" });
      }
    }

    await ctx.db.patch(args.chatId, {
      folderId: args.folderId,
      // Don't bump updatedAt — folder moves are organisational and shouldn't
      // change the chat's position in the timeline.
    });

    if (typeof ctx.db.query === "function") {
      const docs = await ctx.db
        .query("documents")
        .withIndex("by_origin_chat", (q) => q.eq("originChatId", args.chatId))
        .collect();
      for (const doc of docs) {
        if (doc.userId === userId && doc.originChatId === args.chatId) {
          await ctx.db.patch(doc._id, {
            folderId: args.folderId,
            updatedAt: Date.now(),
          });
        }
      }
    }
  },
});
