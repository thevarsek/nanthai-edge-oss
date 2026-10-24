import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";

export type ExpireRuntimePresenceArgs = {
  runtimeDeviceId: Id<"runtimeDevices">;
  presenceId: Id<"runtimeDevicePresences">;
  presenceSessionId: string;
  expectedExpiresAt: number;
};

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

// Retained for expiries scheduled by earlier deployments; new leases use the sweep.
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

// One sweep per deployment replaces a scheduled expiry per heartbeat, so idle
// hosts no longer cost a call each beat. Auth already rejects an expired lease;
// the sweep only publishes the offline state to clients.
const EXPIRY_SWEEP_BATCH = 100;

export async function expireStaleRuntimePresencesHandler(
  ctx: MutationCtx,
  now = Date.now(),
): Promise<number> {
  const stale = await ctx.db.query("runtimeDevicePresences")
    .withIndex("by_status_expiry", (q) => q.eq("status", "online").lte("expiresAt", now))
    .take(EXPIRY_SWEEP_BATCH);
  let expired = 0;
  for (const presence of stale) {
    if (await expireRuntimePresenceHandler(ctx, {
      runtimeDeviceId: presence.runtimeDeviceId,
      presenceId: presence._id,
      presenceSessionId: presence.presenceSessionId,
      expectedExpiresAt: presence.expiresAt,
      now,
    })) expired += 1;
  }
  return expired;
}

export const expireStaleRuntimePresences = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => await expireStaleRuntimePresencesHandler(ctx),
});
