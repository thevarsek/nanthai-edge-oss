import type { WorkId } from "@convex-dev/workpool";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { finalizeAdvisorRun } from "../advisors/lifecycle";
import { isTerminalAdvisorRun } from "../advisors/shared";
import { failPresentationFanoutHandler } from
  "../presentations/generation_studio_mutation_handlers";
import { derivePresentationWorkOutcome } from
  "../presentations/workpool_reconciliation";
import { completeResearchSearchTaskHandler } from
  "../search/research_fanout_mutations";
import { notifyScheduledStepTerminal } from "../scheduledJobs/workflow_signals";
import { terminalizeExecutionComponentByOperation } from "./component_refs";
import {
  backgroundWorkpool,
  interactiveWorkpool,
  maintenanceWorkpool,
} from "./components";
import { terminalizeExecution } from "./control_plane";
import {
  scheduleWorkpoolCompletionWatchdog,
  workpoolWatchdogTargetValidator,
  WORKPOOL_WATCHDOG_RECHECK_MS,
  type WorkpoolWatchdogTarget,
} from "./workpool_watchdog_schedule";

type Deps = {
  isSettled: (ctx: MutationCtx, target: WorkpoolWatchdogTarget) => Promise<boolean>;
  isFinished: (ctx: MutationCtx, target: WorkpoolWatchdogTarget) => Promise<boolean>;
  reconcile: (ctx: MutationCtx, target: WorkpoolWatchdogTarget) => Promise<void>;
  schedule: (ctx: MutationCtx, target: WorkpoolWatchdogTarget) => Promise<void>;
};

async function settleComponent(
  ctx: MutationCtx,
  target: WorkpoolWatchdogTarget,
  outcome: "completed" | "failed" | "cancelled",
): Promise<void> {
  const adapterId = target.kind === "maintenance_work"
    ? "maintenance-workpool"
    : target.kind === "background_work"
      ? "background-workpool"
      : "interactive-workpool";
  await terminalizeExecutionComponentByOperation(
    ctx,
    adapterId,
    target.operationId,
    outcome,
  );
}

type ScheduledStepTarget = Extract<
  WorkpoolWatchdogTarget,
  { kind: "scheduled_step" }
>;

export async function settleScheduledStepWorkFromCanonicalState(
  ctx: MutationCtx,
  target: ScheduledStepTarget,
): Promise<boolean> {
  const job = await ctx.db.get(target.jobId);
  const executionMovedOn = !job
    || job.activeExecutionId !== target.executionId
    || job.activeStepIndex !== target.stepIndex;
  if (executionMovedOn) {
    await settleComponent(ctx, target, "completed");
    return true;
  }

  const searchSession = await ctx.db.query("searchSessions")
    .withIndex("by_message", (query) =>
      query.eq("assistantMessageId", target.assistantMessageId),
    )
    .first();
  if (!searchSession?.generationHandoffOperationId) return false;

  // The Workpool action's durable responsibility ends once it atomically
  // records the generation handoff. The downstream generation owns message
  // terminalization and will signal the waiting scheduled Workflow.
  await settleComponent(ctx, target, "completed");
  return true;
}

async function defaultIsSettled(
  ctx: MutationCtx,
  target: WorkpoolWatchdogTarget,
): Promise<boolean> {
  if (target.kind === "research_search") {
    const task = await ctx.db.get(target.taskId);
    if (!task || task.status === "queued") return !task;
    await settleComponent(ctx, target, task.status === "completed"
      ? "completed"
      : task.status === "cancelled" ? "cancelled" : "failed");
    return true;
  }
  if (target.kind === "scheduled_step") {
    return await settleScheduledStepWorkFromCanonicalState(ctx, target);
  }
  if (target.kind === "presentation_work") {
    const outcome = await derivePresentationWorkOutcome(
      ctx,
      target.operationId,
      target.runId,
    );
    if (!outcome) return false;
    await settleComponent(ctx, target, outcome);
    return true;
  }
  if (target.kind === "advisor_consultation") {
    const run = await ctx.db.get(target.runId);
    const settled = !run || isTerminalAdvisorRun(run.status);
    if (settled) await settleComponent(ctx, target, run?.status === "cancelled"
      ? "cancelled"
      : run?.status === "completed" ? "completed" : "failed");
    return settled;
  }
  if (target.kind === "maintenance_work") {
    const run = await ctx.db.get(target.runId);
    const settled = !run || ["completed", "failed", "cancelled"].includes(run.state);
    if (settled) await settleComponent(ctx, target, run?.state === "cancelled"
      ? "cancelled"
      : run?.state === "completed" ? "completed" : "failed");
    return settled;
  }
  const component = await ctx.db.query("executionComponentRefs")
    .withIndex("by_operation", (q) => q
      .eq("adapterId", "background-workpool")
      .eq("operationId", target.operationId))
    .unique();
  return !component || component.status !== "active";
}

async function reconcileScheduledStep(
  ctx: MutationCtx,
  target: Extract<WorkpoolWatchdogTarget, { kind: "scheduled_step" }>,
): Promise<void> {
  const message = await ctx.db.get(target.assistantMessageId);
  const status = message?.status === "completed"
    ? "completed"
    : message?.status === "cancelled" ? "cancelled" : "failed";
  await notifyScheduledStepTerminal(ctx, {
    jobId: target.jobId,
    executionId: target.executionId,
    stepIndex: target.stepIndex,
    assistantMessageId: target.assistantMessageId,
    status,
    ...(status === "failed"
      ? { error: "Scheduled worker completed without lifecycle reconciliation." }
      : {}),
  });
}

async function defaultReconcile(
  ctx: MutationCtx,
  target: WorkpoolWatchdogTarget,
): Promise<void> {
  if (target.kind === "research_search") {
    await settleComponent(ctx, target, "failed");
    await completeResearchSearchTaskHandler(ctx, {
      taskId: target.taskId,
      batchId: target.batchId,
      executionAttemptId: target.executionAttemptId,
      executionFence: target.executionFence,
      result: {
        kind: "failed",
        error: "Research worker completed without lifecycle reconciliation.",
      },
    });
  } else if (target.kind === "scheduled_step") {
    await reconcileScheduledStep(ctx, target);
    const message = await ctx.db.get(target.assistantMessageId);
    await settleComponent(ctx, target, message?.status === "cancelled"
      ? "cancelled"
      : message?.status === "completed" ? "completed" : "failed");
  } else if (target.kind === "presentation_work") {
    await settleComponent(ctx, target, "failed");
    await failPresentationFanoutHandler(ctx, {
      runId: target.runId,
      executionAttemptId: target.executionAttemptId,
      executionFence: target.executionFence,
      error: "Presentation worker completed without lifecycle reconciliation.",
    });
  } else if (target.kind === "advisor_consultation") {
    await settleComponent(ctx, target, "failed");
    await finalizeAdvisorRun(ctx, {
      runId: target.runId as Id<"advisorRuns">,
      status: "failed",
      errorCode: "ADVISOR_WORKPOOL_CALLBACK_LOST",
      errorMessage: "Advisor worker completed without lifecycle reconciliation.",
    });
  } else if (target.kind === "maintenance_work") {
    const run = await ctx.db.get(target.runId);
    const attempt = run?.activeAttemptId ? await ctx.db.get(run.activeAttemptId) : null;
    const tombstone = run
      ? await ctx.db.query("accountDeletionTombstones")
        .withIndex("by_user", (q) => q.eq("userId", run.userId))
        .unique()
      : null;
    const cancelled = Boolean(tombstone) || run?.state === "cancelling";
    if (run && attempt && !["completed", "failed", "cancelled"].includes(run.state)) {
      await terminalizeExecution(ctx, {
        attemptId: attempt._id,
        fence: attempt.fence,
        outcome: cancelled ? "cancelled" : "failed",
        summary: cancelled
          ? "Maintenance work cancelled"
          : "Maintenance work completed without lifecycle reconciliation",
        allowExpiredLease: true,
        allowWaiting: true,
      });
    }
    await settleComponent(ctx, target, cancelled ? "cancelled" : "failed");
  } else {
    // Background actions publish their own product mutations. Their callback
    // only owns component bookkeeping, so a missing result is safely settled.
    await settleComponent(ctx, target, "completed");
  }
}

const defaultDeps: Deps = {
  isSettled: defaultIsSettled,
  isFinished: async (ctx, target) => {
    const pool = target.kind === "maintenance_work"
      ? maintenanceWorkpool
      : target.kind === "background_work" ? backgroundWorkpool : interactiveWorkpool;
    const status = await pool.status(ctx, target.operationId as WorkId);
    return status.state === "finished";
  },
  reconcile: defaultReconcile,
  schedule: async (ctx, target) => await scheduleWorkpoolCompletionWatchdog(
    ctx,
    target,
    WORKPOOL_WATCHDOG_RECHECK_MS,
  ),
};

export async function reconcileWorkpoolCompletionHandler(
  ctx: MutationCtx,
  args: { target: WorkpoolWatchdogTarget },
  deps: Deps = defaultDeps,
): Promise<"settled" | "rescheduled" | "reconciled"> {
  if (await deps.isSettled(ctx, args.target)) return "settled";
  let finished: boolean;
  try {
    finished = await deps.isFinished(ctx, args.target);
  } catch {
    await deps.schedule(ctx, args.target);
    return "rescheduled";
  }
  if (!finished) {
    await deps.schedule(ctx, args.target);
    return "rescheduled";
  }
  try {
    await deps.reconcile(ctx, args.target);
  } catch {
    await deps.schedule(ctx, args.target);
    return "rescheduled";
  }
  return "reconciled";
}

export const reconcileWorkpoolCompletion = internalMutation({
  args: { target: workpoolWatchdogTargetValidator },
  returns: v.union(
    v.literal("settled"),
    v.literal("rescheduled"),
    v.literal("reconciled"),
  ),
  handler: reconcileWorkpoolCompletionHandler,
});
