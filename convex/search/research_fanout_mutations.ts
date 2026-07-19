import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { DataModel, Id } from "../_generated/dataModel";
import type { WorkflowId } from "@convex-dev/workflow";
import { durableWorkflow, interactiveWorkpool } from "../execution/components";
import {
  heartbeatResearchSession,
  isCurrentResearchExecution,
  linkResearchWorkpoolOperation,
} from "./execution_lifecycle";
import { researchSearchBatchTerminalEventName } from "./research_fanout_queries";
import { terminalizeExecutionComponentByOperation } from "../execution/component_refs";
import { scheduleWorkpoolCompletionWatchdog } from
  "../execution/workpool_watchdog_schedule";

const phaseType = v.union(
  v.literal("initial_search"),
  v.literal("depth_iteration"),
);
const completeContext = v.object({
  taskId: v.id("researchSearchTasks"),
  batchId: v.id("researchSearchBatches"),
  executionAttemptId: v.optional(v.id("executionAttempts")),
  executionFence: v.optional(v.number()),
});

export const completeResearchSearchTask = interactiveWorkpool.defineOnComplete<
  DataModel,
  typeof completeContext
>({
  context: completeContext,
  handler: async (ctx, args) => {
    await terminalizeExecutionComponentByOperation(
      ctx,
      "interactive-workpool",
      String(args.workId),
      args.result.kind === "success"
        ? "completed"
        : args.result.kind === "canceled" ? "cancelled" : "failed",
    );
    await completeResearchSearchTaskHandler(ctx, {
      taskId: args.context.taskId as Id<"researchSearchTasks">,
      batchId: args.context.batchId as Id<"researchSearchBatches">,
      executionAttemptId: args.context.executionAttemptId,
      executionFence: args.context.executionFence,
      result: args.result.kind === "success"
        ? { kind: "success", returnValue: args.result.returnValue }
        : args.result.kind === "canceled"
          ? { kind: "canceled" }
          : { kind: "failed", error: args.result.error },
    });
  },
});

type ResearchTaskResult =
  | { kind: "success"; returnValue: unknown }
  | { kind: "failed"; error: string }
  | { kind: "canceled" };

export async function completeResearchSearchTaskHandler(
  ctx: MutationCtx,
  args: {
    taskId: Id<"researchSearchTasks">;
    batchId: Id<"researchSearchBatches">;
    executionAttemptId?: Id<"executionAttempts">;
    executionFence?: number;
    result: ResearchTaskResult;
  },
): Promise<void> {
    const taskId = args.taskId;
    const batchId = args.batchId;
    const task = await ctx.db.get(taskId);
    const batch = await ctx.db.get(batchId);
    if (!task || !batch || task.status !== "queued") return;
    const session = await ctx.db.get(batch.sessionId);
    const now = Date.now();
    const current = session
      ? await isCurrentResearchExecution(ctx, session, args)
      : false;
    if (!current) {
      await ctx.db.patch(task._id, {
        status: "cancelled",
        error: "Research execution was cancelled or superseded",
        completedAt: now,
      });
    } else if (session) {
      await heartbeatResearchSession(ctx, session);
    }
    if (current && args.result.kind === "success") {
      const value = args.result.returnValue as {
        success?: boolean;
        error?: string;
      };
      await ctx.db.patch(task._id, {
        status: value.success === false ? "failed" : "completed",
        result: args.result.returnValue,
        error: value.success === false ? value.error : undefined,
        completedAt: now,
      });
    } else if (current) {
      await ctx.db.patch(task._id, {
        status: args.result.kind === "canceled" ? "cancelled" : "failed",
        error: args.result.kind === "failed" ? args.result.error : "Cancelled",
        completedAt: now,
      });
    }
    const tasks = await ctx.db
      .query("researchSearchTasks")
      .withIndex("by_batch", (query) => query.eq("batchId", batch._id))
      .collect();
    const terminalTasks = tasks.filter((item) => item.status !== "queued");
    const failedTasks = terminalTasks.filter(
      (item) => item.status !== "completed",
    );
    const allTerminal = terminalTasks.length === batch.expectedCount;
    await ctx.db.patch(batch._id, {
      terminalCount: terminalTasks.length,
      failedCount: failedTasks.length,
      status:
        allTerminal ? "completed" : "running",
      completedAt:
        allTerminal ? now : undefined,
    });
    if (allTerminal && current && session?.workflowId) {
      await durableWorkflow.sendEvent(ctx, {
        workflowId: session.workflowId as WorkflowId,
        name: researchSearchBatchTerminalEventName(String(batch._id)),
      });
    }
}

export const recordResearchSearchTaskResult = internalMutation({
  args: {
    taskId: v.id("researchSearchTasks"),
    batchId: v.id("researchSearchBatches"),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    result: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await completeResearchSearchTaskHandler(ctx, {
      ...args,
      result: { kind: "success", returnValue: args.result },
    });
    return null;
  },
});

export const dispatchResearchSearchBatch = internalMutation({
  args: {
    sessionId: v.id("searchSessions"),
    userId: v.string(),
    phaseOrder: v.number(),
    phaseType,
    iteration: v.optional(v.number()),
    queries: v.array(v.string()),
    searchModel: v.string(),
    maxTokens: v.number(),
    requireZdr: v.boolean(),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  },
  returns: v.id("researchSearchBatches"),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || !await isCurrentResearchExecution(ctx, session, args)) {
      throw new Error("RESEARCH_EXECUTION_STALE");
    }
    const existing = await ctx.db
      .query("researchSearchBatches")
      .withIndex("by_session_phase", (query) =>
        query.eq("sessionId", args.sessionId).eq("phaseOrder", args.phaseOrder),
      )
      .unique();
    if (existing) return existing._id;

    const now = Date.now();
    const batchId = await ctx.db.insert("researchSearchBatches", {
      sessionId: args.sessionId,
      phaseOrder: args.phaseOrder,
      phaseType: args.phaseType,
      iteration: args.iteration,
      searchModel: args.searchModel,
      maxTokens: args.maxTokens,
      requireZdr: args.requireZdr,
      status: args.queries.length === 0 ? "completed" : "queued",
      expectedCount: args.queries.length,
      terminalCount: 0,
      failedCount: 0,
      workpoolOperationIds: [],
      createdAt: now,
      completedAt: args.queries.length === 0 ? now : undefined,
    });
    const workpoolOperationIds: string[] = [];
    for (const [queryIndex, query] of args.queries.entries()) {
      const taskId = await ctx.db.insert("researchSearchTasks", {
        batchId,
        sessionId: args.sessionId,
        queryIndex,
        query,
        status: "queued",
        createdAt: now,
      });
      const workId = await interactiveWorkpool.enqueueAction(
        ctx,
        internal.search.research_fanout_actions.runResearchSearchQuery,
        {
          taskId,
          batchId,
          userId: args.userId,
          query,
          searchModel: args.searchModel,
          maxTokens: args.maxTokens,
          requireZdr: args.requireZdr,
          sessionId: args.sessionId,
          executionAttemptId: args.executionAttemptId,
          executionFence: args.executionFence,
        },
        {
          retry: false,
          name: "research-search-query",
          onComplete:
            internal.search.research_fanout_mutations
              .completeResearchSearchTask,
          context: {
            taskId,
            batchId,
            executionAttemptId: args.executionAttemptId,
            executionFence: args.executionFence,
          },
        },
      );
      workpoolOperationIds.push(workId);
      await ctx.db.patch(taskId, { workpoolOperationId: workId });
      await linkResearchWorkpoolOperation(
        ctx,
        args.sessionId,
        workId,
        `research-search-query:${args.phaseOrder}:${queryIndex}`,
      );
      await scheduleWorkpoolCompletionWatchdog(ctx, {
        kind: "research_search",
        operationId: String(workId),
        taskId,
        batchId,
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
      });
    }
    if (workpoolOperationIds.length > 0) {
      await ctx.db.patch(batchId, { status: "running", workpoolOperationIds });
    }
    return batchId;
  },
});
