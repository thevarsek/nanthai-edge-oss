import type { WorkflowId } from "@convex-dev/workflow";
import { makeFunctionReference } from "convex/server";
import type { MutationCtx } from "../_generated/server";
import { durableWorkflow, maintenanceWorkpool } from "../execution/components";
import { reconcileGenerationWorkflowCompletionHandler } from "./workflow_completion";
import type { GenerationParticipantWorkflowArgs } from "./workflow_contract";
import {
  GENERATION_WORKFLOW_WATCHDOG_RECHECK_MS,
  scheduleGenerationWorkflowWatchdog,
} from "./generation_workflow_watchdog_schedule";

type WatchdogStatus =
  | { type: "inProgress" }
  | { type: "completed"; result: unknown }
  | { type: "failed"; error: string }
  | { type: "canceled" };

type WatchdogDeps = {
  statusWorkflow: (ctx: MutationCtx, workflowId: string) => Promise<WatchdogStatus>;
  reconcileCompletion: typeof reconcileGenerationWorkflowCompletionHandler;
  scheduleWatchdog: typeof scheduleGenerationWorkflowWatchdog;
};

const defaultDeps: WatchdogDeps = {
  statusWorkflow: async (ctx, workflowId) => await durableWorkflow.status(
    ctx,
    workflowId as WorkflowId,
  ),
  reconcileCompletion: async (ctx, args) => {
    await maintenanceWorkpool.enqueueAction(
      ctx,
      makeFunctionReference<"action">("execution/reconciliation_retry:run"),
      { target: "generation_workflow", payload: args },
      {
        name: "generation-workflow-completion-recovery",
        retry: true,
      },
    );
    return null;
  },
  scheduleWatchdog: scheduleGenerationWorkflowWatchdog,
};

export async function reconcileGenerationWorkflowWatchdogHandler(
  ctx: MutationCtx,
  args: {
    workflowId: string;
    participantArgs: GenerationParticipantWorkflowArgs;
  },
  deps: WatchdogDeps = defaultDeps,
): Promise<"missing" | "rescheduled" | "reconciled" | "settled"> {
  const component = await ctx.db
    .query("executionComponentRefs")
    .withIndex("by_operation", (query) => query
      .eq("adapterId", "convex-workflow")
      .eq("operationId", args.workflowId))
    .unique();
  if (
    !component
    || (component.status !== "active" && component.status !== "cancel_requested")
  ) return component ? "settled" : "missing";

  let status: WatchdogStatus;
  try {
    status = await deps.statusWorkflow(ctx, args.workflowId);
  } catch {
    await deps.scheduleWatchdog(
      ctx,
      args,
      GENERATION_WORKFLOW_WATCHDOG_RECHECK_MS,
    );
    return "rescheduled";
  }
  if (status.type === "inProgress") {
    await deps.scheduleWatchdog(
      ctx,
      args,
      GENERATION_WORKFLOW_WATCHDOG_RECHECK_MS,
    );
    return "rescheduled";
  }
  const result:
    | { kind: "success"; returnValue?: unknown }
    | { kind: "failed"; error: string }
    | { kind: "canceled" } = status.type === "completed"
      ? { kind: "success", returnValue: status.result }
      : status.type === "canceled"
        ? { kind: "canceled" }
        : { kind: "failed", error: status.error };
  try {
    await deps.reconcileCompletion(ctx, {
      workflowId: args.workflowId,
      result,
      context: { participantArgs: args.participantArgs },
    });
    await deps.scheduleWatchdog(
      ctx,
      args,
      GENERATION_WORKFLOW_WATCHDOG_RECHECK_MS,
    );
  } catch {
    await deps.scheduleWatchdog(
      ctx,
      args,
      GENERATION_WORKFLOW_WATCHDOG_RECHECK_MS,
    );
    return "rescheduled";
  }
  return "reconciled";
}
