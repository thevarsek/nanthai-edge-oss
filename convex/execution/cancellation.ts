import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { appendExecutionEvent, ensureGenerationExecution } from "./control_plane";
import { requestRunTreeTeardown } from "./teardown_graph";

export async function requestExecutionCancellation(
  ctx: MutationCtx,
  args: { jobId: Id<"generationJobs">; requestedBy: string; now?: number },
): Promise<boolean> {
  const now = args.now ?? Date.now();
  const execution = await ensureGenerationExecution(ctx, args.jobId, now);
  if (!execution) return false;
  const run = await ctx.db.get(execution.runId);
  if (!run || ["completed", "failed", "cancelled"].includes(run.state)) return false;
  await appendExecutionEvent(ctx, {
    attemptId: execution.attemptId,
    fence: execution.fence,
    type: "cancel_requested",
    summary: `Cancellation requested by ${args.requestedBy}`,
    now,
  });
  await ctx.db.patch(run._id, {
    state: "cancelling",
    cancelRequestedAt: now,
    cancelRequestedBy: args.requestedBy,
    updatedAt: now,
  });
  return true;
}

export async function cancelExecutionForGenerationJob(
  ctx: MutationCtx,
  args: { jobId: Id<"generationJobs">; requestedBy: string; now?: number },
): Promise<boolean> {
  const job = await ctx.db.get(args.jobId);
  if (!job?.executionRunId) return false;
  const run = await ctx.db.get(job.executionRunId);
  if (!run || ["completed", "failed", "cancelled"].includes(run.state)) return false;
  await requestRunTreeTeardown(
    ctx,
    run._id,
    args.requestedBy,
    `Cancelled by ${args.requestedBy}`,
  );
  // Component cancellation is intentionally completed by the common teardown
  // action. Workflow/workpool cancel acknowledges intent, but in-flight action
  // code may still be draining; its component ref remains cancel_requested
  // until callback/quiescence reconciliation makes terminalization safe.
  await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, {
    runId: run._id,
    requestedBy: args.requestedBy,
    reason: `Cancelled by ${args.requestedBy}`,
  });
  return true;
}
