import type { WorkflowId } from "@convex-dev/workflow";
import type { WorkId } from "@convex-dev/workpool";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  durableWorkflow,
  interactiveWorkpool,
  maintenanceWorkpool,
} from "../execution/components";
import {
  reconcileAdvisorSynthesisWorkHandler,
  settleAdvisorSynthesisWorkFromCanonicalState,
  type AdvisorSynthesisWorkResult,
} from "./synthesis_work_reconciliation";

const INITIAL_DELAY_MS = 11 * 60 * 1_000;
const RECHECK_DELAY_MS = 30 * 60 * 1_000;
type Args = {
  workflowId: string;
  batchId: Id<"advisorBatches">;
  adapterId: "convex-workflow" | "interactive-workpool";
  assistantMessageId?: Id<"messages">;
};
type Status =
  | { type: "inProgress" }
  | { type: "completed"; result: unknown }
  | { type: "failed"; error: string }
  | { type: "canceled" };
type Deps = {
  status: (ctx: MutationCtx, args: Args) => Promise<Status>;
  settleCanonical: typeof settleAdvisorSynthesisWorkFromCanonicalState;
  reconcile: (
    ctx: MutationCtx,
    args: Args,
    result: AdvisorSynthesisWorkResult,
  ) => Promise<void>;
  schedule: (ctx: MutationCtx, args: Args, delayMs: number) => Promise<void>;
};
const watchdogRef = makeFunctionReference<"mutation">(
  "advisors/workflow_watchdog:reconcileAdvisorSynthesisWatchdog",
);
const defaultDeps: Deps = {
  status: async (ctx, args) => {
    if (args.adapterId === "convex-workflow") {
      return await durableWorkflow.status(ctx, args.workflowId as WorkflowId);
    }
    const status = await interactiveWorkpool.status(ctx, args.workflowId as WorkId);
    return status.state === "finished"
      ? { type: "failed", error: "Advisor synthesis completed without lifecycle reconciliation" }
      : { type: "inProgress" };
  },
  settleCanonical: settleAdvisorSynthesisWorkFromCanonicalState,
  reconcile: async (ctx, args, result) => {
    if (args.adapterId === "interactive-workpool") {
      await reconcileAdvisorSynthesisWorkHandler(ctx, {
        workId: args.workflowId,
        result,
        context: {
          batchId: args.batchId,
          assistantMessageId: args.assistantMessageId,
        },
      });
      return;
    }
    await maintenanceWorkpool.enqueueAction(
      ctx,
      makeFunctionReference<"action">("execution/reconciliation_retry:run"),
      {
        target: "advisor_synthesis",
        payload: {
          workflowId: args.workflowId,
          result,
          context: { batchId: args.batchId },
        },
      },
      { name: "advisor-synthesis-completion-recovery", retry: true },
    );
  },
  schedule: async (ctx, args, delayMs) => {
    await ctx.scheduler.runAfter(delayMs, watchdogRef, args);
  },
};

export async function scheduleAdvisorSynthesisWatchdog(
  ctx: Pick<MutationCtx, "scheduler">,
  args: Args,
): Promise<void> {
  await ctx.scheduler.runAfter(INITIAL_DELAY_MS, watchdogRef, args);
}

export async function reconcileAdvisorSynthesisWatchdogHandler(
  ctx: MutationCtx,
  args: Args,
  deps: Deps = defaultDeps,
): Promise<"settled" | "rescheduled" | "reconciled"> {
  if (args.adapterId === "interactive-workpool") {
    try {
      const settled = await deps.settleCanonical(ctx, {
        operationId: args.workflowId,
        batchId: args.batchId,
        assistantMessageId: args.assistantMessageId,
      });
      if (settled) return "settled";
    } catch {
      await deps.schedule(ctx, args, RECHECK_DELAY_MS);
      return "rescheduled";
    }
  } else {
    const batch = await ctx.db.get(args.batchId);
    if (
      !batch
      || ["completed", "failed", "cancelled"].includes(batch.status)
      || !batch.generationOperationIds?.includes(args.workflowId)
    ) return "settled";
  }
  let status: Status;
  try {
    status = await deps.status(ctx, args);
  } catch {
    await deps.schedule(ctx, args, RECHECK_DELAY_MS);
    return "rescheduled";
  }
  if (status.type === "inProgress") {
    await deps.schedule(ctx, args, RECHECK_DELAY_MS);
    return "rescheduled";
  }
  const result: AdvisorSynthesisWorkResult = status.type === "completed"
    ? { kind: "success", returnValue: status.result }
    : status.type === "canceled"
      ? { kind: "canceled" }
      : { kind: "failed", error: status.error };
  try {
    await deps.reconcile(ctx, args, result);
    await deps.schedule(ctx, args, RECHECK_DELAY_MS);
  } catch {
    await deps.schedule(ctx, args, RECHECK_DELAY_MS);
    return "rescheduled";
  }
  return "reconciled";
}

export const reconcileAdvisorSynthesisWatchdog = internalMutation({
  args: {
    workflowId: v.string(),
    batchId: v.id("advisorBatches"),
    adapterId: v.union(
      v.literal("convex-workflow"),
      v.literal("interactive-workpool"),
    ),
    assistantMessageId: v.optional(v.id("messages")),
  },
  returns: v.union(
    v.literal("settled"),
    v.literal("rescheduled"),
    v.literal("reconciled"),
  ),
  handler: reconcileAdvisorSynthesisWatchdogHandler,
});
