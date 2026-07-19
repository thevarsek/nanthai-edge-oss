import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { computeNextRunTime } from "./recurrence";
import type { Recurrence } from "./recurrence";
import { scheduledOccurrenceId } from "./occurrence";

/** Atomically installs the successor of a consumed recurring occurrence. */
export async function ensureNextOccurrenceHandler(
  ctx: MutationCtx,
  args: {
    jobId: Id<"scheduledJobs">;
    occurrenceId: string;
    invocationSource: "scheduled" | "manual" | "api";
  },
): Promise<null> {
    if (args.invocationSource !== "scheduled") return null;
    const job = await ctx.db.get(args.jobId);
    if (
      !job
      || job.status !== "active"
      || job.isDeleting
      || job.lastScheduledOccurrenceId === args.occurrenceId
    ) return null;
    const nextRunAt = computeNextRunTime(job.recurrence as Recurrence, job.timezone);
    if (nextRunAt === null) return null;
    const nextOccurrenceId = scheduledOccurrenceId(job._id, nextRunAt);
    const scheduledFunctionId = await ctx.scheduler.runAt(
      nextRunAt,
      internal.scheduledJobs.actions.executeScheduledJob,
      { jobId: job._id, occurrenceId: nextOccurrenceId },
    );
    const previous = job.scheduledFunctionId;
    await ctx.db.patch(job._id, {
      nextRunAt,
      scheduledFunctionId,
      nextScheduledOccurrenceId: nextOccurrenceId,
      lastScheduledOccurrenceId: args.occurrenceId,
      updatedAt: Date.now(),
    });
    if (previous && previous !== scheduledFunctionId) {
      await ctx.scheduler.cancel(previous).catch(() => undefined);
    }
    return null;
}

export const ensureNextOccurrence = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    occurrenceId: v.string(),
    invocationSource: v.union(
      v.literal("scheduled"),
      v.literal("manual"),
      v.literal("api"),
    ),
  },
  returns: v.null(),
  handler: ensureNextOccurrenceHandler,
});
