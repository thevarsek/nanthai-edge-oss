import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, query, type MutationCtx } from "../_generated/server";
import { assertCurrentExecution } from "../execution/attempts";
import { authenticateOnlineRuntimeHost } from "./host_session_auth";
import { expireRuntimeTurnPacketRef } from "./turn_packet_expiry";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export async function registerRuntimeTurnPacket(
  ctx: MutationCtx,
  args: {
    runId: Id<"executionRuns">;
    attemptId: Id<"executionAttempts">;
    fence: number;
    userId: string;
    commandId: string;
    packetHash: string;
    storageId: Id<"_storage">;
    byteLength: number;
    expiresAt: number;
    now?: number;
  },
): Promise<Id<"runtimeTurnPackets">> {
  const now = args.now ?? Date.now();
  const { run, attempt } = await assertCurrentExecution(ctx, {
    attemptId: args.attemptId,
    fence: args.fence,
  });
  if (
    run._id !== args.runId
    || run.userId !== args.userId
    || attempt.executorKind !== "local_runtime"
    || attempt.placement !== "local"
  ) {
    throw new ConvexError({
      code: "RUNTIME_ROUTE_MISMATCH",
      message: "RuntimeTurnPacket does not belong to the active local attempt",
    });
  }
  if (!SHA256_PATTERN.test(args.packetHash)) {
    throw new ConvexError({ code: "VALIDATION_ERROR", message: "Packet hash must be SHA-256 hex" });
  }
  if (!Number.isSafeInteger(args.byteLength) || args.byteLength <= 0) {
    throw new ConvexError({ code: "VALIDATION_ERROR", message: "Packet byte length is invalid" });
  }
  if (args.expiresAt <= now) {
    throw new ConvexError({ code: "VALIDATION_ERROR", message: "Packet envelope is already expired" });
  }
  const existing = await ctx.db.query("runtimeTurnPackets")
    .withIndex("by_attempt_command", (queryBuilder) =>
      queryBuilder.eq("attemptId", attempt._id).eq("commandId", args.commandId),
    )
    .unique();
  if (existing) {
    if (
      existing.fence !== args.fence
      || existing.packetHash !== args.packetHash
      || existing.storageId !== args.storageId
      || existing.byteLength !== args.byteLength
      || existing.expiresAt !== args.expiresAt
    ) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "Runtime command already has a different packet envelope",
      });
    }
    return existing._id;
  }
  const packetId = await ctx.db.insert("runtimeTurnPackets", {
    runId: run._id,
    attemptId: attempt._id,
    fence: attempt.fence,
    userId: run.userId,
    commandId: args.commandId,
    packetHash: args.packetHash,
    storageId: args.storageId,
    byteLength: args.byteLength,
    expiresAt: args.expiresAt,
    createdAt: now,
  });
  await ctx.scheduler.runAt(args.expiresAt, expireRuntimeTurnPacketRef, {
    turnPacketId: packetId,
    expectedExpiresAt: args.expiresAt,
  });
  return packetId;
}

export const register = internalMutation({
  args: {
    runId: v.id("executionRuns"),
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    userId: v.string(),
    commandId: v.string(),
    packetHash: v.string(),
    storageId: v.id("_storage"),
    byteLength: v.number(),
    expiresAt: v.number(),
  },
  returns: v.id("runtimeTurnPackets"),
  handler: async (ctx, args) => await registerRuntimeTurnPacket(ctx, args),
});

export const getForHost = query({
  args: {
    deviceId: v.string(),
    credentialId: v.string(),
    credential: v.string(),
    presenceSessionId: v.string(),
    turnPacketId: v.id("runtimeTurnPackets"),
  },
  returns: v.union(v.object({
    storageId: v.id("_storage"),
    packetHash: v.string(),
    byteLength: v.number(),
    expiresAt: v.number(),
  }), v.null()),
  handler: async (ctx, args) => {
    const { device } = await authenticateOnlineRuntimeHost(ctx, args);
    const packet = await ctx.db.get(args.turnPacketId);
    if (!packet || packet.userId !== device.userId || packet.expiresAt <= Date.now()) return null;
    const attempt = await ctx.db.get(packet.attemptId);
    const command = await ctx.db.query("runtimeCommands")
      .withIndex("by_turn_packet", (queryBuilder) =>
        queryBuilder.eq("turnPacketId", packet._id),
      )
      .unique();
    if (
      !attempt
      || attempt.deviceId !== device.deviceId
      || attempt.fence !== packet.fence
      || !command
      || command.targetDeviceId !== device.deviceId
      || command.status === "rejected"
      || command.status === "expired"
    ) return null;
    return {
      storageId: packet.storageId,
      packetHash: packet.packetHash,
      byteLength: packet.byteLength,
      expiresAt: packet.expiresAt,
    };
  },
});
