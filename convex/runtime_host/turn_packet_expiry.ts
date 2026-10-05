import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { RUNTIME_LIMITS } from "./protocol_common";

export type ExpireRuntimeTurnPacketArgs = {
  turnPacketId: Id<"runtimeTurnPackets">;
  expectedExpiresAt: number;
};

export const expireRuntimeTurnPacketRef = makeFunctionReference<
  "mutation",
  ExpireRuntimeTurnPacketArgs,
  boolean
>("runtime_host/turn_packet_expiry:expireRuntimeTurnPacket") as unknown as FunctionReference<
  "mutation",
  "internal",
  ExpireRuntimeTurnPacketArgs,
  boolean
>;

export async function expireRuntimeTurnPacketHandler(
  ctx: MutationCtx,
  args: ExpireRuntimeTurnPacketArgs & { now?: number },
): Promise<boolean> {
  const packet = await ctx.db.get(args.turnPacketId);
  if (
    !packet
    || packet.expiresAt !== args.expectedExpiresAt
    || packet.expiresAt > (args.now ?? Date.now())
  ) return false;
  const attachmentHandles = await ctx.db
    .query("runtimeAttachmentFetchHandles")
    .withIndex("by_packet", (queryBuilder) =>
      queryBuilder.eq("turnPacketId", packet._id),
    )
    .take(RUNTIME_LIMITS.maxPartsPerMessage);
  for (const handle of attachmentHandles) await ctx.db.delete(handle._id);
  await ctx.storage.delete(packet.storageId).catch(() => undefined);
  await ctx.db.delete(packet._id);
  return true;
}

export const expireRuntimeTurnPacket = internalMutation({
  args: {
    turnPacketId: v.id("runtimeTurnPackets"),
    expectedExpiresAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => await expireRuntimeTurnPacketHandler(ctx, args),
});
