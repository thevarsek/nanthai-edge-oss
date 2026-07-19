import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const getByMessage = internalQuery({
  args: { messageId: v.id("messages") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => await ctx.db
    .query("videoJobs")
    .withIndex("by_messageId", (q) => q.eq("messageId", args.messageId))
    .order("desc")
    .first(),
});
