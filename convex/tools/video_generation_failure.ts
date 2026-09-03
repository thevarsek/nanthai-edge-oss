import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { completeDeferredToolHandler } from "../chat/workflow_resume_handlers";
import {
  ensureVideoProviderReconciliationRef,
  releaseVideoOutputUpload,
} from "../chat/video_cleanup";

export type ToolVideoFailureResult =
  | "completed"
  | "duplicate"
  | "missing"
  | "resumed"
  | "terminal";

export async function failOwnedToolVideo(
  ctx: MutationCtx,
  args: {
    job: Doc<"videoJobs">;
    error: string;
    workflowResumeEventId?: string;
    providerFailed?: boolean;
  },
): Promise<ToolVideoFailureResult> {
  const { job } = args;
  if (job.status === "completed") return "completed";
  const now = Date.now();
  await ctx.db.patch(job._id, {
    status: "failed",
    outputUploadId: undefined,
    error: args.error.slice(0, 2_000),
    lastPolledAt: now,
    ...(args.providerFailed
      ? {
          providerTerminalAt: job.providerTerminalAt ?? now,
          providerTerminalStatus: "failed" as const,
        }
      : {}),
  });
  if (
    job.openRouterJobId && job.providerTerminalAt === undefined
    && !args.providerFailed && job.executionRunId
  ) {
    await ensureVideoProviderReconciliationRef(ctx, {
      runId: job.executionRunId,
      attemptId: job.executionAttemptId,
      userId: job.userId,
      videoJobId: job._id,
      now,
    });
  }
  if (job.outputUploadId) {
    await releaseVideoOutputUpload(ctx, job.outputUploadId);
  }
  if (!job.generationJobId || !job.toolCallId) return "missing";
  const parent = await ctx.db.get(job.generationJobId);
  if (!parent || ["completed", "failed", "cancelled", "timedOut"].includes(parent.status)) {
    return "terminal";
  }
  const eventId = job.parentResumeEventId ?? args.workflowResumeEventId;
  if (!eventId) return "missing";
  return await completeDeferredToolHandler(ctx, {
    jobId: job.generationJobId,
    userId: job.userId,
    toolCallId: job.toolCallId,
    toolName: "generate_video",
    result: JSON.stringify({ error: args.error }),
    isError: true,
    eventId,
  });
}

export async function reconcileToolVideoWorkflowFailure(
  ctx: MutationCtx,
  run: Doc<"executionRuns">,
  summary: string,
): Promise<boolean> {
  if (run.domainType !== "video_generation") return false;
  const job = await ctx.db
    .query("videoJobs")
    .withIndex("by_execution_run", (query) => query.eq("executionRunId", run._id))
    .first();
  if (!job || job.userId !== run.userId) return false;
  const result = await failOwnedToolVideo(ctx, { job, error: summary });
  return result !== "missing";
}
