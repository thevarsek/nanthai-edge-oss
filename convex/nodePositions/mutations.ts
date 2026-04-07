// convex/nodePositions/mutations.ts
// =============================================================================
// Node Position mutations for ideascape canvas layout.
//
// Node positions track where messages are placed on the canvas.
// Supports batch upsert for layout engine output.
// =============================================================================

import { v, ConvexError } from "convex/values";
import { mutation, MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";

async function assertChatOwnership(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  userId: string,
) {
  const chat = await ctx.db.get(chatId);
  if (!chat || chat.userId !== userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found or unauthorized" });
  }
}

async function assertMessageInChat(
  ctx: MutationCtx,
  messageId: Id<"messages">,
  chatId: Id<"chats">,
) {
  const message = await ctx.db.get(messageId);
  if (!message || message.chatId !== chatId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Message not found in chat" });
  }
}

/** Upsert a single node position. */
export const upsert = mutation({
  args: {
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await assertChatOwnership(ctx, args.chatId, userId);
    await assertMessageInChat(ctx, args.messageId, args.chatId);

    const existing = await ctx.db
      .query("nodePositions")
      .withIndex("by_chat_message", (q) =>
        q.eq("chatId", args.chatId).eq("messageId", args.messageId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        x: args.x,
        y: args.y,
        width: args.width,
        height: args.height,
      });
      return existing._id;
    }

    return await ctx.db.insert("nodePositions", {
      userId,
      chatId: args.chatId,
      messageId: args.messageId,
      x: args.x,
      y: args.y,
      width: args.width,
      height: args.height,
    });
  },
});

/** Batch upsert node positions (used by layout engine). */
export const batchUpsert = mutation({
  args: {
    chatId: v.id("chats"),
    positions: v.array(
      v.object({
        messageId: v.id("messages"),
        x: v.number(),
        y: v.number(),
        width: v.number(),
        height: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await assertChatOwnership(ctx, args.chatId, userId);

    const uniqueMessageIds = Array.from(
      new Set(args.positions.map((position) => position.messageId)),
    );
    for (const messageId of uniqueMessageIds) {
      await assertMessageInChat(ctx, messageId, args.chatId);
    }

    // Load all existing positions for this chat
    const existing = await ctx.db
      .query("nodePositions")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();

    const existingMap = new Map(
      existing.map((p) => [p.messageId, p]),
    );

    for (const pos of args.positions) {
      const found = existingMap.get(pos.messageId);
      if (found) {
        await ctx.db.patch(found._id, {
          x: pos.x,
          y: pos.y,
          width: pos.width,
          height: pos.height,
        });
      } else {
        await ctx.db.insert("nodePositions", {
          userId,
          chatId: args.chatId,
          messageId: pos.messageId,
          x: pos.x,
          y: pos.y,
          width: pos.width,
          height: pos.height,
        });
      }
    }
  },
});

/** Delete a node position. */
export const remove = mutation({
  args: {
    chatId: v.id("chats"),
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await assertChatOwnership(ctx, args.chatId, userId);
    await assertMessageInChat(ctx, args.messageId, args.chatId);

    const existing = await ctx.db
      .query("nodePositions")
      .withIndex("by_chat_message", (q) =>
        q.eq("chatId", args.chatId).eq("messageId", args.messageId),
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/** Delete all node positions for a chat. */
export const removeAllForChat = mutation({
  args: { chatId: v.id("chats") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await assertChatOwnership(ctx, args.chatId, userId);

    const positions = await ctx.db
      .query("nodePositions")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();

    for (const pos of positions) {
      await ctx.db.delete(pos._id);
    }
  },
});
