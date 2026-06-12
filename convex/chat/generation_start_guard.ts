import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { TERMINAL_GENERATION_JOB_STATUSES } from "./generation_continuation_shared";

export async function markGenerationJobStreamingIfActive(
  ctx: ActionCtx,
  jobId: Id<"generationJobs">,
): Promise<boolean> {
  await ctx.runMutation(internal.chat.mutations.updateJobStatus, {
    jobId,
    status: "streaming",
    startedAt: Date.now(),
  });
  const job = await ctx.runQuery(internal.chat.queries.getGenerationJobInternal, {
    jobId,
  });
  return !!job && !TERMINAL_GENERATION_JOB_STATUSES.has(job.status);
}

export async function markGenerationJobAnalyticsStarted(
  ctx: ActionCtx,
  jobId: Id<"generationJobs">,
): Promise<boolean> {
  const didMark = await ctx.runMutation(internal.chat.mutations.markGenerationJobAnalyticsStarted, {
    jobId,
  });
  return didMark !== false;
}
