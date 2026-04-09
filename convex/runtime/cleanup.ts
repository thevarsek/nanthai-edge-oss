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

export const cleanStaleSandboxSessions = internalAction({
  args: {},
  handler: async (ctx) => {
    // 1. Query stale sessions
    const { sessions, hitBatchLimit } = await ctx.runQuery(
      internal.runtime.queries.getStaleSessionsInternal,
      {},
    );

    if (sessions.length === 0) return;

    // 2. Best-effort Sandbox.stop() for sessions that may have a live VM
    const sessionsWithVm = sessions.filter(
      (s) => s.hasVm && s.providerSandboxId,
    );
    if (sessionsWithVm.length > 0) {
      const { Sandbox } = await import("@vercel/sandbox");
      const token = process.env.VERCEL_SANDBOX_TOKEN?.trim();
      const projectId = process.env.VERCEL_SANDBOX_PROJECT_ID?.trim();
      const teamId = process.env.VERCEL_SANDBOX_TEAM_ID?.trim();

      if (token && projectId && teamId) {
        // Fire all stop calls in parallel — each is independent and may fail.
        await Promise.allSettled(
          sessionsWithVm.map(async (s) => {
            try {
              const sandbox = await Sandbox.get({
                sandboxId: s.providerSandboxId!,
                token,
                projectId,
                teamId,
              });
              await sandbox.stop();
            } catch {
              // VM already stopped/expired — expected for most stale sessions.
            }
          }),
        );
      }
    }

    // 3. Mark all stale sessions as deleted in the DB
    await ctx.runMutation(
      internal.runtime.mutations.markSessionsDeletedInternal,
      {
        sessionIds: sessions.map((s) => s.id),
        reason: "Stale session cleanup (cron)",
      },
    );

    const vmCount = sessionsWithVm.length;
    const dbCount = sessions.length;
    console.log(
      `[sandbox-cleanup] Marked ${dbCount} stale sessions as deleted` +
        (vmCount > 0 ? ` (attempted Sandbox.stop() on ${vmCount})` : ""),
    );

    // 4. If we hit the batch limit, self-schedule a continuation
    if (hitBatchLimit) {
      await ctx.scheduler.runAfter(
        0,
        internal.runtime.cleanup.cleanStaleSandboxSessions,
        {},
      );
    }
  },
});
