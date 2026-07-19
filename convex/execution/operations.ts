import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { assertCurrentFence } from "./control_plane";
import {
  authorizationSource,
  toolEffect,
  toolRetryPolicy,
  type AuthorizationSource,
  type ToolEffect,
  type ToolRetryPolicy,
} from "./validators";

const operationDecision = v.union(
  v.object({ decision: v.literal("execute"), operationId: v.id("executionOperations") }),
  v.object({ decision: v.literal("replay"), resultJson: v.string() }),
  v.object({ decision: v.literal("refuse"), reason: v.string() }),
);

export const prepare = internalMutation({
  args: {
    jobId: v.optional(v.id("generationJobs")),
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    operationKey: v.string(),
    toolName: v.string(),
    toolCallId: v.string(),
    effect: toolEffect,
    retry: toolRetryPolicy,
    authorizationSource,
    inputHash: v.string(),
  },
  returns: operationDecision,
  handler: prepareOperationHandler,
});

export async function prepareOperationHandler(
  ctx: MutationCtx,
  args: {
    jobId?: Id<"generationJobs">;
    attemptId: Id<"executionAttempts">;
    fence: number;
    operationKey: string;
    toolName: string;
    toolCallId: string;
    effect: ToolEffect;
    retry: ToolRetryPolicy;
    authorizationSource: AuthorizationSource;
    inputHash: string;
  },
) {
    const { run } = await assertCurrentFence(ctx, args.attemptId, args.fence);
    if (args.jobId !== undefined && run.generationJobId !== args.jobId) {
      throw new Error("EXECUTION_JOB_MISMATCH");
    }
    const existing = await ctx.db
      .query("executionOperations")
      .withIndex("by_run_operation", (query) =>
        query.eq("runId", run._id).eq("operationKey", args.operationKey),
      )
      .unique();
    if (existing) {
      if (
        existing.inputHash !== args.inputHash
        || existing.toolName !== args.toolName
        || existing.effect !== args.effect
        || existing.retry !== args.retry
        || existing.authorizationSource !== args.authorizationSource
      ) {
        return {
          decision: "refuse" as const,
          reason: "Operation identity or immutable effect policy did not match the recorded operation.",
        };
      }
      if (
        (existing.status === "succeeded" || existing.status === "reconciled")
        && existing.resultJson
      ) {
        return { decision: "replay" as const, resultJson: existing.resultJson };
      }
      if (existing.status === "outcome_unknown") {
        return {
          decision: "refuse" as const,
          reason: "The previous dispatch has an unknown outcome and must be reconciled before retry.",
        };
      }
      if (existing.status !== "prepared" && existing.retry !== "safe") {
        return {
          decision: "refuse" as const,
          reason: "The previous side-effecting call may have been dispatched; automatic replay was blocked.",
        };
      }
      await ctx.db.patch(existing._id, {
        attemptId: args.attemptId,
        toolCallId: args.toolCallId,
        status: "prepared",
        updatedAt: Date.now(),
      });
      return { decision: "execute" as const, operationId: existing._id };
    }
    const now = Date.now();
    const operationId = await ctx.db.insert("executionOperations", {
      runId: run._id,
      attemptId: args.attemptId,
      userId: run.userId,
      operationKey: args.operationKey,
      toolName: args.toolName,
      toolCallId: args.toolCallId,
      effect: args.effect,
      retry: args.retry,
      authorizationSource: args.authorizationSource,
      status: "prepared",
      inputHash: args.inputHash,
      createdAt: now,
      updatedAt: now,
    });
    return { decision: "execute" as const, operationId };
}

export const markDispatched = internalMutation({
  args: {
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    operationKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { run } = await assertCurrentFence(ctx, args.attemptId, args.fence);
    const operation = await ctx.db
      .query("executionOperations")
      .withIndex("by_run_operation", (query) =>
        query.eq("runId", run._id).eq("operationKey", args.operationKey),
      )
      .unique();
    if (!operation) throw new Error("EXECUTION_OPERATION_NOT_FOUND");
    if (operation.status === "succeeded" || operation.status === "reconciled") return null;
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "dispatching",
      dispatchedAt: operation.dispatchedAt ?? now,
      updatedAt: now,
    });
    return null;
  },
});

export const complete = internalMutation({
  args: {
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    operationKey: v.string(),
    externalId: v.optional(v.string()),
    resultJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { run } = await assertCurrentFence(ctx, args.attemptId, args.fence);
    const operation = await ctx.db
      .query("executionOperations")
      .withIndex("by_run_operation", (query) =>
        query.eq("runId", run._id).eq("operationKey", args.operationKey),
      )
      .unique();
    if (!operation) throw new Error("EXECUTION_OPERATION_NOT_FOUND");
    if (operation.status === "succeeded" || operation.status === "reconciled") return null;
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "succeeded",
      externalId: args.externalId?.slice(0, 2_000),
      resultJson: args.resultJson.slice(0, 900_000),
      completedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const resetSafeFailure = internalMutation({
  args: {
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    operationKey: v.string(),
    errorSummary: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { run } = await assertCurrentFence(ctx, args.attemptId, args.fence);
    const operation = await ctx.db
      .query("executionOperations")
      .withIndex("by_run_operation", (query) =>
        query.eq("runId", run._id).eq("operationKey", args.operationKey),
      )
      .unique();
    if (!operation) throw new Error("EXECUTION_OPERATION_NOT_FOUND");
    if (operation.retry !== "safe") throw new Error("EXECUTION_OPERATION_NOT_SAFE");
    if (operation.status === "succeeded" || operation.status === "reconciled") return null;
    await ctx.db.patch(operation._id, {
      status: "prepared",
      errorSummary: args.errorSummary.slice(0, 2_000),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const recordObservedExternalOutcome = internalMutation({
  args: {
    attemptId: v.id("executionAttempts"),
    operationKey: v.string(),
    externalId: v.string(),
    resultJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    let operation = null;
    for (const status of ["dispatching", "outcome_unknown"] as const) {
      operation = await ctx.db
        .query("executionOperations")
        .withIndex("by_attempt_status", (query) =>
          query.eq("attemptId", args.attemptId).eq("status", status),
        )
        .filter((query) => query.eq(query.field("operationKey"), args.operationKey))
        .unique();
      if (operation) break;
    }
    if (!operation) return null;
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "reconciled",
      externalId: args.externalId.slice(0, 2_000),
      resultJson: args.resultJson.slice(0, 900_000),
      completedAt: now,
      updatedAt: now,
    });
    return null;
  },
});

export const markOutcomeUnknown = internalMutation({
  args: {
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    operationKey: v.string(),
    errorSummary: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { run } = await assertCurrentFence(ctx, args.attemptId, args.fence);
    const operation = await ctx.db
      .query("executionOperations")
      .withIndex("by_run_operation", (query) =>
        query.eq("runId", run._id).eq("operationKey", args.operationKey),
      )
      .unique();
    if (operation && operation.status !== "succeeded" && operation.status !== "reconciled") {
      await ctx.db.patch(operation._id, {
        status: "outcome_unknown",
        errorSummary: args.errorSummary.slice(0, 2_000),
        updatedAt: Date.now(),
      });
    }
    return null;
  },
});

export const reconcile = internalMutation({
  args: {
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    operationKey: v.string(),
    externalId: v.optional(v.string()),
    resultJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { run } = await assertCurrentFence(ctx, args.attemptId, args.fence);
    const operation = await ctx.db
      .query("executionOperations")
      .withIndex("by_run_operation", (query) =>
        query.eq("runId", run._id).eq("operationKey", args.operationKey),
      )
      .unique();
    if (!operation || operation.status !== "outcome_unknown") {
      throw new Error("EXECUTION_OPERATION_NOT_RECONCILABLE");
    }
    const now = Date.now();
    await ctx.db.patch(operation._id, {
      status: "reconciled",
      externalId: args.externalId?.slice(0, 2_000),
      resultJson: args.resultJson.slice(0, 900_000),
      completedAt: now,
      updatedAt: now,
    });
    return null;
  },
});
