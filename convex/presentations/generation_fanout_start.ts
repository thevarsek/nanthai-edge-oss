import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { buildPresentationStudioBatches } from "./generation_fanout";
import { presentationError } from "./limits";
import { getOwnedProject, throwRevisionConflict } from "./mutation_helpers";
import { interactiveWorkpool } from "../execution/components";
import {
  runPresentationCuratorRef,
  runPresentationCuratorTaskRef,
  runPresentationFinalizerRef,
  runPresentationStudioRef,
  runPresentationStudioRepairRef,
} from "./generation_fanout_refs";
import { linkExecutionComponent } from "../execution/component_refs";
import { heartbeatExecution } from "../execution/control_plane";
import { internal } from "../_generated/api";
import {
  matchesPresentationExecution,
  type PresentationExecutionIdentity,
} from "./generation_execution_identity";
import {
  PRESENTATION_FINALIZER_WATCHDOG_MS,
  scheduleWorkpoolCompletionWatchdog,
} from "../execution/workpool_watchdog_schedule";
export { renewPresentationExecutionLease } from "./generation_execution_identity";

export async function linkPresentationWorkpool(
  ctx: MutationCtx,
  run: Pick<Doc<"presentationGenerationRuns">, "_id" | "executionRunId" | "executionAttemptId" | "executionFence">,
  identity: PresentationExecutionIdentity,
  operationId: string,
  role: string,
): Promise<void> {
  if (!run.executionRunId) return;
  await linkExecutionComponent(ctx, {
    runId: run.executionRunId,
    attemptId: identity.executionAttemptId,
    fence: identity.executionFence,
    adapterId: "interactive-workpool",
    operationId,
    role,
  });
  await scheduleWorkpoolCompletionWatchdog(ctx, {
    kind: "presentation_work",
    operationId,
    runId: run._id,
    executionAttemptId: identity.executionAttemptId,
    executionFence: identity.executionFence,
    role,
  }, role === "presentation-finalizer" || role.startsWith("presentation-finalizer-recovery:")
    ? PRESENTATION_FINALIZER_WATCHDOG_MS
    : undefined);
}

async function enqueueRecoveredWork(
  ctx: MutationCtx,
  run: Doc<"presentationGenerationRuns">,
  identity: PresentationExecutionIdentity,
): Promise<void> {
  if (run.fanoutDispatchedFence === identity.executionFence) return;
  const enqueue = async (
    action: typeof runPresentationStudioRef,
    actionArgs: Record<string, unknown>,
    context: Record<string, unknown>,
    name: string,
    role: string,
  ) => {
    const operationId = await interactiveWorkpool.enqueueAction(
      ctx,
      action,
      actionArgs as never,
      {
        retry: false,
        name,
        onComplete: internal.presentations.generation_fanout_mutations.reconcilePresentationWork,
        context: context as never,
      },
    );
    await linkPresentationWorkpool(ctx, run, identity, operationId, role);
    return operationId;
  };
  const context = { runId: run._id, ...identity };
  if (run.status === "generating") {
    const batches = await ctx.db.query("presentationGenerationBatches")
      .withIndex("by_run", (q) => q.eq("runId", run._id)).collect();
    for (const batch of batches.filter((entry) => entry.status !== "complete")) {
      const repair = batch.repairAttempt > 0;
      await ctx.db.patch(batch._id, { status: repair ? "repairing" : "queued" });
      const operationId = await enqueue(
        repair ? runPresentationStudioRepairRef : runPresentationStudioRef,
        { ...context, batchId: batch._id },
        { ...context, batchId: batch._id },
        repair ? "presentation-studio-repair-recovery" : "presentation-studio-recovery",
        `presentation-studio-recovery:${batch.batchIndex}:${identity.executionFence}`,
      );
      await ctx.db.patch(batch._id, { workpoolOperationId: operationId });
    }
  } else if (run.status === "curator_queued") {
    const operationId = await enqueue(
      runPresentationCuratorRef as typeof runPresentationStudioRef,
      context,
      context,
      "presentation-curator-recovery",
      `presentation-curator-recovery:${identity.executionFence}`,
    );
    await ctx.db.patch(run._id, { curatorWorkpoolOperationId: operationId });
  } else if (run.status === "curating") {
    const tasks = await ctx.db.query("presentationCuratorTasks")
      .withIndex("by_run", (q) => q.eq("runId", run._id)).collect();
    if (tasks.length === 0) {
      await ctx.db.patch(run._id, { status: "curator_queued" });
      const operationId = await enqueue(
        runPresentationCuratorRef as typeof runPresentationStudioRef,
        context,
        context,
        "presentation-curator-recovery",
        `presentation-curator-recovery:${identity.executionFence}`,
      );
      await ctx.db.patch(run._id, { curatorWorkpoolOperationId: operationId });
    } else {
      for (const task of tasks.filter((entry) => entry.status !== "complete")) {
        await ctx.db.patch(task._id, { status: "queued" });
        const operationId = await enqueue(
          runPresentationCuratorTaskRef as unknown as typeof runPresentationStudioRef,
          { taskId: task._id, ...identity },
          context,
          "presentation-curator-task-recovery",
          `presentation-curator-task-recovery:${task.taskKey}:${identity.executionFence}`,
        );
        await ctx.db.patch(task._id, { workpoolOperationId: operationId });
      }
    }
  } else if (run.status === "finalizing") {
    const operationId = await enqueue(
      runPresentationFinalizerRef as typeof runPresentationStudioRef,
      context,
      context,
      "presentation-finalizer-recovery",
      `presentation-finalizer-recovery:${identity.executionFence}`,
    );
    await ctx.db.patch(run._id, { finalizerWorkpoolOperationId: operationId });
  }
  await ctx.db.patch(run._id, {
    fanoutDispatchedFence: identity.executionFence,
    updatedAt: Date.now(),
  });
}

export async function startPresentationFanoutHandler(ctx: MutationCtx, args: {
  projectId: Id<"presentationProjects">;
  userId: string;
  jobId: Id<"generationJobs">;
  toolCallId: string;
  expectedRevision: number;
  modelId: string;
  executionAttemptId: Id<"executionAttempts">;
  executionFence: number;
  requireZdrOverride?: boolean;
}) {
  const project = await getOwnedProject(ctx, args.projectId, args.userId);
  if (!project.executionAttemptId || project.executionFence === undefined) {
    throw presentationError("INVALID_STATE", "Presentation execution identity is missing.");
  }
  if (
    project.executionAttemptId !== args.executionAttemptId
    || project.executionFence !== args.executionFence
  ) {
    throw presentationError("INVALID_STATE", "Presentation Workflow belongs to a superseded execution.");
  }
  await heartbeatExecution(ctx, {
    attemptId: project.executionAttemptId,
    fence: project.executionFence,
    claimantId: `presentation:${String(project._id)}`,
    leaseMs: 30 * 60 * 1_000,
  });
  if (project.status === "generating") {
    const existing = await ctx.db.query("presentationGenerationRuns")
      .withIndex("by_project_revision", (query) =>
        query.eq("projectId", project._id).eq("projectRevision", project.revision)
      ).first();
    if (existing) {
      if (!matchesPresentationExecution(existing, args)) {
        throw presentationError("INVALID_STATE", "Presentation fan-out belongs to a superseded execution.");
      }
      await enqueueRecoveredWork(ctx, existing, args);
      return { runId: existing._id, started: false };
    }
  }
  if (project.status !== "planned" || !project.plan?.length) {
    throw presentationError("INVALID_STATE", "Plan this presentation before generating slides.");
  }
  if (project.revision !== args.expectedRevision) {
    throwRevisionConflict("project", project.revision);
  }
  const batches = buildPresentationStudioBatches(project.plan);
  const now = Date.now();
  const projectRevision = project.revision + 1;
  await ctx.db.patch(project._id, {
    status: "generating",
    workflowPhase: "generating",
    modelId: args.modelId,
    error: undefined,
    revision: projectRevision,
    updatedAt: now,
  });
  const runId = await ctx.db.insert("presentationGenerationRuns", {
    userId: args.userId,
    projectId: project._id,
    projectRevision,
    jobId: args.jobId,
    toolCallId: args.toolCallId,
    selectedModelId: args.modelId,
    ...(args.requireZdrOverride !== undefined
      ? { requireZdrOverride: args.requireZdrOverride }
      : {}),
    expectedSlideIds: project.plan.map((slide) => slide.id),
    completedSlideIds: [],
    deletedSlideIds: [],
    studioCount: batches.length,
    status: "generating",
    workflowId: project.workflowId,
    executionRunId: project.executionRunId,
    executionAttemptId: project.executionAttemptId,
    executionFence: project.executionFence,
    fanoutDispatchedFence: project.executionFence,
    createdAt: now,
    updatedAt: now,
  });
  for (const batch of batches) {
    const batchId = await ctx.db.insert("presentationGenerationBatches", {
      runId,
      userId: args.userId,
      batchIndex: batch.batchIndex,
      slideIds: batch.slideIds,
      status: "queued",
      repairAttempt: 0,
      effectiveModelIds: [],
      createdAt: now,
      updatedAt: now,
    });
    const workpoolOperationId = await interactiveWorkpool.enqueueAction(
      ctx,
      runPresentationStudioRef,
      {
        runId,
        batchId,
        executionAttemptId: project.executionAttemptId,
        executionFence: project.executionFence,
      },
      {
        retry: false,
        name: "presentation-studio",
        onComplete:
          internal.presentations.generation_fanout_mutations
            .reconcilePresentationWork,
        context: {
          runId,
          batchId,
          executionAttemptId: project.executionAttemptId,
          executionFence: project.executionFence,
        },
      },
    );
    await ctx.db.patch(batchId, { workpoolOperationId });
    await linkPresentationWorkpool(
      ctx,
      {
        _id: runId,
        executionRunId: project.executionRunId,
        executionAttemptId: project.executionAttemptId,
        executionFence: project.executionFence,
      },
      {
        executionAttemptId: project.executionAttemptId,
        executionFence: project.executionFence,
      },
      workpoolOperationId,
      `presentation-studio:${batch.batchIndex}`,
    );
  }
  return { runId, started: true };
}
