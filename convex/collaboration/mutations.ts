import { internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { ConvexError, v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { requestRunTreeTeardown } from "../execution/teardown_graph";
import { ACTIVE_COLLABORATION_STATUSES } from "./constants";
import { groupBehavior } from "./validators";

export const setGroupBehavior = mutation({
  args: {
    chatId: v.id("chats"),
    behavior: groupBehavior,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId || chat.isDeleting === true) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found" });
    }
    if ((chat.groupBehavior ?? "parallel") === args.behavior) return null;
    const [exchanges, autonomousSessions] = await Promise.all([
      ctx.db
        .query("collaborationExchanges")
        .withIndex("by_chat", (query) => query.eq("chatId", chat._id))
        .order("desc")
        .take(5),
      ctx.db
        .query("autonomousSessions")
        .withIndex("by_chat", (query) => query.eq("chatId", chat._id))
        .collect(),
    ]);
    if (exchanges.some((exchange) =>
      ACTIVE_COLLABORATION_STATUSES.has(
        exchange.status as "queued" | "scheduling" | "dispatching" | "waiting",
      )
    )) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Stop the active Collaboration exchange before changing behavior.",
      });
    }
    if (autonomousSessions.some((session) =>
      session.status === "running" || session.status === "paused"
    )) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Stop Autonomous Discussion before changing group behavior.",
      });
    }
    await ctx.db.patch(chat._id, {
      groupBehavior: args.behavior,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const stopExchange = mutation({
  args: { exchangeId: v.id("collaborationExchanges") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const exchange = await ctx.db.get(args.exchangeId);
    if (!exchange || exchange.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Exchange not found" });
    }
    if (!ACTIVE_COLLABORATION_STATUSES.has(
      exchange.status as "queued" | "scheduling" | "dispatching" | "waiting",
    )) return null;
    const now = Date.now();
    await ctx.db.patch(exchange._id, {
      status: "stopped",
      activeParticipantIds: [],
      terminalReason: "stopped_by_user",
      completedAt: now,
      updatedAt: now,
    });
    if (exchange.executionRunId) {
      await requestRunTreeTeardown(
        ctx,
        exchange.executionRunId,
        userId,
        "Collaboration stopped by user",
      );
      await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, {
        runId: exchange.executionRunId,
        requestedBy: userId,
        reason: "Collaboration stopped by user",
      });
    }
    return null;
  },
});
