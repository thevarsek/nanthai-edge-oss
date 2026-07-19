import type { WorkflowId } from "@convex-dev/workflow";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { durableWorkflow, maintenanceWorkpool } from "../execution/components";
import { reconcileSubagentWorkflowHandler } from "./workflow_lifecycle";

const INITIAL_DELAY_MS = 11 * 60 * 1_000;
const RECHECK_DELAY_MS = 30 * 60 * 1_000;

type Status =
  | { type: "inProgress" }
  | { type: "completed"; result: unknown }
  | { type: "failed"; error: string }
  | { type: "canceled" };

type Deps = {
  status: (ctx: MutationCtx, workflowId: string) => Promise<Status>;
  reconcile: typeof reconcileSubagentWorkflowHandler;
  schedule: (ctx: MutationCtx, args: WatchdogArgs, delayMs: number) => Promise<void>;
};

type WatchdogArgs = { workflowId: string; runId: Id<"subagentRuns"> };

const defaultDeps: Deps = {
  status: async (ctx, workflowId) => await durableWorkflow.status(
    ctx,
    workflowId as WorkflowId,
  ),
  reconcile: async (ctx, args) => {
    await maintenanceWorkpool.enqueueAction(
      ctx,
      makeFunctionReference<"action">("execution/reconciliation_retry:run"),
      { target: "subagent_workflow", payload: args },
      {
        name: "subagent-workflow-completion-recovery",
        retry: true,
      },
    );
    return null;
  },
  schedule: async (ctx, args, delayMs) => {
    await ctx.scheduler.runAfter(
      delayMs,
      makeFunctionReference<"mutation">(
        "subagents/subagent_workflow_watchdog:reconcileSubagentWorkflowWatchdog",
      ),
      args,
    );
  },
};

export async function scheduleSubagentWorkflowWatchdog(
  ctx: Pick<MutationCtx, "scheduler">,
  args: WatchdogArgs,
): Promise<void> {
  await ctx.scheduler.runAfter(
    INITIAL_DELAY_MS,
    makeFunctionReference<"mutation">(
      "subagents/subagent_workflow_watchdog:reconcileSubagentWorkflowWatchdog",
    ),
    args,
  );
}

export async function reconcileSubagentWorkflowWatchdogHandler(
  ctx: MutationCtx,
  args: WatchdogArgs,
  deps: Deps = defaultDeps,
): Promise<"settled" | "rescheduled" | "reconciled"> {
  const child = await ctx.db.get(args.runId);
  if (!child || child.workflowId !== args.workflowId) {
    return "settled";
  }
  const component = await ctx.db
    .query("executionComponentRefs")
    .withIndex("by_operation", (query) => query
      .eq("adapterId", "convex-workflow")
      .eq("operationId", args.workflowId))
    .unique();
  if (component && component.status !== "active" && component.status !== "cancel_requested") {
    return "settled";
  }
  let status: Status;
  try {
    status = await deps.status(ctx, args.workflowId);
  } catch {
    await deps.schedule(ctx, args, RECHECK_DELAY_MS);
    return "rescheduled";
  }
  if (status.type === "inProgress") {
    await deps.schedule(ctx, args, RECHECK_DELAY_MS);
    return "rescheduled";
  }
  try {
    await deps.reconcile(ctx, {
      workflowId: args.workflowId,
      result: status.type === "completed"
        ? { kind: "success", returnValue: status.result }
        : status.type === "canceled"
          ? { kind: "canceled" }
          : { kind: "failed", error: status.error },
      context: { runId: args.runId },
    });
    await deps.schedule(ctx, args, RECHECK_DELAY_MS);
  } catch {
    await deps.schedule(ctx, args, RECHECK_DELAY_MS);
    return "rescheduled";
  }
  return "reconciled";
}

export const reconcileSubagentWorkflowWatchdog = internalMutation({
  args: { workflowId: v.string(), runId: v.id("subagentRuns") },
  returns: v.union(
    v.literal("settled"),
    v.literal("rescheduled"),
    v.literal("reconciled"),
  ),
  handler: reconcileSubagentWorkflowWatchdogHandler,
});
