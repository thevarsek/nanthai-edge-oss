// convex/scheduledJobs/queries.ts
// =============================================================================
// Scheduled job queries — public (authenticated) and internal.
// =============================================================================

import { v } from "convex/values";
import { query, internalAction, internalQuery } from "../_generated/server";
import { requireAuth } from "../lib/auth";

/** List all scheduled jobs for the authenticated user. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    return await ctx.db
      .query("scheduledJobs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

/** Get a single scheduled job. */
export const get = query({
  args: { jobId: v.id("scheduledJobs") },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) return null;
    return job;
  },
});

/** List run history for a job (most recent first, paginated). */
export const listRuns = query({
  args: {
    jobId: v.id("scheduledJobs"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    // Verify job belongs to user
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== userId) return [];

    return await ctx.db
      .query("jobRuns")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("desc")
      .take(Math.min(Math.max(Math.floor(args.limit ?? 20), 1), 100));
  },
});

/** Check whether the authenticated user has an OpenRouter API key stored. */
export const hasApiKey = query({
  args: {},
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const secret = await ctx.db
      .query("userSecrets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return secret !== null;
  },
});

// ── Internal queries (for actions — no auth context) ───────────────────

/** Internal: list all scheduled jobs for a user (for AI tools). */
export const listJobsInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scheduledJobs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

/** Internal: get job config for execution. */
export const getJobInternal = internalQuery({
  args: { jobId: v.id("scheduledJobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

/** Internal: get the user's API key from userSecrets. */
export const getUserApiKey = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const secret = await ctx.db
      .query("userSecrets")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    return secret?.apiKey ?? null;
  },
});

/** Internal: load KB file contents from storage IDs. */
export const getKBFileContents = internalAction({
  args: { storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    const results: Array<{ storageId: string; content: string }> = [];
    for (const storageId of args.storageIds) {
      try {
        const blob = await ctx.storage.get(storageId);
        if (!blob) continue;
        const text = await blob.text();
        results.push({ storageId: storageId as string, content: text });
      } catch {
        // Silently skip missing/unreadable files (logged in execution action)
        console.warn(`KB file ${storageId} not found or unreadable, skipping`);
      }
    }
    return results;
  },
});
