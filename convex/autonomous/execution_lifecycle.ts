import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import {
  heartbeatDomainExecution,
  interruptDomainExecution,
  terminalizeDomainExecution,
  type DomainExecutionRef,
} from "../execution/domain_lifecycle";
import { cancelInFlightAutonomousTurns } from "./session_helpers";

export function autonomousExecutionRef(
  session: Doc<"autonomousSessions">,
): DomainExecutionRef | null {
  if (
    !session.executionRunId ||
    !session.executionAttemptId ||
    session.executionFence === undefined ||
    !session.executionClaimantId
  )
    return null;
  return {
    runId: session.executionRunId,
    attemptId: session.executionAttemptId,
    fence: session.executionFence,
    claimantId: session.executionClaimantId,
  };
}

export async function terminalizeAutonomousSession(
  ctx: MutationCtx,
  session: Doc<"autonomousSessions">,
  outcome: "completed" | "failed" | "cancelled",
  summary: string,
): Promise<void> {
  const execution = autonomousExecutionRef(session);
  if (execution)
    await terminalizeDomainExecution(ctx, execution, outcome, summary);
}

export async function reconcileAutonomousSessionWorkflowFailure(
  ctx: MutationCtx,
  session: Doc<"autonomousSessions">,
  args: { cancelled: boolean; summary: string; now: number },
): Promise<void> {
  if (session.status !== "running") return;
  await cancelInFlightAutonomousTurns(ctx, session.chatId, session.turnOrder);
  await ctx.db.patch(session._id, {
    status: args.cancelled ? "stopped" : "failed",
    stopReason: args.cancelled ? "Execution cancelled" : undefined,
    error: args.cancelled ? undefined : args.summary,
    updatedAt: args.now,
  });
}

export const heartbeatSession = internalMutation({
  args: { sessionId: v.id("autonomousSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    const execution = session ? autonomousExecutionRef(session) : null;
    if (execution) await heartbeatDomainExecution(ctx, execution);
    return null;
  },
});

export async function interruptAutonomousSession(
  ctx: MutationCtx,
  session: Doc<"autonomousSessions">,
): Promise<void> {
  const execution = autonomousExecutionRef(session);
  if (execution)
    await interruptDomainExecution(ctx, execution, "Autonomous session paused");
}
