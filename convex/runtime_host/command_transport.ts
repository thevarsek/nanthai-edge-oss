import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { assertCurrentExecution } from "../execution/attempts";
import {
  commandReplayMatches,
  stableInputHash,
} from "../execution/commands";
import {
  authorizationSource,
  runtimeCommandType,
} from "../execution/validators";

export async function enqueueRuntimeHostCommand(
  ctx: MutationCtx,
  args: {
    runId: Id<"executionRuns">;
    attemptId: Id<"executionAttempts">;
    fence: number;
    targetDeviceId: string;
    commandId: string;
    type: "start" | "prompt" | "steer" | "cancel" | "resume" | "interrupt"
      | "permission_response" | "shutdown";
    authorizationSource: "explicit_user_turn" | "configured_automation"
      | "runtime_policy" | "interactive_confirmation";
    initiatedBy: string;
    payload?: string;
    turnPacketId?: Id<"runtimeTurnPackets">;
    expiresAt?: number;
    now?: number;
  },
): Promise<Id<"runtimeCommands">> {
  const now = args.now ?? Date.now();
  const { run, attempt } = await assertCurrentExecution(ctx, {
    attemptId: args.attemptId,
    fence: args.fence,
    allowWaiting: args.type !== "start",
    allowCancelling: args.type === "cancel" || args.type === "shutdown",
  });
  if (run._id !== args.runId || run.userId !== args.initiatedBy) {
    throw new ConvexError({ code: "FORBIDDEN", message: "Runtime execution is not owned by this user" });
  }
  if (
    attempt.executorKind !== "local_runtime"
    || attempt.placement !== "local"
    || attempt.deviceId !== args.targetDeviceId
  ) {
    throw new ConvexError({
      code: "RUNTIME_ROUTE_MISMATCH",
      message: "Runtime command does not match the active local execution route",
    });
  }
  if (args.expiresAt !== undefined && args.expiresAt <= now) {
    throw new ConvexError({ code: "VALIDATION_ERROR", message: "Runtime command is already expired" });
  }
  const device = await ctx.db.query("runtimeDevices")
    .withIndex("by_device_id", (query) => query.eq("deviceId", args.targetDeviceId))
    .unique();
  if (!device || device.userId !== run.userId || device.status !== "active") {
    throw new ConvexError({ code: "RUNTIME_UNAVAILABLE", message: "Selected Runtime Host is unavailable" });
  }
  if (args.turnPacketId) {
    const packet = await ctx.db.get(args.turnPacketId);
    if (
      !packet
      || packet.runId !== run._id
      || packet.attemptId !== attempt._id
      || packet.fence !== attempt.fence
      || packet.commandId !== args.commandId
      || packet.expiresAt <= now
    ) {
      throw new ConvexError({
        code: "RUNTIME_PACKET_INVALID",
        message: "Runtime turn packet is missing, expired, or belongs to another attempt",
      });
    }
  }
  if (args.type === "start" && !args.turnPacketId) {
    throw new ConvexError({
      code: "RUNTIME_PACKET_REQUIRED",
      message: "Starting a local turn requires a stored RuntimeTurnPacket envelope",
    });
  }
  const existing = await ctx.db.query("runtimeCommands")
    .withIndex("by_run_command", (query) =>
      query.eq("runId", run._id).eq("commandId", args.commandId),
    )
    .unique();
  const inputHash = stableInputHash(
    `${args.type}\n${args.authorizationSource}\n${args.payload ?? ""}`,
  );
  if (existing) {
    if (
      existing.targetDeviceId !== args.targetDeviceId
      || existing.turnPacketId !== args.turnPacketId
      || !commandReplayMatches(existing, {
        inputHash,
        expectedFence: args.fence,
        type: args.type,
        authorizationSource: args.authorizationSource,
        payload: args.payload,
      })
    ) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Runtime command ID was already used for different input",
      });
    }
    return existing._id;
  }
  const commandId = await ctx.db.insert("runtimeCommands", {
    runId: run._id,
    attemptId: attempt._id,
    userId: run.userId,
    commandId: args.commandId,
    expectedFence: attempt.fence,
    type: args.type,
    status: "pending",
    authorizationSource: args.authorizationSource,
    initiatedBy: args.initiatedBy,
    inputHash,
    payload: args.payload,
    expiresAt: args.expiresAt,
    targetDeviceId: args.targetDeviceId,
    turnPacketId: args.turnPacketId,
    createdAt: now,
    updatedAt: now,
  });
  if (args.type === "cancel" || args.type === "shutdown") {
    await ctx.db.patch(run._id, {
      state: "cancelling",
      cancelRequestedAt: now,
      cancelRequestedBy: args.initiatedBy,
      updatedAt: now,
    });
  }
  return commandId;
}

export const enqueue = internalMutation({
  args: {
    runId: v.id("executionRuns"),
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    targetDeviceId: v.string(),
    commandId: v.string(),
    type: runtimeCommandType,
    authorizationSource,
    initiatedBy: v.string(),
    payload: v.optional(v.string()),
    turnPacketId: v.optional(v.id("runtimeTurnPackets")),
    expiresAt: v.optional(v.number()),
  },
  returns: v.id("runtimeCommands"),
  handler: async (ctx, args) => await enqueueRuntimeHostCommand(ctx, args),
});
