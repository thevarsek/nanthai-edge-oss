import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { cancelOwnedComponents } from "./teardown_components";

interface TeardownAdvance {
  components: Array<{
    componentRefId?: Id<"executionComponentRefs">;
    operationId: string;
    adapterId: string;
    cancelSafeAfter?: number;
    cancelAcknowledgedAt?: number;
  }>;
  done: boolean;
}

async function cancelExecutionRun(
  ctx: ActionCtx,
  runId: Id<"executionRuns">,
  userId: string,
): Promise<boolean> {
  const advanced: TeardownAdvance = await ctx.runMutation(
    internal.execution.teardown.requestRunTeardown,
    {
      runId,
      requestedBy: userId,
      reason: "Scheduled job deleted",
    },
  );
  return advanced.done
    && await cancelOwnedComponents(ctx, advanced.components);
}

export async function cancelScheduledJobAndDeleteHandler(
  ctx: ActionCtx,
  args: { jobId: Id<"scheduledJobs">; userId: string },
): Promise<null> {
  const job = await ctx.runQuery(internal.scheduledJobs.queries.getJobInternal, {
    jobId: args.jobId,
  });
  if (!job || job.userId !== args.userId) return null;
  if (
    job.executionRunId
    && !await cancelExecutionRun(ctx, job.executionRunId, args.userId)
  ) {
    await ctx.scheduler.runAfter(
      5_000,
      internal.execution.teardown.cancelScheduledJobAndDelete,
      args,
    );
    return null;
  }
  if (job.activeGenerationJobId) {
    const generationJob = await ctx.runQuery(
      internal.chat.queries.getGenerationJobInternal,
      { jobId: job.activeGenerationJobId },
    );
    if (
      generationJob?.executionRunId
      && generationJob.executionRunId !== job.executionRunId
      && !await cancelExecutionRun(ctx, generationJob.executionRunId, args.userId)
    ) {
      await ctx.scheduler.runAfter(
        5_000,
        internal.execution.teardown.cancelScheduledJobAndDelete,
        args,
      );
      return null;
    }
  }
  const deleted = await ctx.runMutation(
    internal.scheduledJobs.mutations.deleteJobBatchInternal,
    args,
  );
  if (!deleted) {
    await ctx.scheduler.runAfter(
      0,
      internal.execution.teardown.cancelScheduledJobAndDelete,
      args,
    );
  }
  return null;
}
