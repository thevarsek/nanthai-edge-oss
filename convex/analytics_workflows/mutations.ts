import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { claimExecutionRun } from "../execution/attempts";
import { heartbeatExecution, terminalizeExecution } from "../execution/control_plane";
import { linkExecutionComponent } from "../execution/component_refs";
import { createExecutionRun } from "../execution/runs";
import { durableWorkflow } from "../execution/components";
import { boundedAnalyticsTimeout } from "./limits";
import { ownedWorkflowCompletionRef } from "../execution/workflow_lifecycle";
import { scheduleOwnedWorkflowWatchdog } from
  "../execution/owned_workflow_watchdog";

const inputFile = v.object({ storageId: v.string(), filename: v.optional(v.string()) });
const toolName = v.union(v.literal("data_python_exec"), v.literal("data_python_sandbox"));

export const prepareRun = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    userMessageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    toolCallId: v.string(),
    toolName,
    code: v.string(),
    inputFiles: v.array(inputFile),
    exportPaths: v.array(v.string()),
    captureCharts: v.boolean(),
    packages: v.array(v.string()),
    timeoutMs: v.optional(v.number()),
  },
  returns: v.id("analyticsWorkflowRuns"),
  handler: async (ctx, args): Promise<Id<"analyticsWorkflowRuns">> => {
    const existing = await ctx.db
      .query("analyticsWorkflowRuns")
      .withIndex("by_operation", (q) => q.eq("jobId", args.jobId).eq("toolCallId", args.toolCallId))
      .unique();
    if (existing) return existing._id;
    const job = await ctx.db.get(args.jobId);
    if (!job || job.userId !== args.userId || job.chatId !== args.chatId) {
      throw new Error("ANALYTICS_PARENT_NOT_FOUND");
    }
    const execution = await createExecutionRun(ctx, {
      userId: args.userId,
      runKey: `analytics:${String(args.jobId)}:${args.toolCallId}`,
      kind: "analytics",
      requestedPlacement: "cloud",
      chatId: args.chatId,
      sourceMessageId: args.userMessageId,
      generationJobId: args.jobId,
      domainType: "analytics_tool",
      domainId: args.toolCallId,
      parentRunId: job.executionRunId,
      initialAttempt: {
        executorKind: "convex_workflow",
        placement: "cloud",
        adapterId: "convex-workflow",
        runtimeLabel: args.toolName === "data_python_exec" ? "pyodide" : "vercel-sandbox",
      },
    });
    const now = Date.now();
    return await ctx.db.insert("analyticsWorkflowRuns", {
      ...args,
      timeoutMs: boundedAnalyticsTimeout(args.toolName, args.timeoutMs),
      artifactKey: `${String(args.jobId)}:${args.toolCallId}`,
      status: "prepared",
      phase: "prepare",
      executionRunId: execution.runId,
      executionAttemptId: execution.attemptId,
      executionFence: execution.fence,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export async function startAnalyticsRunHandler(
  ctx: MutationCtx,
  args: { analyticsRunId: Id<"analyticsWorkflowRuns">; eventId: string },
): Promise<string> {
    const run = await ctx.db.get(args.analyticsRunId);
    if (!run) throw new Error("ANALYTICS_RUN_NOT_FOUND");
    if (run.workflowId) return run.workflowId;
    if (run.status !== "prepared") throw new Error("ANALYTICS_RUN_NOT_STARTABLE");
    const claimantId = `analytics-workflow:${String(run._id)}`;
    const execution = await claimExecutionRun(ctx, {
      runId: run.executionRunId,
      claimantId,
      leaseMs: 12 * 60 * 1000,
    });
    if (!execution) throw new Error("ANALYTICS_EXECUTION_NOT_CLAIMABLE");
    const workflowId: string = await durableWorkflow.start(
      ctx,
      internal.analytics_workflows.workflow.runAnalyticsWorkflow,
      { analyticsRunId: run._id, claimantId },
      { startAsync: true, onComplete: ownedWorkflowCompletionRef, context: {} },
    );
    await ctx.db.patch(run._id, {
      workflowId,
      parentEventId: args.eventId,
      claimantId,
      status: "running",
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    await ctx.db.patch(execution.attemptId, { componentOperationId: workflowId, updatedAt: Date.now() });
    await linkExecutionComponent(ctx, {
      runId: execution.runId,
      attemptId: execution.attemptId,
      fence: execution.fence,
      adapterId: "convex-workflow",
      operationId: workflowId,
      role: "analytics-workflow",
    });
    await scheduleOwnedWorkflowWatchdog(ctx, { workflowId, context: {} });
    return workflowId;
}

export const startRun = internalMutation({
  args: { analyticsRunId: v.id("analyticsWorkflowRuns"), eventId: v.string() },
  returns: v.string(),
  handler: startAnalyticsRunHandler,
});

export const rebindParentEvent = internalMutation({
  args: {
    jobId: v.id("generationJobs"),
    userId: v.string(),
    toolCallId: v.string(),
    expectedEventId: v.string(),
    nextEventId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("analyticsWorkflowRuns")
      .withIndex("by_operation", (query) =>
        query.eq("jobId", args.jobId).eq("toolCallId", args.toolCallId)
      )
      .unique();
    if (
      !run ||
      run.userId !== args.userId ||
      run.parentEventId !== args.expectedEventId
    ) return false;
    await ctx.db.patch(run._id, {
      parentEventId: args.nextEventId,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const setPhase = internalMutation({
  args: {
    analyticsRunId: v.id("analyticsWorkflowRuns"),
    phase: v.string(),
    claimantId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.analyticsRunId);
    if (!run || run.status === "cancelled") return null;
    await heartbeatExecution(ctx, {
      attemptId: run.executionAttemptId,
      fence: run.executionFence,
      claimantId: args.claimantId,
      leaseMs: 12 * 60 * 1000,
    });
    await ctx.db.patch(run._id, { phase: args.phase, updatedAt: Date.now() });
    return null;
  },
});

export const storeResult = internalMutation({
  args: {
    analyticsRunId: v.id("analyticsWorkflowRuns"),
    resultJson: v.optional(v.string()),
    resultStorageId: v.optional(v.id("_storage")),
    resultBytes: v.number(),
    error: v.optional(v.string()),
    claimantId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.analyticsRunId);
    if (!run || run.status === "cancelled" || run.status === "completed" || run.status === "failed") {
      return null;
    }
    await heartbeatExecution(ctx, {
      attemptId: run.executionAttemptId,
      fence: run.executionFence,
      claimantId: args.claimantId,
      leaseMs: 12 * 60 * 1000,
    });
    await ctx.db.patch(run._id, {
      resultJson: args.resultJson,
      resultStorageId: args.resultStorageId,
      resultBytes: args.resultBytes,
      error: args.error,
      status: args.error ? "failed" : "running",
      phase: args.error ? "failed" : "collect",
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const storeEnvelope = internalMutation({
  args: {
    analyticsRunId: v.id("analyticsWorkflowRuns"),
    claimantId: v.string(),
    storageId: v.id("_storage"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.analyticsRunId);
    if (!run || run.status !== "running") return false;
    await heartbeatExecution(ctx, {
      attemptId: run.executionAttemptId,
      fence: run.executionFence,
      claimantId: args.claimantId,
      leaseMs: 12 * 60 * 1000,
    });
    if (run.executionEnvelopeStorageId) return false;
    await ctx.db.patch(run._id, {
      executionEnvelopeStorageId: args.storageId,
      phase: "collect",
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const finishExecution = internalMutation({
  args: {
    analyticsRunId: v.id("analyticsWorkflowRuns"),
    claimantId: v.string(),
    outcome: v.union(v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.analyticsRunId);
    if (!run) return null;
    await terminalizeExecution(ctx, {
      attemptId: run.executionAttemptId,
      fence: run.executionFence,
      claimantId: args.claimantId,
      outcome: args.outcome,
      summary: args.outcome === "completed" ? "Analytics artifacts attached" : run.error ?? args.outcome,
    });
    if (run.executionEnvelopeStorageId) {
      await ctx.storage.delete(run.executionEnvelopeStorageId).catch(() => undefined);
    }
    await ctx.db.patch(run._id, {
      status: args.outcome,
      phase: args.outcome,
      executionEnvelopeStorageId: undefined,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return null;
  },
});
