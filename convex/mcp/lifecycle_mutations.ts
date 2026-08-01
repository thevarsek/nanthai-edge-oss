import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { requestRunTreeTeardown } from "../execution/teardown_graph";
import { completeDeferredToolHandler } from "../chat/workflow_resume_handlers";
import { saveGenerationContinuationArgs } from "../chat/mutations_args";
import {
  saveGenerationContinuationHandler,
  type SaveGenerationContinuationArgs,
} from "../chat/mutations_generation_continuation_handlers";
import {
  executionForMcpInvocation,
  markMcpExecutionWaitingForInput,
  restoreMcpExecutionWaiting,
  resumeMcpExecutionForInvocation,
  startMcpTaskWorkflow,
} from "./execution_waiting";

export const bindDeferredInvocationArgs = {
  userId: v.string(),
  publicId: v.string(),
  jobId: v.id("generationJobs"),
  toolCallId: v.string(),
  parentResumeEventId: v.string(),
};

export async function bindDeferredInvocationHandler(
  ctx: MutationCtx,
  args: {
    userId: string;
    publicId: string;
    jobId: Id<"generationJobs">;
    toolCallId: string;
    parentResumeEventId: string;
  },
): Promise<null> {
    const invocation = await ctx.db
      .query("mcpInvocations")
      .withIndex("by_user_public_id", (q) =>
        q.eq("userId", args.userId).eq("publicId", args.publicId),
      )
      .unique();
    if (!invocation || invocation.generationJobId !== args.jobId) {
      throw new Error("MCP_DEFERRED_INVOCATION_MISMATCH");
    }
    if (invocation.state !== "awaiting_input" && invocation.state !== "task_pending") {
      throw new Error("MCP_DEFERRED_INVOCATION_NOT_PENDING");
    }
    if (invocation.toolCallId && invocation.toolCallId !== args.toolCallId) {
      throw new Error("MCP_DEFERRED_TOOL_CALL_MISMATCH");
    }
    await ctx.db.patch(invocation._id, {
      toolCallId: args.toolCallId,
      parentResumeEventId: args.parentResumeEventId,
      updatedAt: Date.now(),
    });
    const execution = await executionForMcpInvocation(ctx, invocation);
    if (invocation.state === "awaiting_input") {
      await markMcpExecutionWaitingForInput(ctx, execution);
      return null;
    }
    await startMcpTaskWorkflow(ctx, invocation, execution);
    return null;
}

export const bindDeferredInvocation = internalMutation({
  args: bindDeferredInvocationArgs,
  returns: v.null(),
  handler: bindDeferredInvocationHandler,
});

export const saveCheckpointAndBindInvocation = internalMutation({
  args: {
    ...saveGenerationContinuationArgs,
    publicId: bindDeferredInvocationArgs.publicId,
    toolCallId: bindDeferredInvocationArgs.toolCallId,
    parentResumeEventId: bindDeferredInvocationArgs.parentResumeEventId,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await saveGenerationContinuationHandler(ctx, args as SaveGenerationContinuationArgs);
    await bindDeferredInvocationHandler(ctx, args);
    return null;
  },
});

export const startStandaloneInvocation = internalMutation({
  args: { userId: v.string(), publicId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invocation = await ctx.db
      .query("mcpInvocations")
      .withIndex("by_user_public_id", (q) =>
        q.eq("userId", args.userId).eq("publicId", args.publicId),
      )
      .unique();
    if (!invocation) throw new Error("MCP_INVOCATION_NOT_FOUND");
    if (invocation.state !== "awaiting_input" && invocation.state !== "task_pending") {
      return null;
    }
    const execution = await executionForMcpInvocation(ctx, invocation);
    if (invocation.state === "awaiting_input") {
      await markMcpExecutionWaitingForInput(ctx, execution);
    } else {
      await startMcpTaskWorkflow(ctx, invocation, execution);
    }
    return null;
  },
});

export const markTaskWaitingForInput = internalMutation({
  args: {
    invocationId: v.id("mcpInvocations"),
    execution: v.object({
      runId: v.id("executionRuns"),
      attemptId: v.id("executionAttempts"),
      fence: v.number(),
      claimantId: v.string(),
    }),
    eventId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const invocation = await ctx.db.get(args.invocationId);
    if (!invocation || invocation.durableRunId !== args.execution.runId) {
      throw new Error("MCP_TASK_EXECUTION_MISMATCH");
    }
    if (invocation.state !== "awaiting_input") return false;
    await ctx.db.patch(invocation._id, {
      taskResumeEventId: args.eventId,
      updatedAt: Date.now(),
    });
    await markMcpExecutionWaitingForInput(ctx, args.execution);
    return true;
  },
});

export const resumeInvocationOperation = internalMutation({
  args: {
    userId: v.string(),
    invocationId: v.id("mcpInvocations"),
    operationKey: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const invocation = await ctx.db.get(args.invocationId);
    if (
      !invocation
      || invocation.userId !== args.userId
      || invocation.state !== "dispatching"
      || invocation.activeOperationKey !== args.operationKey
    ) return false;
    return await resumeMcpExecutionForInvocation(ctx, invocation);
  },
});

export const releaseTaskOperation = internalMutation({
  args: {
    userId: v.string(),
    invocationId: v.id("mcpInvocations"),
    operationKey: v.string(),
    state: v.union(v.literal("awaiting_input"), v.literal("task_pending")),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const invocation = await ctx.db.get(args.invocationId);
    if (
      !invocation
      || invocation.userId !== args.userId
      || invocation.state !== "dispatching"
      || invocation.activeOperationKey !== args.operationKey
    ) return false;
    await ctx.db.patch(invocation._id, {
      state: args.state,
      activeOperationKey: undefined,
      updatedAt: Date.now(),
    });
    if (args.state === "awaiting_input" && invocation.taskResumeEventId) {
      await restoreMcpExecutionWaiting(ctx, invocation);
    }
    return true;
  },
});

export const restoreTaskInputWait = internalMutation({
  args: {
    userId: v.string(),
    invocationId: v.id("mcpInvocations"),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const invocation = await ctx.db.get(args.invocationId);
    if (
      !invocation
      || invocation.userId !== args.userId
      || invocation.state !== "awaiting_input"
      || !invocation.taskResumeEventId
    ) return false;
    await restoreMcpExecutionWaiting(ctx, invocation);
    return true;
  },
});

export const cancelConnectionInvocations = internalMutation({
  args: {
    userId: v.string(),
    connectionId: v.id("mcpConnections"),
    reason: v.string(),
    scheduleRemainder: v.optional(v.boolean()),
    deleteConnectionAfter: v.optional(v.boolean()),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const batchSize = 50;
    const pendingStates = ["dispatching", "awaiting_input", "task_pending"] as const;
    const invocations = [];
    for (const state of pendingStates) {
      const remaining: number = batchSize - invocations.length;
      if (remaining <= 0) break;
      invocations.push(...await ctx.db
        .query("mcpInvocations")
        .withIndex("by_connection_state", (q) => q
          .eq("connectionId", args.connectionId)
          .eq("state", state))
        .take(remaining));
    }
    let cancelled = 0;
    for (const invocation of invocations) {
      await ctx.db.patch(invocation._id, {
        state: "cancelled",
        errorCode: "MCP_CONNECTION_UNAVAILABLE",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      if (invocation.parentResumeEventId && invocation.generationJobId && invocation.toolCallId) {
        await completeDeferredToolHandler(ctx, {
          jobId: invocation.generationJobId,
          userId: args.userId,
          toolCallId: invocation.toolCallId,
          toolName: invocation.toolAlias ?? "remote_mcp",
          result: JSON.stringify({ error: args.reason, state: "cancelled" }),
          isError: true,
          eventId: invocation.parentResumeEventId,
        });
      }
      if (invocation.durableRunId) {
        await requestRunTreeTeardown(ctx, invocation.durableRunId, "remote_mcp", args.reason);
        await ctx.scheduler.runAfter(0, internal.execution.teardown.cancelRunTree, {
          runId: invocation.durableRunId,
          requestedBy: "remote_mcp",
          reason: args.reason,
        });
      }
      cancelled += 1;
    }
    if (cancelled === batchSize && args.scheduleRemainder !== false) {
      await ctx.scheduler.runAfter(0, internal.mcp.lifecycle_mutations.cancelConnectionInvocations, {
        ...args,
        scheduleRemainder: true,
      });
    } else if (args.deleteConnectionAfter) {
      await ctx.scheduler.runAfter(0, internal.mcp.mutations.deleteConnectionData, {
        userId: args.userId,
        connectionId: args.connectionId,
      });
    }
    return cancelled;
  },
});
