import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalQuery } from "../_generated/server";

const cursor = v.union(v.string(), v.null());

export const listUserRootRuns = internalQuery({
  args: { userId: v.string(), cursor },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("executionRuns")
      .withIndex("by_user_created", (q) => q.eq("userId", args.userId))
      .paginate({ cursor: args.cursor, numItems: 100 });
    const rootRunIds = new Set<Id<"executionRuns">>();
    for (const run of page.page) {
      let root = run;
      while (root.parentRunId) {
        const parent = await ctx.db.get(root.parentRunId);
        if (!parent) break;
        root = parent;
      }
      rootRunIds.add(root._id);
    }
    return {
      runIds: [...rootRunIds],
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const listChatRootRuns = internalQuery({
  args: { chatId: v.id("chats"), cursor },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("executionRuns")
      .withIndex("by_chat_created", (q) => q.eq("chatId", args.chatId))
      .paginate({ cursor: args.cursor, numItems: 100 });
    return {
      runIds: page.page
        .filter((run) => run.parentRunId === undefined)
        .map((run) => run._id),
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

export const getAccountCancellationState = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await ctx.db
    .query("accountDeletionTombstones")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .unique(),
});

export const getChatCancellationState = internalQuery({
  args: { chatId: v.id("chats"), userId: v.string() },
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId);
    return chat?.userId === args.userId && chat.isDeleting === true ? chat : null;
  },
});

export const hasPendingUserTeardown = internalQuery({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    for (const status of ["pending", "expanding", "waiting_for_children", "cancelling"] as const) {
      const task = await ctx.db
        .query("executionTeardownTasks")
        .withIndex("by_user_status", (q) => q
          .eq("userId", args.userId)
          .eq("status", status))
        .first();
      if (task) return true;
    }
    return false;
  },
});

export const hasPendingChatTeardown = internalQuery({
  args: { chatId: v.id("chats") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    for (const status of ["pending", "expanding", "waiting_for_children", "cancelling"] as const) {
      const task = await ctx.db
        .query("executionTeardownTasks")
        .withIndex("by_chat_status", (q) => q
          .eq("chatId", args.chatId)
          .eq("status", status))
        .first();
      if (task) return true;
    }
    return false;
  },
});
