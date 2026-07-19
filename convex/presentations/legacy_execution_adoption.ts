import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { TERMINAL_GENERATION_JOB_STATUSES } from
  "../chat/generation_continuation_shared";
import { claimExecutionRun, type ClaimedExecution } from "../execution/attempts";
import { createExecutionRun } from "../execution/runs";
import { PRESENTATION_WORKFLOW_LEASE_MS } from "./limits";
import type { AdoptedPresentationExecution } from "./generation_fanout_refs";
import { failPresentationRunState } from "./generation_fanout_cleanup";
import {
  hasCurrentLegacyPresentationExecution,
  isLegacyPresentationExecution,
} from "./legacy_execution_lifecycle";
import { matchesPresentationExecution } from "./generation_execution_identity";

const ACTIVE_PRESENTATION_RUN_STATUSES: ReadonlySet<string> = new Set([
  "generating",
  "curator_queued",
  "curating",
  "finalizing",
] as const);

type ExecutionLink = {
  executionRunId?: Id<"executionRuns">;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
};

function hasAnyExecutionLink(link: ExecutionLink): boolean {
  return link.executionRunId !== undefined
    || link.executionAttemptId !== undefined
    || link.executionFence !== undefined;
}

function hasCompleteExecutionLink(link: ExecutionLink): link is Required<ExecutionLink> {
  return link.executionRunId !== undefined
    && link.executionAttemptId !== undefined
    && link.executionFence !== undefined;
}

function projectLinkCanFollowRun(
  project: ExecutionLink,
  run: Required<ExecutionLink>,
): boolean {
  if (!hasAnyExecutionLink(project)) return true;
  return hasCompleteExecutionLink(project)
    && project.executionRunId === run.executionRunId
    && project.executionAttemptId === run.executionAttemptId
    && project.executionFence === run.executionFence;
}

async function claimLegacyExecution(
  ctx: MutationCtx,
  presentationRun: Doc<"presentationGenerationRuns">,
  executionRun: Doc<"executionRuns">,
): Promise<ClaimedExecution | null> {
  if (!executionRun.activeAttemptId) return null;
  const activeAttempt = await ctx.db.get(executionRun.activeAttemptId);
  if (!activeAttempt
      || !isLegacyPresentationExecution(executionRun, activeAttempt, presentationRun)) {
    return null;
  }
  return await claimExecutionRun(ctx, {
    runId: executionRun._id,
    claimantId: `presentation:${String(presentationRun.projectId)}`,
    leaseMs: PRESENTATION_WORKFLOW_LEASE_MS,
  });
}

async function linkedLegacyExecution(
  ctx: MutationCtx,
  run: Doc<"presentationGenerationRuns"> & Required<ExecutionLink>,
): Promise<ClaimedExecution | null> {
  const [executionRun, linkedAttempt] = await Promise.all([
    ctx.db.get(run.executionRunId),
    ctx.db.get(run.executionAttemptId),
  ]);
  if (!executionRun
      || !linkedAttempt
      || linkedAttempt.fence !== run.executionFence
      || !isLegacyPresentationExecution(executionRun, linkedAttempt, run)) {
    return null;
  }
  return await claimLegacyExecution(ctx, run, executionRun);
}

async function createOrClaimLegacyExecution(
  ctx: MutationCtx,
  run: Doc<"presentationGenerationRuns">,
  job: Doc<"generationJobs">,
): Promise<ClaimedExecution | null> {
  const runKey = `presentation:${String(run.projectId)}`;
  const existing = await ctx.db.query("executionRuns")
    .withIndex("by_user_run_key", (query) =>
      query.eq("userId", run.userId).eq("runKey", runKey)
    ).unique();
  if (existing) return await claimLegacyExecution(ctx, run, existing);

  let parentRunId: Id<"executionRuns"> | undefined;
  if (job.executionRunId) {
    const parent = await ctx.db.get(job.executionRunId);
    if (!parent || parent.userId !== run.userId ||
        ["cancelling", "completed", "failed", "cancelled"].includes(parent.state)) {
      return null;
    }
    parentRunId = parent._id;
  }
  const created = await createExecutionRun(ctx, {
    userId: run.userId,
    runKey,
    chatId: job.chatId,
    sourceMessageId: job.messageId,
    generationJobId: job._id,
    domainType: "presentation",
    domainId: String(run.projectId),
    parentRunId,
    kind: "presentation",
    requestedPlacement: "cloud",
    initialAttempt: {
      executorKind: "convex_action",
      placement: "cloud",
      adapterId: "legacy-scheduler",
      provider: run.selectedModelId.split("/")[0],
      modelId: run.selectedModelId,
      orchestrationEngine: "legacy_scheduler",
      orchestrationVersion: "pre-m47-adopted-v1",
      rolloutCohort: "legacy-drain",
    },
  });
  const executionRun = await ctx.db.get(created.runId);
  return executionRun ? await claimLegacyExecution(ctx, run, executionRun) : null;
}

export async function adoptLegacyPresentationExecutionHandler(
  ctx: MutationCtx,
  args: { runId: Id<"presentationGenerationRuns"> },
): Promise<AdoptedPresentationExecution | null> {
  const run = await ctx.db.get(args.runId);
  if (!run || !ACTIVE_PRESENTATION_RUN_STATUSES.has(run.status) || run.workflowId) {
    return null;
  }
  const [project, job] = await Promise.all([
    ctx.db.get(run.projectId),
    ctx.db.get(run.jobId),
  ]);
  if (!project
      || project.userId !== run.userId
      || project.status !== "generating"
      || project.revision !== run.projectRevision
      || project.workflowId
      || !job
      || job.userId !== run.userId
      || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)) {
    return null;
  }

  const runHasAnyLink = hasAnyExecutionLink(run);
  if (runHasAnyLink && !hasCompleteExecutionLink(run)) return null;
  if (!runHasAnyLink && hasAnyExecutionLink(project)) return null;
  if (hasCompleteExecutionLink(run) && !projectLinkCanFollowRun(project, run)) return null;

  const claimed = hasCompleteExecutionLink(run)
    ? await linkedLegacyExecution(ctx, run)
    : await createOrClaimLegacyExecution(ctx, run, job);
  if (!claimed) return null;

  const adopted = {
    executionRunId: claimed.runId,
    executionAttemptId: claimed.attemptId,
    executionFence: claimed.fence,
  };
  const now = Date.now();
  await Promise.all([
    ctx.db.patch(run._id, { ...adopted, updatedAt: now }),
    ctx.db.patch(project._id, { ...adopted, updatedAt: now }),
  ]);
  return adopted;
}

export const adoptLegacyPresentationExecution = internalMutation({
  args: { runId: v.id("presentationGenerationRuns") },
  returns: v.union(v.null(), v.object({
    executionRunId: v.id("executionRuns"),
    executionAttemptId: v.id("executionAttempts"),
    executionFence: v.number(),
  })),
  handler: adoptLegacyPresentationExecutionHandler,
});

export async function cancelAdoptedLegacyPresentationExecutionHandler(
  ctx: MutationCtx,
  args: {
    runId: Id<"presentationGenerationRuns">;
    executionAttemptId: Id<"executionAttempts">;
    executionFence: number;
  },
): Promise<boolean> {
  const run = await ctx.db.get(args.runId);
  if (!run
      || run.workflowId
      || !ACTIVE_PRESENTATION_RUN_STATUSES.has(run.status)
      || !matchesPresentationExecution(run, args)) return false;
  const [job, project] = await Promise.all([
    ctx.db.get(run.jobId),
    ctx.db.get(run.projectId),
  ]);
  if (!job
      || !TERMINAL_GENERATION_JOB_STATUSES.has(job.status)
      || !project
      || project.userId !== run.userId
      || project.status !== "generating"
      || project.revision !== run.projectRevision
      || !(await hasCurrentLegacyPresentationExecution(ctx, run))) return false;

  const error = "Presentation generation was cancelled before it finished.";
  const now = Date.now();
  await failPresentationRunState(ctx, run, error, now, "cancelled");
  await ctx.db.patch(project._id, {
    status: "failed",
    workflowPhase: "failed",
    error,
    revision: project.revision + 1,
    updatedAt: now,
  });
  return true;
}

export const cancelAdoptedLegacyPresentationExecution = internalMutation({
  args: {
    runId: v.id("presentationGenerationRuns"),
    executionAttemptId: v.id("executionAttempts"),
    executionFence: v.number(),
  },
  returns: v.boolean(),
  handler: cancelAdoptedLegacyPresentationExecutionHandler,
});
