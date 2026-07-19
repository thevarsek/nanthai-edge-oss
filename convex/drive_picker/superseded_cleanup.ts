import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";

const cleanupRef = makeFunctionReference<"mutation">(
  "drive_picker/superseded_cleanup:closeSupersededDriveBatches",
);

export async function closeSupersededDriveBatchesHandler(
  ctx: MutationCtx,
  args: {
    jobId: Id<"generationJobs">;
    keepBatchId: Id<"drivePickerBatches">;
  },
): Promise<boolean> {
  let saturated = false;
  for (const status of ["awaiting_pick", "resuming"] as const) {
    const batches = await ctx.db.query("drivePickerBatches")
      .withIndex("by_parent_job_status", (q) => q
        .eq("parentJobId", args.jobId)
        .eq("status", status))
      .take(20);
    saturated ||= batches.length === 20;
    for (const batch of batches) {
      if (batch._id === args.keepBatchId) continue;
      await ctx.db.patch(batch._id, {
        status: status === "resuming" ? "completed" : "cancelled",
        updatedAt: Date.now(),
      });
    }
  }
  if (saturated) await ctx.scheduler.runAfter(0, cleanupRef, args);
  return saturated;
}

export const closeSupersededDriveBatches = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    keepBatchId: v.id("drivePickerBatches"),
  },
  returns: v.boolean(),
  handler: closeSupersededDriveBatchesHandler,
});
