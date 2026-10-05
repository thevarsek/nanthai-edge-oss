import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
  assertCurrentExecution,
  claimExecutionRun,
  terminalizeAttempt,
  type ClaimedExecution,
} from "./attempts";
import { appendRunEventUnchecked } from "./events";
import { createExecutionRun, type InitialAttemptSpec } from "./runs";
import type { RunEventType } from "./validators";
import { ConvexError } from "convex/values";
import { resolveEffectiveParticipantRoute } from "../runtime_host/route_resolution";
import { RUNTIME_PROTOCOL_VERSION } from "../runtime_host/protocol_common";

export type { ClaimedExecution } from "./attempts";

export async function createGenerationExecution(
  ctx: MutationCtx,
  args: {
    jobId: Id<"generationJobs">;
    userId: string;
    chatId: Id<"chats">;
    sourceMessageId: Id<"messages">;
    modelId?: string;
    route?: Awaited<ReturnType<typeof resolveEffectiveParticipantRoute>>;
    parentRunId?: Id<"executionRuns">;
    now: number;
  },
): Promise<ClaimedExecution> {
  const localRoute = args.route?.placement === "local" ? args.route : null;
  let localAttempt: InitialAttemptSpec | null = null;
  if (localRoute) {
    const { adapterId, deviceId } = localRoute;
    if (!deviceId || !adapterId) throw new Error("LOCAL_RUNTIME_ROUTE_INCOMPLETE");
    localAttempt = {
      executorKind: "local_runtime",
      placement: "local",
      adapterId,
      provider: localRoute.provider,
      modelId: localRoute.modelId,
      modelSelectionMode: localRoute.modelSelectionMode,
      runtimeLabel: localRoute.deviceName,
      deviceId,
      chatParticipantId: localRoute.chatParticipantId,
      participantRouteSnapshotId: localRoute.participantRouteSnapshotId,
      chatRuntimeOverrideId: localRoute.chatRuntimeOverrideId,
      routeSnapshotHash: localRoute.routeSnapshotHash,
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      orchestrationEngine: "runtime_adapter",
      orchestrationVersion: "m45.v1",
      rolloutCohort: "runtime-host-macos",
    };
  }
  const modelId = args.route?.personaConfig?.modelId ?? args.modelId;
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
    requestedPlacement: localAttempt ? "local" : "cloud",
    initialAttempt: localAttempt ?? {
          executorKind: "convex_workflow",
          placement: "cloud",
          adapterId: "convex-workflow",
          provider: modelId?.split("/")[0],
          modelId,
          orchestrationEngine: "convex_workflow",
          orchestrationVersion: "m47.v1",
          rolloutCohort: "workflow-default",
        },
    now: args.now,
  });
  if (modelId && args.route?.personaConfig) {
    const job = await ctx.db.get(args.jobId);
    if (job) {
      await ctx.db.patch(job._id, { modelId });
      await ctx.db.patch(job.messageId, {
        modelId, participantName: args.route.personaConfig.displayName,
      });
    }
  }
  await ctx.db.patch(args.jobId, {
    effectivePersonaConfig: args.route?.personaConfig,
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
  const route = await resolveGenerationExecutionRoute(ctx, {
    userId: job.userId,
    chatParticipantId: job.chatParticipantId,
    now,
    allowOfflineWait: !job.sourceJobId,
  });
  return await createGenerationExecution(ctx, {
    jobId,
    userId: job.userId,
    chatId: job.chatId,
    sourceMessageId: job.messageId,
    modelId: job.modelId,
    route,
    parentRunId,
    now,
  });
}

export async function resolveGenerationExecutionRoute(
  ctx: MutationCtx,
  args: {
    userId: string;
    chatParticipantId?: Id<"chatParticipants">;
    personaId?: Id<"personas"> | null;
    now: number;
    allowOfflineWait?: boolean;
  },
) {
  const route = args.chatParticipantId
    ? await resolveEffectiveParticipantRoute(ctx, {
        userId: args.userId,
        chatParticipantId: args.chatParticipantId,
        personaId: args.personaId,
        now: args.now,
      })
    : null;
  if (route?.availability === "persona_unavailable") {
    throw new ConvexError({ code: "PERSONA_UNAVAILABLE", message: "This Persona is no longer available. Choose an available Persona before starting another turn." });
  }
  if (route?.placement === "local" && route.availability !== "ready"
    && !(args.allowOfflineWait && route.availability === "device_offline")) {
    throw new ConvexError({
      code: "RUNTIME_UNAVAILABLE",
      message: route.deviceName
        ? `${route.deviceName} cannot run this Persona right now (${route.availability})`
        : `The selected Runtime Host cannot run this Persona right now (${route.availability})`,
    });
  }
  return route;
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
  options?: { allowCancelling?: boolean; allowDeletingOwner?: boolean; allowExpiredLease?: boolean },
): Promise<{ run: Doc<"executionRuns">; attempt: Doc<"executionAttempts"> }> {
  return await assertCurrentExecution(ctx, { attemptId, fence, ...options });
}

export async function appendExecutionEvent(
  ctx: MutationCtx,
  args: {
    attemptId: Id<"executionAttempts">;
    fence: number;
    claimantId?: string;
    allowExpiredLease?: boolean;
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
    allowCancelling?: boolean;
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
