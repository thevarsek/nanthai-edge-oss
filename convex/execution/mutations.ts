import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { requestExecutionCancellation } from "./cancellation";
import {
  appendExecutionEvent,
  assertCurrentFence,
  claimGenerationExecution,
  heartbeatExecution,
  releaseExecutionForContinuation,
  terminalizeExecution,
  ensureGenerationExecution,
} from "./control_plane";
import { claimExecutionRun } from "./attempts";
import { createExecutionAttempt } from "./attempt_creation";
import { linkExecutionComponent } from "./component_refs";
import { createExecutionRun } from "./runs";
import {
  executionPlacement,
  executionRunKind,
  executorKind,
  runEventType,
} from "./validators";

const claimedExecution = v.object({
  runId: v.id("executionRuns"),
  attemptId: v.id("executionAttempts"),
  fence: v.number(),
  leaseExpiresAt: v.number(),
});

export const createRun = internalMutation({
  args: {
    userId: v.string(),
    runKey: v.optional(v.string()),
    kind: executionRunKind,
    requestedPlacement: executionPlacement,
    chatId: v.optional(v.id("chats")),
    sourceMessageId: v.optional(v.id("messages")),
    generationJobId: v.optional(v.id("generationJobs")),
    domainType: v.optional(v.string()),
    domainId: v.optional(v.string()),
    parentRunId: v.optional(v.id("executionRuns")),
    initialAttempt: v.object({
      executorKind,
      placement: executionPlacement,
      adapterId: v.string(),
      adapterVersion: v.optional(v.string()),
      provider: v.optional(v.string()),
      modelId: v.optional(v.string()),
      runtimeLabel: v.optional(v.string()),
      deviceId: v.optional(v.string()),
      workspaceId: v.optional(v.string()),
      protocolVersion: v.optional(v.string()),
    }),
  },
  returns: claimedExecution,
  handler: async (ctx, args) => await createExecutionRun(ctx, args),
});

export const claimRun = internalMutation({
  args: {
    runId: v.id("executionRuns"),
    claimantId: v.string(),
    leaseMs: v.optional(v.number()),
  },
  returns: v.union(claimedExecution, v.null()),
  handler: async (ctx, args) => await claimExecutionRun(ctx, args),
});

export const createAttempt = internalMutation({
  args: {
    runId: v.id("executionRuns"),
    claimantId: v.optional(v.string()),
    leaseMs: v.optional(v.number()),
    checkpointRef: v.optional(v.string()),
    attempt: v.object({
      executorKind,
      placement: executionPlacement,
      adapterId: v.string(),
      adapterVersion: v.optional(v.string()),
      provider: v.optional(v.string()),
      modelId: v.optional(v.string()),
      runtimeLabel: v.optional(v.string()),
      deviceId: v.optional(v.string()),
      workspaceId: v.optional(v.string()),
      protocolVersion: v.optional(v.string()),
    }),
  },
  returns: claimedExecution,
  handler: async (ctx, args) => await createExecutionAttempt(ctx, args),
});

export const ensureGeneration = internalMutation({
  args: { jobId: v.id("generationJobs") },
  returns: v.union(claimedExecution, v.null()),
  handler: async (ctx, args) => await ensureGenerationExecution(ctx, args.jobId),
});

export const claimGeneration = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    claimantId: v.string(),
    leaseMs: v.optional(v.number()),
    expectedAttemptId: v.optional(v.id("executionAttempts")),
    expectedFence: v.optional(v.number()),
  },
  returns: v.union(claimedExecution, v.null()),
  handler: async (ctx, args) => await claimGenerationExecution(ctx, args),
});

export const validateFence = internalMutation({
  args: {
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await assertCurrentFence(ctx, args.attemptId, args.fence);
    return true;
  },
});

export const heartbeat = internalMutation({
  args: {
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    claimantId: v.optional(v.string()),
    leaseMs: v.optional(v.number()),
  },
  returns: v.number(),
  handler: async (ctx, args) => await heartbeatExecution(ctx, args),
});

export const releaseForContinuation = internalMutation({
  args: {
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    claimantId: v.optional(v.string()),
    checkpointRef: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await releaseExecutionForContinuation(ctx, args);
    return null;
  },
});

export const appendEvent = internalMutation({
  args: {
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    claimantId: v.optional(v.string()),
    type: runEventType,
    summary: v.string(),
    phase: v.optional(v.string()),
    progress: v.optional(v.number()),
    artifactIds: v.optional(v.array(v.string())),
    privacyClass: v.optional(v.string()),
    adapterDetail: v.optional(v.string()),
    eventId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await appendExecutionEvent(ctx, args);
    return null;
  },
});

export const requestCancellation = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    requestedBy: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => await requestExecutionCancellation(ctx, args),
});

export const linkWorkflow = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    workflowId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job?.executionRunId || !job.executionAttemptId || job.executionFence === undefined) {
      throw new Error("GENERATION_EXECUTION_NOT_FOUND");
    }
    await ctx.db.patch(job.executionAttemptId, {
      componentOperationId: args.workflowId,
      updatedAt: Date.now(),
    });
    await linkExecutionComponent(ctx, {
      runId: job.executionRunId,
      attemptId: job.executionAttemptId,
      fence: job.executionFence,
      adapterId: "convex-workflow",
      operationId: args.workflowId,
      role: "generation-workflow",
    });
    return null;
  },
});

export const terminalize = internalMutation({
  args: {
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    claimantId: v.optional(v.string()),
    outcome: v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("interrupted"),
    ),
    summary: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await terminalizeExecution(ctx, args);
    return null;
  },
});
