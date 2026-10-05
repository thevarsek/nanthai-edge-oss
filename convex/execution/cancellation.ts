import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  enqueueActiveLocalTurnCancellation,
  LOCAL_CANCEL_COMMAND_WINDOW_MS,
} from "../runtime_host/chat_cancellation";
import { appendExecutionEvent, ensureGenerationExecution } from "./control_plane";
import { closeRunWriterForCancellation } from "./cancel_fence";

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
  const now = args.now ?? Date.now();
  const reason = `Cancelled by ${args.requestedBy}`;
  await closeRunWriterForCancellation(
    ctx,
    run._id,
    args.requestedBy,
    reason,
    now,
  );
  const localCancellation = await enqueueActiveLocalTurnCancellation(ctx, {
    job,
    run,
    requestedBy: args.requestedBy,
    reason,
    now,
  });
  if (localCancellation) {
    await ctx.scheduler.runAfter(
      LOCAL_CANCEL_COMMAND_WINDOW_MS,
      internal.execution.teardown.cancelRunTree,
      { runId: run._id, requestedBy: args.requestedBy, reason },
    );
    return true;
  }
  // Advance paginated teardown only from its per-run action. Chat Stop can
  // fence several participant runs in one mutation, while Convex permits only
  // one paginated query per function invocation.
  await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, {
    runId: run._id,
    requestedBy: args.requestedBy,
    reason,
  });
  return true;
}
