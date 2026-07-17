import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { TERMINAL_GENERATION_JOB_STATUSES } from "../chat/generation_continuation_shared";

export async function presentationGenerationJobIsActive(
  ctx: ActionCtx,
  jobId: Id<"generationJobs">,
): Promise<boolean> {
  const job = await ctx.runQuery(internal.chat.queries.getGenerationJobInternal, { jobId });
  return Boolean(job && !TERMINAL_GENERATION_JOB_STATUSES.has(job.status));
}
