import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  checkConsensusInternal,
} from "./actions_helpers";
import {
  loadModelCapabilities,
  normalizeRunCycleArgs,
  resolveLinearCycleParentIds,
  resolveStartParticipantIndex,
  resolveTurnParticipants,
} from "./actions_run_cycle_context";
import {
  completeSessionFailedIfRunning,
  pauseBetweenTurnsWithHeartbeat,
  shouldSessionContinue,
} from "./actions_run_cycle_session";
import { runParticipantTurn } from "./actions_run_cycle_turn";
import { RunCycleArgs } from "./actions_run_cycle_types";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";

export type { RunCycleArgs } from "./actions_run_cycle_types";

const defaultRunCycleHandlerDeps = {
  checkConsensusInternal,
  loadModelCapabilities,
  normalizeRunCycleArgs,
  resolveLinearCycleParentIds,
  resolveStartParticipantIndex,
  resolveTurnParticipants,
  completeSessionFailedIfRunning,
  pauseBetweenTurnsWithHeartbeat,
  shouldSessionContinue,
  runParticipantTurn,
};

export type RunCycleHandlerDeps = typeof defaultRunCycleHandlerDeps;

export function createRunCycleHandlerDepsForTest(
  overrides: DeepPartial<RunCycleHandlerDeps> = {},
): RunCycleHandlerDeps {
  return mergeTestDeps(defaultRunCycleHandlerDeps, overrides);
}

export async function runCycleHandler(
  ctx: ActionCtx,
  args: RunCycleArgs,
  deps: RunCycleHandlerDeps = defaultRunCycleHandlerDeps,
): Promise<void> {
  const normalized = deps.normalizeRunCycleArgs(args);

  try {
    const shouldContinue = await deps.shouldSessionContinue(
      ctx,
      args.sessionId,
    );
    if (!shouldContinue) return;

    const session = await ctx.runQuery(internal.autonomous.queries.getSession, {
      sessionId: args.sessionId,
    });
    if (!session) return;

    const turnParticipants = deps.resolveTurnParticipants(
      session.turnOrder,
      normalized.participants,
    );
    if (turnParticipants.length < 2) {
      await ctx.runMutation(internal.autonomous.mutations.completeSession, {
        sessionId: args.sessionId,
        status: "failed",
        error: "Session has fewer than 2 valid turn participants",
        stopReason: "Autonomous cycle failed",
      });
      return;
    }

    const startParticipantIndex = deps.resolveStartParticipantIndex(
      args.startParticipantIndex,
      turnParticipants.length,
    );

    await ctx.runMutation(internal.autonomous.mutations.updateProgress, {
      sessionId: args.sessionId,
      currentCycle: args.cycle,
      currentParticipantIndex:
        startParticipantIndex > 0 &&
        startParticipantIndex <= turnParticipants.length
          ? startParticipantIndex - 1
          : undefined,
    });

    let cycleParentIds: Id<"messages">[] = deps.resolveLinearCycleParentIds(
      session.parentMessageIds,
    );
    const modelCapabilities = await deps.loadModelCapabilities(
      ctx,
      turnParticipants,
    );

    for (let i = startParticipantIndex; i < turnParticipants.length; i += 1) {
      const participant = turnParticipants[i];

      const stillRunning = await deps.shouldSessionContinue(
        ctx,
        args.sessionId,
      );
      if (!stillRunning) return;

      await ctx.runMutation(internal.autonomous.mutations.updateProgress, {
        sessionId: args.sessionId,
        currentCycle: args.cycle,
        currentParticipantIndex: i,
      });

      const outcome = await deps.runParticipantTurn({
        ctx,
        sessionId: args.sessionId,
        chatId: session.chatId,
        participant,
        cycleParentIds,
        modelCapabilities,
        memoryContext: undefined,
        moderatorConfig: normalized.moderator,
        userId: args.userId,
        webSearchEnabled: args.webSearchEnabled,
      });

      if (outcome.kind === "cancelled") {
        return;
      }
      if (outcome.kind === "failed") {
        console.error(
          `Autonomous turn failed for ${participant.displayName}:`,
          outcome.reason,
        );
        continue;
      }
      if (outcome.kind === "completed") {
        cycleParentIds = [outcome.messageId];
      }

      if (session.pauseBetweenTurns > 0 && i < turnParticipants.length - 1) {
        const resumed = await deps.pauseBetweenTurnsWithHeartbeat(
          ctx,
          args.sessionId,
          session.pauseBetweenTurns,
        );
        if (!resumed) return;
      }
    }

    if (session.autoStopOnConsensus) {
      const consensus = await deps.checkConsensusInternal(
        ctx,
        session.chatId,
        turnParticipants.length,
        args.userId,
      );
      if (consensus) {
        await ctx.runMutation(internal.autonomous.mutations.completeSession, {
          sessionId: args.sessionId,
          status: "completed_consensus",
          stopReason: "Consensus detected",
        });
        return;
      }
    }

    if (args.cycle < session.maxCycles) {
      const stillRunning = await deps.shouldSessionContinue(
        ctx,
        args.sessionId,
      );
      if (!stillRunning) return;

      await ctx.scheduler.runAfter(0, internal.autonomous.actions.runCycle, {
        sessionId: args.sessionId,
        cycle: args.cycle + 1,
        startParticipantIndex: 0,
        userId: args.userId,
        participantConfigs: normalized.participants,
        moderatorConfig: normalized.moderator,
        webSearchEnabled: args.webSearchEnabled,
      });
    } else {
      await ctx.runMutation(internal.autonomous.mutations.completeSession, {
        sessionId: args.sessionId,
        status: "completed_max_cycles",
        stopReason: "Max cycles reached",
      });
    }
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Unknown autonomous error";
    console.error("Autonomous cycle failed:", reason);
    await deps.completeSessionFailedIfRunning(
      ctx,
      args.sessionId,
      reason,
    );
  }
}
