import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { requireAuth, requirePro } from "../lib/auth";
import { manualOccurrenceId } from "./occurrence";

export async function runJobNowHandler(ctx: MutationCtx, args: { jobId: Id<"scheduledJobs"> }) {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const job = await ctx.db.get(args.jobId);
  if (!job || job.userId !== userId || job.isDeleting) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Job not found or unauthorized" });
  }
  if (job.status === "paused" && job.recurrence.type === "manual") {
    throw new ConvexError({ code: "VALIDATION", message: "Cannot run a paused manual job — resume it first" });
  }
  await ctx.scheduler.runAfter(0, internal.scheduledJobs.actions.executeScheduledJob, {
    jobId: args.jobId, invocationSource: "manual", occurrenceId: manualOccurrenceId(),
  });
  return { triggered: true, message: "Job execution started" };
}
