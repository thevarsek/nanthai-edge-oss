import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";

export type ExpireRuntimePresenceArgs = {
  runtimeDeviceId: Id<"runtimeDevices">;
  presenceId: Id<"runtimeDevicePresences">;
  presenceSessionId: string;
  expectedExpiresAt: number;
};

export const expireRuntimePresenceRef = makeFunctionReference<
  "mutation",
  ExpireRuntimePresenceArgs,
  boolean
>("runtime_host/presence_expiry:expireRuntimePresence") as unknown as FunctionReference<
  "mutation",
  "internal",
  ExpireRuntimePresenceArgs,
  boolean
>;

export async function expireRuntimePresenceHandler(
  ctx: MutationCtx,
  args: ExpireRuntimePresenceArgs & { now?: number },
): Promise<boolean> {
  const presence = await ctx.db.get(args.presenceId);
  if (
    !presence
    || presence.runtimeDeviceId !== args.runtimeDeviceId
    || presence.presenceSessionId !== args.presenceSessionId
    || presence.status !== "online"
    || presence.expiresAt !== args.expectedExpiresAt
    || presence.expiresAt > (args.now ?? Date.now())
  ) return false;
  const now = args.now ?? Date.now();
  await ctx.db.patch(presence._id, {
    status: "offline",
    disconnectedAt: now,
    disconnectReason: "presence_expired",
  });
  const device = await ctx.db.get(args.runtimeDeviceId);
  if (device?.currentPresenceId === presence._id) {
    await ctx.db.patch(device._id, {
      currentPresenceId: undefined,
      updatedAt: now,
    });
  }
  return true;
}

export const expireRuntimePresence = internalMutation({
  args: {
    runtimeDeviceId: v.id("runtimeDevices"),
    presenceId: v.id("runtimeDevicePresences"),
    presenceSessionId: v.string(),
    expectedExpiresAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => await expireRuntimePresenceHandler(ctx, args),
});
