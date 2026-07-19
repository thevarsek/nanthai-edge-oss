import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { releaseExecutionForContinuation } from "../execution/control_plane";
import { transitionGenerationRoundHandler } from "./generation_round_journal";

export async function commitGenerationCheckpointBoundary(
  ctx: MutationCtx,
  args: {
    jobId: Id<"generationJobs">;
    userId: string;
    roundKey?: string;
    checkpointBeforeProviderDispatch?: true;
    executionAttemptId: Id<"executionAttempts">;
    executionFence: number;
  },
): Promise<void> {
  const round = args.roundKey
    ? await ctx.db
      .query("generationRoundJournal")
      .withIndex("by_job_round", (q) =>
        q.eq("jobId", args.jobId).eq("roundKey", args.roundKey as string)
      )
      .unique()
    : null;
  const wasCommitted = round?.phase === "committed";
  if (args.roundKey) {
    const committed = await transitionGenerationRoundHandler(ctx, {
      ...args,
      roundKey: args.roundKey,
      phase: "committed",
      allowPreDispatchCommit: args.checkpointBeforeProviderDispatch === true,
    });
    if (!committed) throw new Error("GENERATION_CHECKPOINT_ROUND_REJECTED");
  }

  const attempt = await ctx.db.get(args.executionAttemptId);
  if (!attempt || attempt.fence !== args.executionFence) {
    throw new Error("GENERATION_CHECKPOINT_ATTEMPT_MISMATCH");
  }
  if (attempt.status === "waiting") {
    const run = await ctx.db.get(attempt.runId);
    if (!run || run.activeAttemptId !== attempt._id || run.state !== "waiting") {
      throw new Error("GENERATION_CHECKPOINT_WAITING_STATE_MISMATCH");
    }
    return;
  }
  if (attempt.status === "interrupted" && wasCommitted) {
    const run = await ctx.db.get(attempt.runId);
    if (!run || run.activeAttemptId !== attempt._id || run.state !== "interrupted") {
      throw new Error("GENERATION_CHECKPOINT_INTERRUPTED_STATE_MISMATCH");
    }
    return;
  }
  await releaseExecutionForContinuation(ctx, {
    attemptId: args.executionAttemptId,
    fence: args.executionFence,
    checkpointRef: args.roundKey
      ? `generation:${String(args.jobId)}:round:${args.roundKey}`
      : `generation:${String(args.jobId)}`,
  });
}
