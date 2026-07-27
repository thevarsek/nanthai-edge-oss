import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { contentReportStatus } from "./validators";

export const listForReview = internalQuery({
  args: {
    status: v.optional(contentReportStatus),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    return await ctx.db
      .query("aiContentReports")
      .withIndex("by_status_created", (query) =>
        query.eq("status", args.status ?? "open")
      )
      .order("desc")
      .take(limit);
  },
});

export const updateReviewStatus = internalMutation({
  args: {
    reportId: v.id("aiContentReports"),
    status: v.union(
      v.literal("reviewed"),
      v.literal("actioned"),
      v.literal("dismissed"),
    ),
    reviewNote: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("CONTENT_REPORT_NOT_FOUND");
    const reviewNote = args.reviewNote?.trim().slice(0, 2_000) || undefined;
    const now = Date.now();
    await ctx.db.patch(report._id, {
      status: args.status,
      reviewNote,
      reviewedAt: now,
      updatedAt: now,
    });
  },
});
