// convex/memory/operations_internal.ts
// =============================================================================
// Internal mutations for memory bulk operations (continuation batches).
// P2-12: These are scheduled by the public deleteAll/approveAll/rejectAll
// handlers when a single batch wasn't enough.
// =============================================================================

import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";
import { deleteMemoryWithDerivedData } from "./cleanup";

const BATCH_SIZE = 100;

export const deleteAllContinuation = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .take(BATCH_SIZE);
    for (const memory of batch) {
      await deleteMemoryWithDerivedData(ctx, memory._id, args.userId);
    }
    if (batch.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.memory.operations_internal.deleteAllContinuation, { userId: args.userId });
    }
  },
});

export const approveAllContinuation = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const batch = await ctx.db
      .query("memories")
      .withIndex("by_user_pending", (q) => q.eq("userId", args.userId).eq("isPending", true))
      .take(BATCH_SIZE);
    for (const memory of batch) {
      await ctx.db.patch(memory._id, { isPending: false, updatedAt: now });
    }
    if (batch.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.memory.operations_internal.approveAllContinuation, { userId: args.userId });
    }
  },
});

export const rejectAllContinuation = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query("memories")
      .withIndex("by_user_pending", (q) => q.eq("userId", args.userId).eq("isPending", true))
      .take(BATCH_SIZE);
    for (const memory of batch) {
      await deleteMemoryWithDerivedData(ctx, memory._id, args.userId);
    }
    if (batch.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.memory.operations_internal.rejectAllContinuation, { userId: args.userId });
    }
  },
});
