import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation } from "../_generated/server";
import { finalizeGenerationHandler } from
  "../chat/mutations_internal_handlers";
import { cancelExecutionForGenerationJob } from "../execution/cancellation";

export async function abortScheduledChildHandler(
  ctx: Parameters<typeof finalizeGenerationHandler>[0],
  args: { jobId: Id<"scheduledJobs">; executionId: string; error: string },
): Promise<boolean> {
  const scheduledJob = await ctx.db.get(args.jobId);
  if (!scheduledJob || scheduledJob.activeExecutionId !== args.executionId) {
    return false;
  }
  const generationJobId = scheduledJob.activeGenerationJobId;
  if (!generationJobId) return false;
  const generationJob = await ctx.db.get(generationJobId);
  if (
    !generationJob
    || ["completed", "failed", "cancelled", "timedOut"].includes(
      generationJob.status,
    )
  ) return false;
  await cancelExecutionForGenerationJob(ctx, {
    jobId: generationJob._id,
    requestedBy: "scheduled-execution-failure",
  });
  await finalizeGenerationHandler(ctx, {
    messageId: generationJob.messageId,
    jobId: generationJob._id,
    chatId: generationJob.chatId,
    content: `Error: ${args.error}`,
    status: "failed",
    error: args.error,
    userId: generationJob.userId,
    skipExecutionTerminalization: true,
  });
  return true;
}

export const abortScheduledChild = internalMutation({
  args: {
    jobId: v.id("scheduledJobs"),
    executionId: v.string(),
    error: v.string(),
  },
  returns: v.boolean(),
  handler: abortScheduledChildHandler,
});
