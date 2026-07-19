import type { WorkId } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  linkExecutionComponent,
  terminalizeExecutionComponentByOperation,
} from "../execution/component_refs";
import { interactiveWorkpool } from "../execution/components";

const WATCHDOG_INITIAL_MS = 11 * 60 * 1_000;
const WATCHDOG_RECHECK_MS = 30 * 60 * 1_000;

export const continuationContext = v.object({
  runId: v.id("subagentRuns"),
});

export async function enqueueSubagentContinuationHandler(
  ctx: MutationCtx,
  args: {
    runId: Id<"subagentRuns">;
    runAfterMs?: number;
    expectedWorkId?: string;
  },
): Promise<string> {
  const child = await ctx.db.get(args.runId);
  if (!child) throw new Error("SUBAGENT_RUN_NOT_FOUND");
  if (args.expectedWorkId && child.workpoolOperationId !== args.expectedWorkId) {
    return child.workpoolOperationId ?? args.expectedWorkId;
  }
  if (child.status !== "waiting_continuation") {
    return child.workpoolOperationId ?? "settled";
  }
  const predecessor = child.workpoolOperationId
    ? await ctx.db.query("executionComponentRefs")
      .withIndex("by_operation", (query) => query
        .eq("adapterId", "interactive-workpool")
        .eq("operationId", child.workpoolOperationId as string))
      .unique()
    : null;
  const workId = String(await interactiveWorkpool.enqueueAction(
    ctx,
    internal.subagents.actions.continueSubagentRun,
    { runId: args.runId },
    {
      retry: false,
      name: "subagent-continuation",
      runAfter: Math.max(0, args.runAfterMs ?? 0),
      onComplete: internal.execution.fanout_queues.reconcileSubagentContinuation,
      context: { runId: args.runId },
    },
  ));
  if (predecessor?.attemptId) {
    const attempt = await ctx.db.get(predecessor.attemptId);
    if (attempt) {
      await linkExecutionComponent(ctx, {
        runId: predecessor.runId,
        attemptId: predecessor.attemptId,
        fence: attempt.fence,
        adapterId: "interactive-workpool",
        operationId: workId,
        role: `subagent-legacy-continuation:${String(child.continuationCount ?? 0)}`,
      });
    }
  }
  await ctx.db.patch(child._id, {
    workpoolOperationId: workId,
    updatedAt: Date.now(),
  });
  await ctx.scheduler.runAfter(
    WATCHDOG_INITIAL_MS,
    internal.subagents.subagent_continuation_recovery
      .reconcileSubagentContinuationWatchdog,
    { runId: child._id, workId },
  );
  return workId;
}

export async function reconcileSubagentContinuationHandler(
  ctx: MutationCtx,
  args: {
    workId: string;
    context: { runId: Id<"subagentRuns"> };
    result: { kind: "success" } | { kind: "failed"; error: string }
      | { kind: "canceled" };
  },
): Promise<void> {
  await terminalizeExecutionComponentByOperation(
    ctx,
    "interactive-workpool",
    args.workId,
    args.result.kind === "success"
      ? "completed"
      : args.result.kind === "canceled" ? "cancelled" : "failed",
  );
  if (args.result.kind === "success") return;
  const child = await ctx.db.get(args.context.runId);
  if (
    child?.status === "waiting_continuation"
    && child.workpoolOperationId === args.workId
  ) {
    await ctx.scheduler.runAfter(
      0,
      internal.execution.fanout_queues.enqueueSubagentContinuation,
      { runId: child._id, expectedWorkId: args.workId },
    );
  }
}

export const reconcileSubagentContinuationWatchdog = internalMutation({
  args: { runId: v.id("subagentRuns"), workId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const child = await ctx.db.get(args.runId);
    if (!child || child.workpoolOperationId !== args.workId) return null;
    let finished = false;
    try {
      finished = (await interactiveWorkpool.status(
        ctx,
        args.workId as WorkId,
      )).state === "finished";
    } catch {
      // Workpool status is temporarily unavailable; retain durable ownership.
    }
    if (!finished) {
      await ctx.scheduler.runAfter(
        WATCHDOG_RECHECK_MS,
        internal.subagents.subagent_continuation_recovery
          .reconcileSubagentContinuationWatchdog,
        args,
      );
      return null;
    }
    if (child.status === "waiting_continuation") {
      await ctx.scheduler.runAfter(
        0,
        internal.execution.fanout_queues.enqueueSubagentContinuation,
        { runId: child._id, expectedWorkId: args.workId },
      );
    } else {
      await terminalizeExecutionComponentByOperation(
        ctx,
        "interactive-workpool",
        args.workId,
        "completed",
      );
    }
    return null;
  },
});
