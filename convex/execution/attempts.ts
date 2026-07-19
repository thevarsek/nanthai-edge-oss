import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { appendRunEventUnchecked } from "./events";
import type { ExecutionAttemptState, ExecutionRunState } from "./validators";
import { TERMINAL_ATTEMPT_STATES, TERMINAL_RUN_STATES } from "./validators";

export const DEFAULT_EXECUTION_LEASE_MS = 12 * 60 * 1000;

export interface ClaimedExecution {
  runId: Id<"executionRuns">;
  attemptId: Id<"executionAttempts">;
  fence: number;
  leaseExpiresAt: number;
}

function isTerminalRun(run: Doc<"executionRuns">): boolean {
  return TERMINAL_RUN_STATES.has(run.state as "completed" | "failed" | "cancelled");
}

function isTerminalAttempt(attempt: Doc<"executionAttempts">): boolean {
  return TERMINAL_ATTEMPT_STATES.has(
    attempt.status as "completed" | "failed" | "cancelled" | "superseded",
  );
}

async function supersedeAttempt(
  ctx: MutationCtx,
  run: Doc<"executionRuns">,
  previous: Doc<"executionAttempts">,
  claimantId: string,
  leaseMs: number,
  now: number,
): Promise<ClaimedExecution> {
  const attemptNumber = run.nextAttemptNumber;
  const fence = Math.max(run.nextFence ?? previous.fence + 1, previous.fence + 1);
  const leaseExpiresAt = now + leaseMs;
  const attemptId = await ctx.db.insert("executionAttempts", {
    runId: run._id,
    userId: run.userId,
    attemptNumber,
    executorKind: previous.executorKind,
    placement: previous.placement,
    adapterId: previous.adapterId,
    adapterVersion: previous.adapterVersion,
    provider: previous.provider,
    modelId: previous.modelId,
    runtimeLabel: previous.runtimeLabel,
    deviceId: previous.deviceId,
    workspaceId: previous.workspaceId,
    protocolVersion: previous.protocolVersion,
    orchestrationEngine: previous.orchestrationEngine,
    orchestrationVersion: previous.orchestrationVersion,
    rolloutCohort: previous.rolloutCohort,
    status: "running",
    claimantId,
    fence,
    leaseExpiresAt,
    heartbeatAt: now,
    checkpointRef: previous.checkpointRef,
    startedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const activeBindings = await ctx.db
    .query("runtimeSessionBindings")
    .withIndex("by_attempt_status", (q) =>
      q.eq("attemptId", previous._id).eq("status", "active"),
    )
    .collect();
  await Promise.all(activeBindings.map((binding) =>
    ctx.db.patch(binding._id, {
      status: "released",
      releasedAt: now,
      releaseReason: "attempt_superseded",
    }),
  ));
  await ctx.db.patch(previous._id, {
    status: "superseded",
    leaseExpiresAt: undefined,
    supersededByAttemptId: attemptId,
    completedAt: now,
    updatedAt: now,
  });
  await ctx.db.patch(run._id, {
    activeAttemptId: attemptId,
    nextAttemptNumber: attemptNumber + 1,
    nextFence: fence + 1,
    state: "running",
    updatedAt: now,
  });
  await appendRunEventUnchecked(ctx, run, {
    attemptId,
    fence,
    type: "superseded",
    summary: `Attempt ${previous.attemptNumber} superseded by attempt ${attemptNumber}`,
    now,
  });
  return { runId: run._id, attemptId, fence, leaseExpiresAt };
}

export async function claimExecutionRun(
  ctx: MutationCtx,
  args: {
    runId: Id<"executionRuns">;
    claimantId: string;
    leaseMs?: number;
    now?: number;
  },
): Promise<ClaimedExecution | null> {
  const now = args.now ?? Date.now();
  const leaseMs = Math.max(1, args.leaseMs ?? DEFAULT_EXECUTION_LEASE_MS);
  const run = await ctx.db.get(args.runId);
  if (!run?.activeAttemptId || isTerminalRun(run) || run.state === "cancelling") return null;
  const attempt = await ctx.db.get(run.activeAttemptId);
  if (!attempt) return null;
  const activeLease = (attempt.leaseExpiresAt ?? 0) > now;
  if (attempt.status === "queued" && !attempt.claimantId) {
    const leaseExpiresAt = now + leaseMs;
    await ctx.db.patch(attempt._id, {
      status: "running",
      claimantId: args.claimantId,
      leaseExpiresAt,
      heartbeatAt: now,
      startedAt: attempt.startedAt ?? now,
      updatedAt: now,
    });
    await ctx.db.patch(run._id, { state: "running", updatedAt: now });
    await appendRunEventUnchecked(ctx, run, {
      attemptId: attempt._id,
      fence: attempt.fence,
      type: "claimed",
      summary: "Execution claimed",
      now,
    });
    return { runId: run._id, attemptId: attempt._id, fence: attempt.fence, leaseExpiresAt };
  }
  if (attempt.status === "running" && activeLease) {
    if (attempt.claimantId !== args.claimantId) return null;
    const leaseExpiresAt = now + leaseMs;
    await ctx.db.patch(attempt._id, { leaseExpiresAt, heartbeatAt: now, updatedAt: now });
    return { runId: run._id, attemptId: attempt._id, fence: attempt.fence, leaseExpiresAt };
  }
  if (isTerminalAttempt(attempt) && run.activeAttemptId === attempt._id) {
    if (attempt.status !== "superseded" && run.state !== "interrupted") return null;
  }
  return await supersedeAttempt(ctx, run, attempt, args.claimantId, leaseMs, now);
}

export async function assertCurrentExecution(
  ctx: MutationCtx,
  args: {
    attemptId: Id<"executionAttempts">;
    fence: number;
    claimantId?: string;
    now?: number;
    allowExpiredLease?: boolean;
    allowCancelling?: boolean;
    allowWaiting?: boolean;
    allowDeletingOwner?: boolean;
  },
): Promise<{ run: Doc<"executionRuns">; attempt: Doc<"executionAttempts"> }> {
  const attempt = await ctx.db.get(args.attemptId);
  if (!attempt || attempt.fence !== args.fence) throw new Error("STALE_EXECUTION_FENCE");
  const run = await ctx.db.get(attempt.runId);
  if (!run || run.activeAttemptId !== attempt._id) throw new Error("STALE_EXECUTION_ATTEMPT");
  if (!args.allowDeletingOwner) {
    const tombstone = await ctx.db
      .query("accountDeletionTombstones")
      .withIndex("by_user", (q) => q.eq("userId", run.userId))
      .unique();
    if (tombstone) throw new Error("EXECUTION_OWNER_DELETING");
    if (run.chatId) {
      const chat = await ctx.db.get(run.chatId);
      if (!chat || chat.isDeleting === true) throw new Error("EXECUTION_CHAT_DELETING");
    }
  }
  if (isTerminalRun(run)) throw new Error("TERMINAL_EXECUTION_RUN");
  if (run.state === "cancelling" && !args.allowCancelling) {
    throw new Error("EXECUTION_CANCELLATION_REQUESTED");
  }
  if (isTerminalAttempt(attempt)) throw new Error("TERMINAL_EXECUTION_ATTEMPT");
  if (
    (attempt.status === "waiting" || attempt.status === "interrupted")
    && !args.allowWaiting
  ) {
    throw new Error("EXECUTION_ATTEMPT_NOT_WRITABLE");
  }
  if (args.claimantId !== undefined && attempt.claimantId !== args.claimantId) {
    throw new Error("EXECUTION_CLAIMANT_MISMATCH");
  }
  const now = args.now ?? Date.now();
  if (
    !args.allowExpiredLease
    && attempt.leaseExpiresAt !== undefined
    && attempt.leaseExpiresAt <= now
  ) {
    throw new Error("EXECUTION_LEASE_EXPIRED");
  }
  return { run, attempt };
}

export async function terminalizeAttempt(
  ctx: MutationCtx,
  args: {
    attemptId: Id<"executionAttempts">;
    fence: number;
    claimantId?: string;
    outcome: "completed" | "failed" | "cancelled" | "interrupted";
    summary?: string;
    now?: number;
    allowExpiredLease?: boolean;
    allowWaiting?: boolean;
  },
): Promise<{ changed: boolean; outcome: "completed" | "failed" | "cancelled" | "interrupted" }> {
  const attempt = await ctx.db.get(args.attemptId);
  if (!attempt || attempt.fence !== args.fence) throw new Error("STALE_EXECUTION_FENCE");
  const run = await ctx.db.get(attempt.runId);
  if (!run) throw new Error("EXECUTION_RUN_NOT_FOUND");
  if (
    run.terminalOutcome
    && (run.state === "completed" || run.state === "failed" || run.state === "cancelled")
  ) {
    return { changed: false, outcome: run.terminalOutcome };
  }
  const current = await assertCurrentExecution(ctx, {
    attemptId: args.attemptId,
    fence: args.fence,
    claimantId: args.claimantId,
    now: args.now,
    allowExpiredLease: args.outcome === "cancelled" || args.allowExpiredLease === true,
    allowCancelling: args.outcome === "cancelled",
    allowWaiting: args.outcome === "cancelled" || args.allowWaiting === true,
    allowDeletingOwner: args.outcome === "cancelled",
  });
  const now = args.now ?? Date.now();
  const runState: ExecutionRunState = args.outcome === "interrupted" ? "interrupted" : args.outcome;
  const attemptState: ExecutionAttemptState = args.outcome;
  await ctx.db.patch(current.attempt._id, {
    status: attemptState,
    leaseExpiresAt: undefined,
    completedAt: args.outcome === "interrupted" ? undefined : now,
    errorSummary: args.outcome === "failed" ? args.summary?.slice(0, 2_000) : undefined,
    updatedAt: now,
  });
  await ctx.db.patch(current.run._id, {
    state: runState,
    terminalOutcome: args.outcome,
    terminalSummary: args.summary?.slice(0, 2_000),
    completedAt: args.outcome === "interrupted" ? undefined : now,
    updatedAt: now,
  });
  await appendRunEventUnchecked(ctx, current.run, {
    attemptId: current.attempt._id,
    fence: current.attempt.fence,
    type: args.outcome,
    summary: args.summary ?? args.outcome,
    now,
  });
  return { changed: true, outcome: args.outcome };
}
