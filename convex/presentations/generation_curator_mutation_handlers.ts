import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  linkPresentationWorkpool,
  renewPresentationExecutionLease,
} from "./generation_fanout_start";
import { presentationError } from "./limits";
import { TERMINAL_GENERATION_JOB_STATUSES } from "../chat/generation_continuation_shared";
import { interactiveWorkpool } from "../execution/components";
import {
  runPresentationCuratorTaskRef,
  runPresentationFinalizerRef,
} from "./generation_fanout_refs";
import { internal } from "../_generated/api";
import {
  matchesPresentationExecution,
  type PresentationExecutionIdentity,
} from "./generation_execution_identity";

export type PresentationCuratorDispatch = {
  enqueueTask: (
    ctx: MutationCtx,
    args: {
      taskId: Id<"presentationCuratorTasks">;
      runId: Id<"presentationGenerationRuns">;
      retry: boolean;
    } & PresentationExecutionIdentity,
  ) => Promise<string>;
  enqueueFinalizer: (
    ctx: MutationCtx,
    args: { runId: Id<"presentationGenerationRuns"> } & PresentationExecutionIdentity,
  ) => Promise<string>;
};

export const defaultCuratorDispatch: PresentationCuratorDispatch = {
  enqueueTask: async (ctx, args) => await interactiveWorkpool.enqueueAction(
    ctx,
    runPresentationCuratorTaskRef,
    {
      taskId: args.taskId,
      executionAttemptId: args.executionAttemptId,
      executionFence: args.executionFence,
    },
    {
      retry: false,
      name: args.retry ? "presentation-curator-retry" : "presentation-curator-task",
      onComplete:
        internal.presentations.generation_fanout_mutations
          .reconcilePresentationWork,
      context: {
        runId: args.runId,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
      },
    },
  ),
  enqueueFinalizer: async (ctx, args) => await interactiveWorkpool.enqueueAction(
    ctx,
    runPresentationFinalizerRef,
    args,
    {
      retry: false,
      name: "presentation-finalizer",
      onComplete:
        internal.presentations.generation_fanout_mutations
          .reconcilePresentationWork,
      context: args,
    },
  ),
};

function appendModel(models: string[], modelId: string | undefined): string[] {
  return modelId ? [...new Set([...models, modelId])] : models;
}

export async function queueFinalizer(
  ctx: MutationCtx,
  runId: Id<"presentationGenerationRuns">,
  identity: PresentationExecutionIdentity,
  dispatch: PresentationCuratorDispatch,
): Promise<void> {
  const finalizerWorkpoolOperationId = await dispatch.enqueueFinalizer(ctx, {
    runId,
    ...identity,
  });
  const run = await ctx.db.get(runId);
  if (run) {
    await linkPresentationWorkpool(ctx, run, identity, finalizerWorkpoolOperationId, "presentation-finalizer");
  }
  await ctx.db.patch(runId, {
    status: "finalizing",
    finalizerWorkpoolOperationId,
    updatedAt: Date.now(),
  });
  await renewPresentationExecutionLease(ctx, runId, identity);
}

export async function claimPresentationCuratorHandler(
  ctx: MutationCtx,
  args: { runId: Id<"presentationGenerationRuns"> } & PresentationExecutionIdentity,
): Promise<boolean> {
  const run = await ctx.db.get(args.runId);
  if (!run || !matchesPresentationExecution(run, args) || run.status !== "curator_queued") return false;
  await renewPresentationExecutionLease(ctx, run._id, args);
  const job = await ctx.db.get(run.jobId);
  if (!job || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)) return false;
  await ctx.db.patch(run._id, { status: "curating", updatedAt: Date.now() });
  await renewPresentationExecutionLease(ctx, run._id, args);
  return true;
}

export async function startPresentationCuratorTasksHandler(ctx: MutationCtx, args: {
  runId: Id<"presentationGenerationRuns">;
  tasks: Array<{
    taskKey: string;
    kind: "recompose" | "consolidate";
    slideIds: string[];
  }>;
} & PresentationExecutionIdentity, dispatch: PresentationCuratorDispatch = defaultCuratorDispatch) {
  const run = await ctx.db.get(args.runId);
  if (!run || !matchesPresentationExecution(run, args) || run.status !== "curating") {
    return { started: false, taskCount: 0 };
  }
  await renewPresentationExecutionLease(ctx, run._id, args);
  const job = await ctx.db.get(run.jobId);
  if (!job || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)) {
    return { started: false, taskCount: 0 };
  }
  const existing = await ctx.db.query("presentationCuratorTasks")
    .withIndex("by_run", (query) => query.eq("runId", run._id)).collect();
  if (existing.length > 0) return { started: false, taskCount: existing.length };
  if (args.tasks.length === 0) {
    await queueFinalizer(ctx, run._id, args, dispatch);
    return { started: true, taskCount: 0 };
  }
  const seenKeys = new Set<string>();
  const ownedSlides = new Set<string>();
  for (const task of args.tasks) {
    if (!task.taskKey || seenKeys.has(task.taskKey) || task.slideIds.length === 0) {
      throw presentationError("VALIDATION", "Curator tasks must have unique keys and slide targets.");
    }
    if (task.slideIds.some((slideId) =>
      !run.expectedSlideIds.includes(slideId) || ownedSlides.has(slideId)
    )) {
      throw presentationError("VALIDATION", "Curator tasks must own disjoint expected slides.");
    }
    seenKeys.add(task.taskKey);
    task.slideIds.forEach((slideId) => ownedSlides.add(slideId));
  }
  const now = Date.now();
  for (const task of args.tasks) {
    const taskId = await ctx.db.insert("presentationCuratorTasks", {
      runId: run._id,
      userId: run.userId,
      taskKey: task.taskKey,
      kind: task.kind,
      slideIds: task.slideIds,
      status: "queued",
      mode: "patch",
      attempt: 0,
      effectiveModelIds: [],
      createdAt: now,
      updatedAt: now,
    });
    const workpoolOperationId = await dispatch.enqueueTask(ctx, {
      taskId,
      runId: run._id,
      retry: false,
      executionAttemptId: args.executionAttemptId,
      executionFence: args.executionFence,
    });
    await linkPresentationWorkpool(
      ctx,
      run,
      args,
      workpoolOperationId,
      `presentation-curator-task:${task.taskKey}`,
    );
    await ctx.db.patch(taskId, { workpoolOperationId });
  }
  return { started: true, taskCount: args.tasks.length };
}

export async function claimPresentationCuratorTaskHandler(ctx: MutationCtx, args: {
  taskId: Id<"presentationCuratorTasks">;
} & PresentationExecutionIdentity): Promise<boolean> {
  const task = await ctx.db.get(args.taskId);
  if (!task || task.status !== "queued") return false;
  const run = await ctx.db.get(task.runId);
  if (!run || !matchesPresentationExecution(run, args) || run.status !== "curating") return false;
  await renewPresentationExecutionLease(ctx, run._id, args);
  const job = await ctx.db.get(run.jobId);
  if (!job || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)) return false;
  const project = await ctx.db.get(run.projectId);
  if (!project || project.status !== "generating" || project.revision !== run.projectRevision) {
    return false;
  }
  await ctx.db.patch(task._id, { status: "running", updatedAt: Date.now() });
  return true;
}

export async function retryPresentationCuratorTaskHandler(ctx: MutationCtx, args: {
  taskId: Id<"presentationCuratorTasks">;
  mode: "patch" | "recreate";
  attempt: number;
  error: string;
  effectiveModelId?: string;
} & PresentationExecutionIdentity, dispatch: PresentationCuratorDispatch = defaultCuratorDispatch): Promise<boolean> {
  const task = await ctx.db.get(args.taskId);
  if (!task || task.status !== "running") return false;
  const run = await ctx.db.get(task.runId);
  if (!run || !matchesPresentationExecution(run, args) || run.status !== "curating") return false;
  await renewPresentationExecutionLease(ctx, run._id, args);
  const job = await ctx.db.get(run.jobId);
  if (!job || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)) return false;
  const workpoolOperationId = await dispatch.enqueueTask(ctx, {
    taskId: task._id,
    runId: run._id,
    retry: true,
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
  });
  await linkPresentationWorkpool(
    ctx,
    run,
    args,
    workpoolOperationId,
    `presentation-curator-retry:${task.taskKey}:${args.attempt}`,
  );
  await ctx.db.patch(task._id, {
    status: "queued",
    mode: args.mode,
    attempt: args.attempt,
    effectiveModelIds: appendModel(task.effectiveModelIds, args.effectiveModelId),
    workpoolOperationId,
    error: args.error.slice(0, 500),
    updatedAt: Date.now(),
  });
  await renewPresentationExecutionLease(ctx, run._id, args);
  return true;
}

export { completePresentationCuratorTaskHandler } from "./generation_curator_completion";
