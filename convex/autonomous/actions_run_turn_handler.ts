import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  loadModelCapabilities,
  normalizeRunCycleArgs,
  resolveLinearCycleParentIds,
  resolveTurnParticipants,
} from "./actions_run_cycle_context";
import { runParticipantTurn } from "./actions_run_cycle_turn";
import type { RunCycleArgs } from "./actions_run_cycle_types";
import { normalizeGenerationError } from "../chat/generation_error";

export type AutonomousTurnResult =
  | { kind: "completed" | "skipped" | "failed" }
  | { kind: "terminal" };

export async function runAutonomousTurnHandler(
  ctx: ActionCtx,
  args: RunCycleArgs & { participantIndex: number },
): Promise<AutonomousTurnResult> {
  try {
    const recovered = await ctx.runMutation(internal.autonomous.turn_checkpoint.recoverTurn, {
      sessionId: args.sessionId,
      cycle: args.cycle,
      participantIndex: args.participantIndex,
      executionEpoch: args.executionEpoch,
    });
    if (recovered !== "execute") return { kind: recovered };
    const running = await ctx.runMutation(internal.autonomous.mutations.shouldContinue, {
      sessionId: args.sessionId,
      executionEpoch: args.executionEpoch,
    });
    if (!running) return { kind: "terminal" };
    const session = await ctx.runQuery(internal.autonomous.queries.getSession, {
      sessionId: args.sessionId,
    });
    if (!session) return { kind: "terminal" };
    const normalized = normalizeRunCycleArgs(args);
    const participants = resolveTurnParticipants(session.turnOrder, normalized.participants);
    if (participants.length < 2) {
      await ctx.runMutation(internal.autonomous.mutations.completeSession, {
        sessionId: args.sessionId,
        status: "failed",
        error: "Session has fewer than 2 valid turn participants",
        stopReason: "Autonomous cycle failed",
        executionEpoch: args.executionEpoch,
      });
      return { kind: "terminal" };
    }
    const participant = participants[args.participantIndex];
    if (!participant) return { kind: "skipped" };
    await ctx.runMutation(internal.autonomous.mutations.updateProgress, {
      sessionId: args.sessionId,
      currentCycle: args.cycle,
      currentParticipantIndex: args.participantIndex,
      executionEpoch: args.executionEpoch,
    });
    const outcome = await runParticipantTurn({
      ctx,
      sessionId: args.sessionId,
      chatId: session.chatId,
      participant,
      cycleParentIds: resolveLinearCycleParentIds(session.parentMessageIds),
      modelCapabilities: await loadModelCapabilities(ctx, [participant]),
      memoryContext: undefined,
      moderatorConfig: normalized.moderator,
      userId: args.userId,
      webSearchEnabled: args.webSearchEnabled,
      executionEpoch: args.executionEpoch,
      executionAttemptId: args.executionAttemptId,
      executionFence: args.executionFence,
      turnCycle: args.cycle,
      turnParticipantIndex: args.participantIndex,
    });
    if (outcome.kind === "cancelled") return { kind: "terminal" };
    await ctx.runMutation(internal.autonomous.turn_checkpoint.settle, {
      sessionId: args.sessionId,
      cycle: args.cycle,
      participantIndex: args.participantIndex,
      executionEpoch: args.executionEpoch,
      outcome: outcome.kind,
      ...(outcome.kind === "completed" ? { messageId: outcome.messageId } : {}),
    });
    return { kind: outcome.kind };
  } catch (error) {
    if (args.workflowManaged) throw error;
    const reason = normalizeGenerationError(error).message;
    const session = await ctx.runQuery(internal.autonomous.queries.getSession, {
      sessionId: args.sessionId,
    });
    if (session?.status === "running") {
      await ctx.runMutation(internal.autonomous.mutations.completeSession, {
        sessionId: args.sessionId,
        status: "failed",
        error: reason,
        stopReason: "Autonomous turn failed",
        executionEpoch: args.executionEpoch,
      });
    }
    throw error;
  }
}
