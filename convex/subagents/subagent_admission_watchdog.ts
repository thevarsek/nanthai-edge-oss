import type { WorkId } from "@convex-dev/workpool";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  linkExecutionComponent,
  terminalizeExecutionComponentByOperation,
} from "../execution/component_refs";
import { interactiveWorkpool } from "../execution/components";
import { isTerminalSubagentStatus } from "./shared";

const INITIAL_DELAY_MS = 11 * 60 * 1_000;
const RECHECK_DELAY_MS = 30 * 60 * 1_000;
type Args = {
  runId: Id<"subagentRuns">;
  executionRunId: Id<"executionRuns">;
  workId: string;
};
type Deps = {
  isFinished: (ctx: MutationCtx, workId: string) => Promise<boolean>;
  enqueueReplacement: (ctx: MutationCtx, args: Args) => Promise<string>;
  terminalize: typeof terminalizeExecutionComponentByOperation;
  link: typeof linkExecutionComponent;
  schedule: (ctx: MutationCtx, args: Args, delayMs: number) => Promise<void>;
};
const watchdogRef = makeFunctionReference<"mutation">(
  "subagents/subagent_admission_watchdog:reconcileSubagentAdmissionWatchdog",
);

export async function scheduleSubagentAdmissionWatchdog(
  ctx: Pick<MutationCtx, "scheduler">,
  args: Args,
): Promise<void> {
  await ctx.scheduler.runAfter(INITIAL_DELAY_MS, watchdogRef, args);
}

const defaultDeps: Deps = {
  isFinished: async (ctx, workId) =>
    (await interactiveWorkpool.status(ctx, workId as WorkId)).state === "finished",
  enqueueReplacement: async (ctx, args) => String(
    await interactiveWorkpool.enqueueMutation(
      ctx,
      internal.execution.fanout_queues.startSubagentWorkflowFromPool,
      { runId: args.runId, executionRunId: args.executionRunId },
      {
        name: "subagent-admission-recovery",
        onComplete: internal.execution.fanout_queues.reconcileSubagentAdmission,
        context: { runId: args.runId },
      },
    ),
  ),
  terminalize: terminalizeExecutionComponentByOperation,
  link: linkExecutionComponent,
  schedule: async (ctx, args, delayMs) => {
    await ctx.scheduler.runAfter(delayMs, watchdogRef, args);
  },
};

export async function reconcileSubagentAdmissionWatchdogHandler(
  ctx: MutationCtx,
  args: Args,
  deps: Deps = defaultDeps,
): Promise<"settled" | "rescheduled" | "retried"> {
  const child = await ctx.db.get(args.runId);
  if (!child || isTerminalSubagentStatus(child.status)) return "settled";
  const batch = await ctx.db.get(child.batchId);
  if (!batch || batch.status === "cancelled") {
    if (batch?.status === "cancelled") {
      await ctx.db.patch(child._id, {
        status: "cancelled",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    await deps.terminalize(ctx, "interactive-workpool", args.workId, "cancelled");
    return "settled";
  }
  let finished: boolean;
  try {
    finished = await deps.isFinished(ctx, args.workId);
  } catch {
    await deps.schedule(ctx, args, RECHECK_DELAY_MS);
    return "rescheduled";
  }
  if (!finished) {
    await deps.schedule(ctx, args, RECHECK_DELAY_MS);
    return "rescheduled";
  }
  if (child.workflowId) {
    await deps.terminalize(
      ctx,
      "interactive-workpool",
      args.workId,
      "completed",
    );
    return "settled";
  }
  const executionRun = await ctx.db.get(args.executionRunId);
  const attempt = executionRun?.activeAttemptId
    ? await ctx.db.get(executionRun.activeAttemptId)
    : null;
  if (!executionRun || !attempt) {
    await deps.schedule(ctx, args, RECHECK_DELAY_MS);
    return "rescheduled";
  }
  const nextWorkId = await deps.enqueueReplacement(ctx, args);
  await deps.terminalize(
    ctx,
    "interactive-workpool",
    args.workId,
    "failed",
  );
  await deps.link(ctx, {
    runId: executionRun._id,
    attemptId: attempt._id,
    fence: attempt.fence,
    adapterId: "interactive-workpool",
    operationId: nextWorkId,
    role: `subagent-admission-recovery:${String(nextWorkId)}`,
  });
  await ctx.db.patch(child._id, {
    workpoolOperationId: nextWorkId,
    updatedAt: Date.now(),
  });
  await deps.schedule(ctx, {
    runId: child._id,
    executionRunId: executionRun._id,
    workId: String(nextWorkId),
  }, INITIAL_DELAY_MS);
  return "retried";
}

export const reconcileSubagentAdmissionWatchdog = internalMutation({
  args: {
    runId: v.id("subagentRuns"),
    executionRunId: v.id("executionRuns"),
    workId: v.string(),
  },
  returns: v.union(
    v.literal("settled"),
    v.literal("rescheduled"),
    v.literal("retried"),
  ),
  handler: reconcileSubagentAdmissionWatchdogHandler,
});
