import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { DEFAULT_EXECUTION_LEASE_MS, type ClaimedExecution } from "./attempts";
import { appendRunEventUnchecked } from "./events";
import type { InitialAttemptSpec } from "./runs";

export async function createExecutionAttempt(
  ctx: MutationCtx,
  args: {
    runId: Id<"executionRuns">;
    attempt: InitialAttemptSpec;
    claimantId?: string;
    leaseMs?: number;
    checkpointRef?: string;
    now?: number;
  },
): Promise<ClaimedExecution> {
  const now = args.now ?? Date.now();
  const run = await ctx.db.get(args.runId);
  if (!run || ["cancelling", "completed", "failed", "cancelled"].includes(run.state)) {
    throw new Error("EXECUTION_RUN_NOT_RETRYABLE");
  }
  const previous = run.activeAttemptId ? await ctx.db.get(run.activeAttemptId) : null;
  const attemptNumber = run.nextAttemptNumber;
  const fence = Math.max(run.nextFence ?? (previous?.fence ?? 0) + 1, (previous?.fence ?? 0) + 1);
  const leaseExpiresAt = args.claimantId
    ? now + Math.max(1, args.leaseMs ?? DEFAULT_EXECUTION_LEASE_MS)
    : now;
  const attemptId = await ctx.db.insert("executionAttempts", {
    runId: run._id,
    userId: run.userId,
    attemptNumber,
    ...args.attempt,
    protocolVersion: args.attempt.protocolVersion ?? "nanthai-execution-v1",
    orchestrationEngine: args.attempt.orchestrationEngine
      ?? previous?.orchestrationEngine
      ?? (args.attempt.executorKind === "local_runtime"
        || args.attempt.executorKind === "external_cloud"
        ? "runtime_adapter"
        : "convex_workflow"),
    orchestrationVersion: args.attempt.orchestrationVersion
      ?? previous?.orchestrationVersion
      ?? "m47-v1",
    rolloutCohort: args.attempt.rolloutCohort ?? previous?.rolloutCohort ?? "default",
    status: args.claimantId ? "running" : "queued",
    claimantId: args.claimantId,
    fence,
    leaseExpiresAt: args.claimantId ? leaseExpiresAt : undefined,
    heartbeatAt: args.claimantId ? now : undefined,
    checkpointRef: args.checkpointRef ?? previous?.checkpointRef,
    startedAt: args.claimantId ? now : undefined,
    createdAt: now,
    updatedAt: now,
  });
  if (previous) {
    const bindings = await ctx.db
      .query("runtimeSessionBindings")
      .withIndex("by_attempt_status", (q) =>
        q.eq("attemptId", previous._id).eq("status", "active"),
      )
      .collect();
    for (const binding of bindings) {
      await ctx.db.patch(binding._id, {
        status: "released",
        releasedAt: now,
        releaseReason: "attempt_superseded",
      });
    }
    await ctx.db.patch(previous._id, {
      status: "superseded",
      leaseExpiresAt: undefined,
      supersededByAttemptId: attemptId,
      completedAt: now,
      updatedAt: now,
    });
  }
  await ctx.db.patch(run._id, {
    activeAttemptId: attemptId,
    nextAttemptNumber: attemptNumber + 1,
    nextFence: fence + 1,
    state: args.claimantId ? "running" : "queued",
    updatedAt: now,
  });
  await appendRunEventUnchecked(ctx, run, {
    attemptId,
    fence,
    type: previous ? "superseded" : "created",
    summary: previous
      ? `Attempt ${previous.attemptNumber} superseded by attempt ${attemptNumber}`
      : "Execution attempt created",
    now,
  });
  return { runId: run._id, attemptId, fence, leaseExpiresAt };
}
