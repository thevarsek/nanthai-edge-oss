import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { sleep } from "./actions_helpers";

export async function shouldSessionContinue(
  ctx: ActionCtx,
  sessionId: Id<"autonomousSessions">,
): Promise<boolean> {
  return await ctx.runMutation(internal.autonomous.mutations.shouldContinue, {
    sessionId,
  });
}

export async function pauseBetweenTurnsWithHeartbeat(
  ctx: ActionCtx,
  sessionId: Id<"autonomousSessions">,
  pauseBetweenTurnsSeconds: number,
): Promise<boolean> {
  let remainingPauseMs = Math.max(0, Math.floor(pauseBetweenTurnsSeconds * 1000));

  while (remainingPauseMs > 0) {
    const pauseStillRunning = await shouldSessionContinue(ctx, sessionId);
    if (!pauseStillRunning) return false;

    const sleepMs = Math.min(250, remainingPauseMs);
    await sleep(sleepMs);
    remainingPauseMs -= sleepMs;
  }

  return true;
}

export async function completeSessionFailedIfRunning(
  ctx: ActionCtx,
  sessionId: Id<"autonomousSessions">,
  reason: string,
): Promise<void> {
  const latestSession = await ctx.runQuery(internal.autonomous.queries.getSession, {
    sessionId,
  });
  if (!latestSession || latestSession.status !== "running") {
    return;
  }

  await ctx.runMutation(internal.autonomous.mutations.completeSession, {
    sessionId,
    status: "failed",
    error: reason,
    stopReason: "Autonomous cycle failed",
  });
}
