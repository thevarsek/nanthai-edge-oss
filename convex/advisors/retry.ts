import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isTerminalAdvisorRun } from "./shared";

/** Reuse terminal advice for a final-answer retry without re-charging Advisors. */
export async function reuseAdvisorBatchForRetry(
  ctx: MutationCtx,
  args: {
    sourceMessage: Doc<"messages">;
    targetMessageIds: Id<"messages">[];
    userId: string;
  },
): Promise<Id<"advisorBatches"> | null> {
  if (!args.sourceMessage.advisorBatchId) return null;
  const batch = await ctx.db.get(args.sourceMessage.advisorBatchId);
  if (
    !batch ||
    batch.userId !== args.userId ||
    !isReusableBatchStatus(batch.status)
  ) {
    return null;
  }
  const runs = await ctx.db
    .query("advisorRuns")
    .withIndex("by_batch", (query) => query.eq("batchId", batch._id))
    .collect();
  if (runs.length === 0 || runs.some((run) => !isTerminalAdvisorRun(run.status))) {
    return null;
  }
  for (const messageId of args.targetMessageIds) {
    await ctx.db.patch(messageId, { advisorBatchId: batch._id });
  }
  return batch._id;
}

function isReusableBatchStatus(status: Doc<"advisorBatches">["status"]): boolean {
  return status === "synthesizing" || status === "completed" ||
    status === "failed" || status === "cancelled";
}
