"use node";

// convex/runtime/cleanup.ts
// =============================================================================
// Stale sandbox session cleanup — action entry point.
//
// Sandbox VMs have a wall-clock lifetime (default 5 min). After the VM dies,
// the `sandboxSessions` record can linger in "running" or "pendingCreate"
// status indefinitely. These stale records cause unnecessary Sandbox.get()
// calls that fail and fall back to creating new VMs.
//
// The query (getStaleSessionsInternal) lives in queries.ts and the mutation
// (markSessionsDeletedInternal) lives in mutations.ts — Convex only allows
// actions in "use node" files. This file exports the action that orchestrates
// the cleanup, called by cron every 30 minutes.
// =============================================================================

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";

export const stopSandboxById = internalAction({
  args: { providerSandboxId: v.string() },
  returns: v.boolean(),
  handler: async (_ctx, args) => {
    try {
      const { Sandbox } = await import("@vercel/sandbox");
      const token = process.env.VERCEL_SANDBOX_TOKEN?.trim();
      const projectId = process.env.VERCEL_SANDBOX_PROJECT_ID?.trim();
      const teamId = process.env.VERCEL_SANDBOX_TEAM_ID?.trim();
      if (!token || !projectId || !teamId) return false;
      const sandbox = await Sandbox.get({
        sandboxId: args.providerSandboxId,
        token,
        projectId,
        teamId,
      });
      await sandbox.stop();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      return message.includes("not found") || message.includes("stopped") || message.includes("expired");
    }
  },
});

type StaleSandboxSession = {
  id: Id<"sandboxSessions">;
  providerSandboxId?: string;
};

const CLEANUP_CONTINUATION_DELAY_MS = 1_000;
const FAILED_STOP_BACKOFF_BASE_MS = 30_000;
const FAILED_STOP_BACKOFF_MAX_MS = 15 * 60 * 1000;
const FAILED_STOP_MAX_SELF_RETRIES = 5;

export function staleSandboxRetryDelayMs(failureAttempt: number): number {
  return Math.min(
    FAILED_STOP_BACKOFF_BASE_MS * (2 ** Math.max(0, failureAttempt)),
    FAILED_STOP_BACKOFF_MAX_MS,
  );
}

export const cleanStaleSandboxSessions = internalAction({
  args: { failureAttempt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    // 1. Query stale sessions
    const { sessions, hitBatchLimit } = await ctx.runQuery(
      internal.runtime.queries.getStaleSessionsInternal,
      {},
    );

    if (sessions.length === 0) return;

    // 2. Confirm Sandbox.stop() before releasing the ownership record. Unknown
    // provider/credential failures remain discoverable for reconciliation.
    const sessionsWithVm = sessions.flatMap((session: StaleSandboxSession) => {
      const providerSandboxId = session.providerSandboxId?.trim();
      return providerSandboxId ? [{ ...session, providerSandboxId }] : [];
    });
    const confirmedIds: Id<"sandboxSessions">[] = sessions
      .filter((session: StaleSandboxSession) => !session.providerSandboxId?.trim())
      .map((session: StaleSandboxSession) => session.id);
    for (const session of sessionsWithVm) {
      const stopped = await ctx.runAction(internal.runtime.cleanup.stopSandboxById, {
        providerSandboxId: session.providerSandboxId,
      });
      if (stopped) confirmedIds.push(session.id);
    }

    // 3. Mark only provider-confirmed sessions deleted in the DB.
    if (confirmedIds.length > 0) {
      await ctx.runMutation(
        internal.runtime.mutations.markSessionsDeletedInternal,
        {
          sessionIds: confirmedIds,
        reason: "Stale session cleanup (cron)",
        },
      );
    }

    const vmCount = sessionsWithVm.length;
    const dbCount = confirmedIds.length;
    console.log(
      `[sandbox-cleanup] Marked ${dbCount} stale sessions as deleted` +
        (vmCount > 0 ? ` (attempted Sandbox.stop() on ${vmCount})` : ""),
    );

    // 4. Continue promptly while making progress through a capped batch. A
    // persistent provider stop failure uses bounded exponential backoff and
    // then falls back to the 30-minute cron. This prevents runAfter(0) hot
    // loops from consuming function capacity indefinitely.
    const hasUnconfirmedStops = confirmedIds.length < sessions.length;
    const failureAttempt = args?.failureAttempt ?? 0;
    if (hasUnconfirmedStops && failureAttempt < FAILED_STOP_MAX_SELF_RETRIES) {
      await ctx.scheduler.runAfter(
        staleSandboxRetryDelayMs(failureAttempt),
        internal.runtime.cleanup.cleanStaleSandboxSessions,
        { failureAttempt: failureAttempt + 1 },
      );
    } else if (hitBatchLimit && !hasUnconfirmedStops) {
      await ctx.scheduler.runAfter(
        CLEANUP_CONTINUATION_DELAY_MS,
        internal.runtime.cleanup.cleanStaleSandboxSessions,
        {},
      );
    }
  },
});
