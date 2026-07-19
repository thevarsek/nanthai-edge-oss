import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { finalizeGenerationHandler } from "../chat/mutations_internal_handlers";
import { cancelExecutionForGenerationJob } from "../execution/cancellation";
import { terminalizeDomainExecution } from "../execution/domain_lifecycle";
import { advisorExecutionRef } from "./execution_lifecycle";

export async function failAdvisorSynthesis(
  ctx: MutationCtx,
  batchId: Id<"advisorBatches">,
  error: string,
): Promise<void> {
  const batch = await ctx.db.get(batchId);
  if (!batch || ["completed", "failed", "cancelled"].includes(batch.status)) return;
  const now = Date.now();
  for (const messageId of batch.assistantMessageIds) {
    const message = await ctx.db.get(messageId);
    if (message && (message.status === "pending" || message.status === "streaming")) {
      await ctx.db.patch(message._id, {
        status: "failed",
        content: message.content || "Advisor synthesis could not be completed.",
      });
    }
    const jobs = await ctx.db.query("generationJobs")
      .withIndex("by_message", (query) => query.eq("messageId", messageId))
      .collect();
    for (const job of jobs) {
      if (job.status !== "queued" && job.status !== "streaming") continue;
      await cancelExecutionForGenerationJob(ctx, {
        jobId: job._id,
        requestedBy: "advisor-synthesis-failure",
        now,
      });
      await finalizeGenerationHandler(ctx, {
        messageId,
        jobId: job._id,
        chatId: batch.chatId,
        content: message?.content || "Advisor synthesis could not be completed.",
        status: "failed",
        error: error.slice(0, 2_000),
        userId: batch.userId,
        skipExecutionTerminalization: true,
      });
    }
  }
  await ctx.db.patch(batch._id, { status: "failed", updatedAt: now });
  const execution = advisorExecutionRef(batch);
  if (execution) {
    await terminalizeDomainExecution(ctx, execution, "failed", error.slice(0, 2_000));
  }
}
