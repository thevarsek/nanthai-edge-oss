import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  internalMutation,
  type ActionCtx,
  type MutationCtx,
} from "../_generated/server";
import { runGenerationArgs } from "./actions_args";
import type { RunGenerationArgs } from "./actions_run_generation_types";
import { findActiveGenerationDriver } from "./generation_driver_components";
import { finalizeGenerationHandler } from "./mutations_internal_handlers";

const DISPATCH_WATCHDOG_INITIAL_MS = 30_000;
const DISPATCH_WATCHDOG_RECHECK_MS = 45_000;
const DISPATCH_WATCHDOG_MAX_RESTARTS = 3;

type StrandedParticipant = RunGenerationArgs["participants"][number];

async function findStrandedParticipants(
  ctx: MutationCtx,
  args: RunGenerationArgs,
): Promise<StrandedParticipant[]> {
  const stranded: StrandedParticipant[] = [];
  for (const participant of args.participants) {
    const job = await ctx.db.get(participant.jobId);
    if (
      !job
      || ["completed", "failed", "cancelled", "timedOut"].includes(job.status)
    ) {
      continue;
    }
    const activeDriver = job.executionRunId
      ? await findActiveGenerationDriver(
          ctx,
          job.executionRunId as Id<"executionRuns">,
        )
      : null;
    if (!activeDriver) stranded.push(participant);
  }
  return stranded;
}

export async function enqueueRunGeneration(
  ctx: ActionCtx | MutationCtx,
  args: RunGenerationArgs,
): Promise<string> {
  const scheduledId = await scheduleRunGenerationAction(ctx, args);
  await ctx.scheduler.runAfter(
    DISPATCH_WATCHDOG_INITIAL_MS,
    internal.chat.run_generation_queue.reconcileRunGenerationDispatch,
    { generationArgs: args, restartAttempt: 0 },
  );
  return scheduledId;
}

async function scheduleRunGenerationAction(
  ctx: Pick<ActionCtx | MutationCtx, "scheduler">,
  args: RunGenerationArgs,
): Promise<string> {
  return String(await ctx.scheduler.runAfter(
    0,
    internal.chat.actions_runtime.runGeneration,
    args,
  ));
}

type DispatchWatchdogDeps = {
  findStranded: typeof findStrandedParticipants;
  restart: typeof scheduleRunGenerationAction;
  scheduleRecheck: (
    ctx: MutationCtx,
    args: { generationArgs: RunGenerationArgs; restartAttempt: number },
  ) => Promise<void>;
  finalize: typeof finalizeGenerationHandler;
};

const defaultDispatchWatchdogDeps: DispatchWatchdogDeps = {
  findStranded: findStrandedParticipants,
  restart: scheduleRunGenerationAction,
  scheduleRecheck: async (ctx, args) => {
    await ctx.scheduler.runAfter(
      DISPATCH_WATCHDOG_RECHECK_MS,
      internal.chat.run_generation_queue.reconcileRunGenerationDispatch,
      args,
    );
  },
  finalize: finalizeGenerationHandler,
};

export async function reconcileRunGenerationDispatchHandler(
  ctx: MutationCtx,
  args: {
    generationArgs: RunGenerationArgs;
    restartAttempt: number;
  },
  deps: DispatchWatchdogDeps = defaultDispatchWatchdogDeps,
): Promise<"settled" | "restarted" | "failed"> {
  const stranded = await deps.findStranded(ctx, args.generationArgs);
  if (stranded.length === 0) return "settled";

  if (args.restartAttempt < DISPATCH_WATCHDOG_MAX_RESTARTS) {
    const generationArgs = {
      ...args.generationArgs,
      participants: stranded,
      enqueuedAt: Date.now(),
      dispatchRecovery: true,
    };
    await deps.restart(ctx, generationArgs);
    await deps.scheduleRecheck(ctx, {
      generationArgs,
      restartAttempt: args.restartAttempt + 1,
    });
    return "restarted";
  }

  const summary = "Generation dispatch did not start after bounded retries.";
  for (const participant of stranded) {
    await deps.finalize(ctx, {
      messageId: participant.messageId,
      jobId: participant.jobId,
      chatId: args.generationArgs.chatId,
      content: `Error: ${summary}`,
      status: "failed",
      error: summary,
      userId: args.generationArgs.userId,
    });
  }
  return "failed";
}

export const reconcileRunGenerationDispatch = internalMutation({
  args: {
    generationArgs: v.object(runGenerationArgs),
    restartAttempt: v.number(),
  },
  returns: v.union(
    v.literal("settled"),
    v.literal("restarted"),
    v.literal("failed"),
  ),
  handler: reconcileRunGenerationDispatchHandler,
});
