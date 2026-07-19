import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { cancelExecutionForGenerationJob } from "../execution/cancellation";

async function cancelScheduled(
  ctx: MutationCtx,
  scheduledId: Id<"_scheduled_functions"> | undefined,
): Promise<void> {
  if (!scheduledId) return;
  try {
    await ctx.scheduler.cancel(scheduledId);
  } catch {
    // Already running or terminal.
  }
}

export async function cancelAssistantGenerationRows(
  ctx: MutationCtx,
  messageIds: Id<"messages">[],
  userId: string,
  now: number,
): Promise<void> {
  for (const messageId of messageIds) {
    const jobs = await ctx.db
      .query("generationJobs")
      .withIndex("by_message", (query) => query.eq("messageId", messageId))
      .collect();
    for (const job of jobs) {
      await cancelScheduled(ctx, job.scheduledFunctionId);
      if (job.status === "queued" || job.status === "streaming") {
        await cancelExecutionForGenerationJob(ctx, {
          jobId: job._id,
          requestedBy: userId,
          now,
        });
        await ctx.db.patch(job._id, {
          status: "cancelled",
          terminalErrorCode: "cancelled_by_user",
          completedAt: now,
        });
      }
      if (job.streamingMessageId) {
        await ctx.db.patch(job.streamingMessageId, {
          status: "cancelled",
          updatedAt: now,
        });
      }
    }
    const message = await ctx.db.get(messageId);
    if (
      message &&
      (message.status === "pending" || message.status === "streaming")
    ) {
      await ctx.db.patch(messageId, {
        status: "cancelled",
        terminalErrorCode: "cancelled_by_user",
      });
    }
  }
}
