import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertCurrentExecution } from "./attempts";
import {
  executionComponentAdapter,
  executionComponentStatus,
} from "./validators";
import { assertUserDataWritable } from "../lib/write_fence";

export async function linkExecutionComponent(
  ctx: MutationCtx,
  args: {
    runId: Id<"executionRuns">;
    attemptId?: Id<"executionAttempts">;
    fence?: number;
    adapterId: "convex-workflow" | "interactive-workpool" | "background-workpool"
      | "maintenance-workpool" | "external-cloud" | "local-runtime";
    operationId: string;
    role: string;
    now?: number;
  },
): Promise<Id<"executionComponentRefs">> {
  const run = await ctx.db.get(args.runId);
  if (!run) throw new Error("EXECUTION_RUN_NOT_FOUND");
  if ((args.attemptId === undefined) !== (args.fence === undefined)) {
    throw new Error("EXECUTION_COMPONENT_FENCE_REQUIRED");
  }
  if (args.attemptId && args.fence !== undefined) {
    const current = await assertCurrentExecution(ctx, {
      attemptId: args.attemptId,
      fence: args.fence,
    });
    if (current.run._id !== run._id) throw new Error("EXECUTION_COMPONENT_RUN_MISMATCH");
  } else {
    await assertUserDataWritable(ctx, run.userId, run.chatId);
    const rootRunId = run.rootRunId ?? run._id;
    const [rootTeardown, localTeardown] = await Promise.all([
      ctx.db
        .query("executionTeardownTasks")
        .withIndex("by_root_run", (q) => q
          .eq("rootRunId", rootRunId)
          .eq("runId", rootRunId))
        .unique(),
      ctx.db
        .query("executionTeardownTasks")
        .withIndex("by_root_run", (q) => q
          .eq("rootRunId", rootRunId)
          .eq("runId", run._id))
        .unique(),
    ]);
    if (rootTeardown || localTeardown) {
      throw new Error("EXECUTION_TEARDOWN_ALREADY_STARTED");
    }
  }
  const existing = await ctx.db
    .query("executionComponentRefs")
    .withIndex("by_operation", (q) =>
      q.eq("adapterId", args.adapterId).eq("operationId", args.operationId),
    )
    .unique();
  if (existing) {
    if (existing.runId !== run._id || existing.attemptId !== args.attemptId) {
      throw new Error("EXECUTION_COMPONENT_ALREADY_OWNED");
    }
    return existing._id;
  }
  const now = args.now ?? Date.now();
  return await ctx.db.insert("executionComponentRefs", {
    runId: run._id,
    attemptId: args.attemptId,
    userId: run.userId,
    adapterId: args.adapterId,
    operationId: args.operationId,
    role: args.role.slice(0, 200),
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

export const link = internalMutation({
  args: {
    runId: v.id("executionRuns"),
    attemptId: v.optional(v.id("executionAttempts")),
    fence: v.optional(v.number()),
    adapterId: executionComponentAdapter,
    operationId: v.string(),
    role: v.string(),
  },
  returns: v.id("executionComponentRefs"),
  handler: async (ctx, args) => await linkExecutionComponent(ctx, args),
});

export const rebindWorkflowAttempt = internalMutation({
  args: {
    workflowId: v.string(),
    runId: v.id("executionRuns"),
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    const current = await assertCurrentExecution(ctx, {
      attemptId: args.attemptId,
      fence: args.fence,
    });
    if (current.run._id !== args.runId) return false;
    const ref = await ctx.db
      .query("executionComponentRefs")
      .withIndex("by_operation", (query) => query
        .eq("adapterId", "convex-workflow")
        .eq("operationId", args.workflowId))
      .unique();
    if (!ref || ref.runId !== args.runId) return false;
    if (ref.status !== "active" && ref.status !== "cancel_requested") return false;
    if (ref.attemptId !== args.attemptId) {
      await ctx.db.patch(ref._id, {
        attemptId: args.attemptId,
        updatedAt: Date.now(),
      });
    }
    return true;
  },
});

export const terminalize = internalMutation({
  args: {
    componentRefId: v.id("executionComponentRefs"),
    status: v.union(
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
  },
  returns: executionComponentStatus,
  handler: async (ctx, args) => {
    const ref = await ctx.db.get(args.componentRefId);
    if (!ref) throw new Error("EXECUTION_COMPONENT_NOT_FOUND");
    if (["completed", "cancelled", "failed"].includes(ref.status)) return ref.status;
    const now = Date.now();
    await ctx.db.patch(ref._id, {
      status: args.status,
      terminalAt: now,
      updatedAt: now,
    });
    return args.status;
  },
});

export async function terminalizeExecutionComponentByOperation(
  ctx: MutationCtx,
  adapterId: "interactive-workpool" | "background-workpool" | "maintenance-workpool",
  operationId: string,
  status: "completed" | "cancelled" | "failed",
  now = Date.now(),
): Promise<boolean> {
  const ref = await ctx.db
    .query("executionComponentRefs")
    .withIndex("by_operation", (q) => q
      .eq("adapterId", adapterId)
      .eq("operationId", operationId))
    .unique();
  if (!ref || !["active", "cancel_requested"].includes(ref.status)) return false;
  await ctx.db.patch(ref._id, { status, terminalAt: now, updatedAt: now });
  return true;
}

export async function terminalizeExecutionComponentsForRun(
  ctx: MutationCtx,
  args: {
    runId: Id<"executionRuns">;
    status: "completed" | "cancelled" | "failed";
    now?: number;
  },
): Promise<number> {
  const refs = await ctx.db
    .query("executionComponentRefs")
    .withIndex("by_run", (q) => q.eq("runId", args.runId))
    .collect();
  const active = refs.filter((ref) =>
    ref.status === "active" || ref.status === "cancel_requested",
  );
  const now = args.now ?? Date.now();
  for (const ref of active) {
    await ctx.db.patch(ref._id, {
      status: args.status,
      terminalAt: now,
      updatedAt: now,
    });
  }
  return active.length;
}

export const terminalizeForRun = internalMutation({
  args: {
    runId: v.id("executionRuns"),
    status: v.union(
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("failed"),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args) => await terminalizeExecutionComponentsForRun(ctx, args),
});
