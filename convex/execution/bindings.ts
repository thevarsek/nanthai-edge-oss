import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertCurrentExecution } from "./attempts";
import { runtimeBindingStatus } from "./validators";

export async function bindRuntimeSession(
  ctx: MutationCtx,
  args: {
    attemptId: Id<"executionAttempts">;
    fence: number;
    bindingKey: string;
    adapterId: string;
    nativeSessionId: string;
    deviceId?: string;
    workspaceId?: string;
    now?: number;
  },
): Promise<Id<"runtimeSessionBindings">> {
  const { run, attempt } = await assertCurrentExecution(ctx, args);
  const existing = await ctx.db
    .query("runtimeSessionBindings")
    .withIndex("by_attempt_key", (q) =>
      q.eq("attemptId", attempt._id).eq("bindingKey", args.bindingKey),
    )
    .unique();
  if (existing) {
    if (
      existing.adapterId !== args.adapterId
      || existing.nativeSessionId !== args.nativeSessionId
      || existing.status !== "active"
    ) {
      throw new Error("RUNTIME_BINDING_CONFLICT");
    }
    return existing._id;
  }
  return await ctx.db.insert("runtimeSessionBindings", {
    runId: run._id,
    attemptId: attempt._id,
    userId: run.userId,
    adapterId: args.adapterId,
    bindingKey: args.bindingKey,
    fence: attempt.fence,
    status: "active",
    nativeSessionId: args.nativeSessionId,
    deviceId: args.deviceId,
    workspaceId: args.workspaceId,
    boundAt: args.now ?? Date.now(),
  });
}

export async function releaseRuntimeSession(
  ctx: MutationCtx,
  args: {
    bindingId: Id<"runtimeSessionBindings">;
    attemptId: Id<"executionAttempts">;
    fence: number;
    status?: "released" | "revoked";
    reason?: string;
    now?: number;
  },
): Promise<"active" | "released" | "revoked"> {
  const binding = await ctx.db.get(args.bindingId);
  if (!binding || binding.attemptId !== args.attemptId) {
    throw new Error("RUNTIME_BINDING_NOT_FOUND");
  }
  if (binding.status !== "active") return binding.status;
  await assertCurrentExecution(ctx, args);
  const status = args.status ?? "released";
  await ctx.db.patch(binding._id, {
    status,
    releasedAt: args.now ?? Date.now(),
    releaseReason: args.reason?.slice(0, 500),
  });
  return status;
}

export const bind = internalMutation({
  args: {
    attemptId: v.id("executionAttempts"), fence: v.number(), bindingKey: v.string(),
    adapterId: v.string(), nativeSessionId: v.string(), deviceId: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
  },
  returns: v.id("runtimeSessionBindings"),
  handler: async (ctx, args) => await bindRuntimeSession(ctx, args),
});

export const release = internalMutation({
  args: {
    bindingId: v.id("runtimeSessionBindings"), attemptId: v.id("executionAttempts"),
    fence: v.number(), status: v.optional(v.union(v.literal("released"), v.literal("revoked"))),
    reason: v.optional(v.string()),
  },
  returns: runtimeBindingStatus,
  handler: async (ctx, args) => await releaseRuntimeSession(ctx, args),
});
