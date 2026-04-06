import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

const MIN_WAIT_MS = 25;

function clampWaitMs(waitMs: number): number {
  return Math.max(MIN_WAIT_MS, Math.ceil(waitMs));
}

export const claimRequestSlot = internalMutation({
  args: {
    userId: v.string(),
    provider: v.string(),
    requestId: v.string(),
    now: v.number(),
    leaseMs: v.number(),
  },
  returns: v.object({
    granted: v.boolean(),
    waitMs: v.number(),
  }),
  handler: async (ctx, args) => {
    const gate = await ctx.db
      .query("integrationRequestGates")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider),
      )
      .unique();

    const activeRequestId = gate?.activeRequestId;
    const activeLeaseExpiresAt = gate?.activeLeaseExpiresAt ?? 0;
    const nextAllowedAt = gate?.nextAllowedAt ?? 0;
    const leaseIsActive =
      activeRequestId !== undefined && activeLeaseExpiresAt > args.now;
    const heldByOther = leaseIsActive && activeRequestId !== args.requestId;

    if (heldByOther) {
      return {
        granted: false,
        waitMs: clampWaitMs(activeLeaseExpiresAt - args.now),
      };
    }

    if (nextAllowedAt > args.now && activeRequestId !== args.requestId) {
      return {
        granted: false,
        waitMs: clampWaitMs(nextAllowedAt - args.now),
      };
    }

    const patch = {
      activeRequestId: args.requestId,
      activeLeaseExpiresAt: args.now + args.leaseMs,
      lastRequestStartedAt: args.now,
      updatedAt: args.now,
    };

    if (gate) {
      await ctx.db.patch(gate._id, patch);
    } else {
      await ctx.db.insert("integrationRequestGates", {
        userId: args.userId,
        provider: args.provider,
        nextAllowedAt: args.now,
        ...patch,
      });
    }

    return {
      granted: true,
      waitMs: 0,
    };
  },
});

export const releaseRequestSlot = internalMutation({
  args: {
    userId: v.string(),
    provider: v.string(),
    requestId: v.string(),
    now: v.number(),
    nextAllowedAt: v.number(),
    lastResponseStatus: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const gate = await ctx.db
      .query("integrationRequestGates")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider),
      )
      .unique();

    if (!gate) {
      return null;
    }

    const patch: {
      activeRequestId?: string;
      activeLeaseExpiresAt?: number;
      nextAllowedAt: number;
      lastRequestFinishedAt: number;
      lastResponseStatus?: number;
      updatedAt: number;
    } = {
      nextAllowedAt: Math.max(gate.nextAllowedAt ?? 0, args.nextAllowedAt),
      lastRequestFinishedAt: args.now,
      lastResponseStatus: args.lastResponseStatus,
      updatedAt: args.now,
    };

    if (gate.activeRequestId === args.requestId) {
      patch.activeRequestId = undefined;
      patch.activeLeaseExpiresAt = undefined;
    }

    await ctx.db.patch(gate._id, patch);
    return null;
  },
});
