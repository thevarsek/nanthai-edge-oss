import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  assertCurrentExecution,
  claimExecutionRun,
  terminalizeAttempt,
  type ClaimedExecution,
} from "./attempts";
import { appendRunEventUnchecked } from "./events";
import { createExecutionRun } from "./runs";
import type { RunEventType } from "./validators";

export type { ClaimedExecution } from "./attempts";

export async function createGenerationExecution(
  ctx: MutationCtx,
  args: {
    jobId: Id<"generationJobs">;
    userId: string;
    chatId: Id<"chats">;
    sourceMessageId: Id<"messages">;
    modelId?: string;
    parentRunId?: Id<"executionRuns">;
    now: number;
  },
): Promise<ClaimedExecution> {
  const execution = await createExecutionRun(ctx, {
    userId: args.userId,
    runKey: `generation:${String(args.jobId)}`,
    chatId: args.chatId,
    sourceMessageId: args.sourceMessageId,
    generationJobId: args.jobId,
    domainType: "generationJob",
    domainId: String(args.jobId),
    parentRunId: args.parentRunId,
    kind: "chat_generation",
    requestedPlacement: "cloud",
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
      provider: args.modelId?.split("/")[0],
      modelId: args.modelId,
      orchestrationEngine: "convex_workflow",
      orchestrationVersion: "m47.v1",
      rolloutCohort: "workflow-default",
    },
    now: args.now,
  });
  await ctx.db.patch(args.jobId, {
    executionRunId: execution.runId,
    executionAttemptId: execution.attemptId,
    executionFence: execution.fence,
  });
  return execution;
}

export async function ensureGenerationExecution(
  ctx: MutationCtx,
  jobId: Id<"generationJobs">,
  now = Date.now(),
): Promise<ClaimedExecution | null> {
  const job = await ctx.db.get(jobId);
  if (!job) return null;
  if (job.executionRunId) {
    const run = await ctx.db.get(job.executionRunId);
    if (run?.activeAttemptId) {
      const attempt = await ctx.db.get(run.activeAttemptId);
      if (attempt) {
        if (
          job.executionAttemptId !== attempt._id
          || job.executionFence !== attempt.fence
        ) {
          await ctx.db.patch(job._id, {
            executionAttemptId: attempt._id,
            executionFence: attempt.fence,
          });
        }
        return {
          runId: run._id,
          attemptId: attempt._id,
          fence: attempt.fence,
          leaseExpiresAt: attempt.leaseExpiresAt ?? now,
        };
      }
    }
  }
  let parentRunId: Id<"executionRuns"> | undefined;
  if (job.sourceJobId) {
    const scheduledJob = await ctx.db.get(job.sourceJobId);
    parentRunId = scheduledJob?.executionRunId;
  }
  return await createGenerationExecution(ctx, {
    jobId,
    userId: job.userId,
    chatId: job.chatId,
    sourceMessageId: job.messageId,
    modelId: job.modelId,
    parentRunId,
    now,
  });
}

export async function claimGenerationExecution(
  ctx: MutationCtx,
  args: {
    jobId: Id<"generationJobs">;
    claimantId: string;
    leaseMs?: number;
    expectedAttemptId?: Id<"executionAttempts">;
    expectedFence?: number;
    now?: number;
  },
): Promise<ClaimedExecution | null> {
  const now = args.now ?? Date.now();
  const ensured = await ensureGenerationExecution(ctx, args.jobId, now);
  if (!ensured) return null;
  if (
    args.expectedAttemptId !== undefined
    && (ensured.attemptId !== args.expectedAttemptId || ensured.fence !== args.expectedFence)
  ) {
    return null;
  }
  const claim = await claimExecutionRun(ctx, {
    runId: ensured.runId,
    claimantId: args.claimantId,
    leaseMs: args.leaseMs,
    now,
  });
  if (!claim) return null;
  await ctx.db.patch(args.jobId, {
    executionRunId: claim.runId,
    executionAttemptId: claim.attemptId,
    executionFence: claim.fence,
  });
  return claim;
}

export async function assertCurrentFence(
  ctx: MutationCtx,
  attemptId: Id<"executionAttempts">,
  fence: number,
  options?: { allowCancelling?: boolean; allowDeletingOwner?: boolean },
): Promise<{ run: Doc<"executionRuns">; attempt: Doc<"executionAttempts"> }> {
  return await assertCurrentExecution(ctx, { attemptId, fence, ...options });
}

export async function appendExecutionEvent(
  ctx: MutationCtx,
  args: {
    attemptId: Id<"executionAttempts">;
    fence: number;
    claimantId?: string;
    type: RunEventType;
    summary: string;
    phase?: string;
    progress?: number;
    artifactIds?: string[];
    privacyClass?: string;
    adapterDetail?: string;
    eventId?: string;
    now?: number;
  },
): Promise<void> {
  const { run, attempt } = await assertCurrentExecution(ctx, args);
  await appendRunEventUnchecked(ctx, run, {
    ...args,
    attemptId: attempt._id,
    fence: attempt.fence,
  });
}

export async function heartbeatExecution(
  ctx: MutationCtx,
  args: {
    attemptId: Id<"executionAttempts">;
    fence: number;
    claimantId?: string;
    leaseMs?: number;
    now?: number;
  },
): Promise<number> {
  const now = args.now ?? Date.now();
  const { attempt } = await assertCurrentExecution(ctx, {
    ...args,
    allowExpiredLease: false,
  });
  const leaseExpiresAt = now + Math.max(1, args.leaseMs ?? 12 * 60 * 1000);
  await ctx.db.patch(attempt._id, { heartbeatAt: now, leaseExpiresAt, updatedAt: now });
  return leaseExpiresAt;
}

export async function releaseExecutionForContinuation(
  ctx: MutationCtx,
  args: {
    attemptId: Id<"executionAttempts">;
    fence: number;
    claimantId?: string;
    checkpointRef?: string;
    now?: number;
  },
): Promise<void> {
  const now = args.now ?? Date.now();
  const { run, attempt } = await assertCurrentExecution(ctx, args);
  await ctx.db.patch(attempt._id, {
    status: "waiting",
    leaseExpiresAt: undefined,
    checkpointRef: args.checkpointRef
      ?? `generation:${String(run.generationJobId ?? run._id)}`,
    updatedAt: now,
  });
  await ctx.db.patch(run._id, { state: "waiting", updatedAt: now });
  await appendRunEventUnchecked(ctx, run, {
    attemptId: attempt._id,
    fence: attempt.fence,
    type: "waiting",
    summary: "Durable checkpoint committed",
    now,
  });
}

export async function terminalizeExecution(
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
): Promise<void> {
  await terminalizeAttempt(ctx, args);
}
