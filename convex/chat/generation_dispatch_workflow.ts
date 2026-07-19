import { vResultValidator, type WorkflowId } from "@convex-dev/workflow";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { durableWorkflow, maintenanceWorkpool } from "../execution/components";
import { runGenerationArgs } from "./actions_args";
import type { RunGenerationArgs } from "./actions_run_generation_types";
import { finalizeGenerationHandler } from "./mutations_internal_handlers";
import { findActiveGenerationDriver } from "./generation_driver_components";
import {
  GENERATION_WORKFLOW_WATCHDOG_INITIAL_MS,
  GENERATION_WORKFLOW_WATCHDOG_RECHECK_MS,
} from "./generation_workflow_watchdog_schedule";

const completionRef = makeFunctionReference<"mutation">(
  "chat/generation_dispatch_workflow:reconcileGenerationDispatch",
);

export const runGenerationDispatchWorkflow = durableWorkflow
  .define({ args: runGenerationArgs, returns: v.null() })
  .handler(async (step, args): Promise<null> => {
    await step.runAction(
      internal.chat.actions_runtime.runGenerationForDurableDispatch,
      args,
      {
        name: "generation-dispatch",
        retry: { maxAttempts: 5, initialBackoffMs: 500, base: 2 },
      },
    );
    return null;
  });

export async function startGenerationDispatchHandler(
  ctx: MutationCtx,
  args: RunGenerationArgs,
): Promise<string> {
  const workflowId = String(await durableWorkflow.start(
    ctx,
    internal.chat.generation_dispatch_workflow.runGenerationDispatchWorkflow,
    args,
    {
      startAsync: true,
      onComplete: completionRef,
      context: { generationArgs: args },
    },
  ));
  await ctx.scheduler.runAfter(
    GENERATION_WORKFLOW_WATCHDOG_INITIAL_MS,
    internal.chat.generation_dispatch_workflow.reconcileGenerationDispatchWatchdog,
    { workflowId, generationArgs: args },
  );
  return workflowId;
}

export const startGenerationDispatch = internalMutation({
  args: runGenerationArgs,
  returns: v.string(),
  handler: startGenerationDispatchHandler,
});

type DispatchCompletionArgs = {
  workflowId: string;
  result: { kind: "success"; returnValue?: unknown }
    | { kind: "failed"; error?: string }
    | { kind: "canceled" };
  context: { generationArgs: RunGenerationArgs };
};

export async function reconcileGenerationDispatchHandler(
  ctx: MutationCtx,
  args: DispatchCompletionArgs,
  deps: { finalizeGeneration: typeof finalizeGenerationHandler } = {
    finalizeGeneration: finalizeGenerationHandler,
  },
): Promise<null> {
    await ctx.scheduler.runAfter(60_000, internal.chat.workflow_events.cleanupGenerationWorkflow, {
      workflowId: args.workflowId,
    });
    if (args.result.kind === "success") return null;
    const generationArgs = args.context.generationArgs;
    const summary = args.result.kind === "failed"
      ? `Generation dispatch failed: ${args.result.error}`
      : "Generation dispatch was cancelled.";
    for (const participant of generationArgs.participants) {
      const job = await ctx.db.get(participant.jobId);
      if (!job || ["completed", "failed", "cancelled", "timedOut"].includes(job.status)) continue;
      const activeWorkflow = job.executionRunId
        ? await findActiveGenerationDriver(ctx, job.executionRunId)
        : null;
      if (activeWorkflow) continue;
      await deps.finalizeGeneration(ctx, {
        messageId: participant.messageId,
        jobId: participant.jobId,
        chatId: generationArgs.chatId,
        content: `Error: ${summary}`,
        status: args.result.kind === "canceled" ? "cancelled" : "failed",
        error: summary,
        userId: generationArgs.userId,
      });
    }
    return null;
}

export const reconcileGenerationDispatch = internalMutation({
  args: {
    workflowId: v.string(),
    result: vResultValidator,
    context: v.object({ generationArgs: v.object(runGenerationArgs) }),
  },
  returns: v.null(),
  handler: reconcileGenerationDispatchHandler,
});

type DispatchWatchdogStatus =
  | { type: "inProgress" }
  | { type: "completed"; result: unknown }
  | { type: "failed"; error: string }
  | { type: "canceled" };

type DispatchWatchdogDeps = {
  hasStrandedParticipants: (
    ctx: MutationCtx,
    args: RunGenerationArgs,
  ) => Promise<boolean>;
  restartDispatch: typeof startGenerationDispatchHandler;
  statusWorkflow: (ctx: MutationCtx, workflowId: string) => Promise<DispatchWatchdogStatus>;
  reconcileCompletion: typeof reconcileGenerationDispatchHandler;
  scheduleWatchdog: (
    ctx: MutationCtx,
    args: { workflowId: string; generationArgs: RunGenerationArgs },
  ) => Promise<void>;
  scheduleCleanup: (ctx: MutationCtx, workflowId: string) => Promise<void>;
};

const defaultDispatchWatchdogDeps: DispatchWatchdogDeps = {
  hasStrandedParticipants: async (ctx, generationArgs) => {
    for (const participant of generationArgs.participants) {
      const job = await ctx.db.get(participant.jobId);
      if (!job || ["completed", "failed", "cancelled", "timedOut"].includes(job.status)) {
        continue;
      }
      const driver = job.executionRunId
        ? await findActiveGenerationDriver(ctx, job.executionRunId)
        : null;
      if (!driver) return true;
    }
    return false;
  },
  restartDispatch: startGenerationDispatchHandler,
  statusWorkflow: async (ctx, workflowId) => await durableWorkflow.status(
    ctx,
    workflowId as WorkflowId,
  ),
  reconcileCompletion: async (ctx, args) => {
    await maintenanceWorkpool.enqueueAction(
      ctx,
      makeFunctionReference<"action">("execution/reconciliation_retry:run"),
      { target: "generation_dispatch", payload: args },
      {
        name: "generation-dispatch-completion-recovery",
        retry: true,
      },
    );
    return null;
  },
  scheduleWatchdog: async (ctx, args) => {
    await ctx.scheduler.runAfter(
      GENERATION_WORKFLOW_WATCHDOG_RECHECK_MS,
      internal.chat.generation_dispatch_workflow.reconcileGenerationDispatchWatchdog,
      args,
    );
  },
  scheduleCleanup: async (ctx, workflowId) => {
    await ctx.scheduler.runAfter(
      60_000,
      internal.chat.workflow_events.cleanupGenerationWorkflow,
      { workflowId },
    );
  },
};

export async function reconcileGenerationDispatchWatchdogHandler(
  ctx: MutationCtx,
  args: { workflowId: string; generationArgs: RunGenerationArgs },
  deps: DispatchWatchdogDeps = defaultDispatchWatchdogDeps,
): Promise<"settled" | "rescheduled" | "reconciled"> {
  const hasStrandedParticipants = await deps.hasStrandedParticipants(
    ctx,
    args.generationArgs,
  );
  let status: DispatchWatchdogStatus;
  try {
    status = await deps.statusWorkflow(ctx, args.workflowId);
  } catch {
    if (!hasStrandedParticipants) {
      await deps.scheduleCleanup(ctx, args.workflowId);
      return "settled";
    }
    await deps.scheduleWatchdog(ctx, args);
    return "rescheduled";
  }
  if (status.type === "inProgress") {
    await deps.scheduleWatchdog(ctx, args);
    return "rescheduled";
  }
  if (!hasStrandedParticipants) {
    await deps.scheduleCleanup(ctx, args.workflowId);
    return "settled";
  }
  try {
    if (status.type === "completed") {
      await deps.restartDispatch(ctx, args.generationArgs);
    }
    await deps.reconcileCompletion(ctx, {
      workflowId: args.workflowId,
      result: status.type === "completed"
        ? { kind: "success", returnValue: status.result }
        : status.type === "canceled"
          ? { kind: "canceled" }
          : { kind: "failed", error: status.error },
      context: { generationArgs: args.generationArgs },
    });
    await deps.scheduleWatchdog(ctx, args);
  } catch {
    await deps.scheduleWatchdog(ctx, args);
    return "rescheduled";
  }
  return "reconciled";
}

export const reconcileGenerationDispatchWatchdog = internalMutation({
  args: {
    workflowId: v.string(),
    generationArgs: v.object(runGenerationArgs),
  },
  returns: v.union(
    v.literal("settled"),
    v.literal("rescheduled"),
    v.literal("reconciled"),
  ),
  handler: reconcileGenerationDispatchWatchdogHandler,
});
