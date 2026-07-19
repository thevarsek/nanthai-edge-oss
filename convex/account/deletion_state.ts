import { v } from "convex/values";
import { internalMutation, internalQuery } from "../_generated/server";

export const beginAccountDeletion = internalMutation({
  args: { userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("accountDeletionTombstones")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!existing) {
      const now = Date.now();
      await ctx.db.insert("accountDeletionTombstones", {
        userId: args.userId,
        requestedAt: now,
        status: "cancelling",
        totalDeleted: 0,
        purgeTableIndex: 0,
        updatedAt: now,
      });
    }
    return null;
  },
});

export const getAccountDeletionState = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => await ctx.db
    .query("accountDeletionTombstones")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .unique(),
});

export const isAccountDeletionStarted = internalQuery({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => Boolean(await ctx.db
    .query("accountDeletionTombstones")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .unique()),
});

export const acquireAccountPurgeLease = internalMutation({
  args: { userId: v.string(), leaseId: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    const tombstone = await ctx.db
      .query("accountDeletionTombstones")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!tombstone || tombstone.status === "completed") return null;
    if (
      tombstone.purgeLeaseId
      && tombstone.purgeLeaseId !== args.leaseId
      && (tombstone.purgeLeaseExpiresAt ?? 0) > args.now
    ) return null;
    await ctx.db.patch(tombstone._id, {
      purgeLeaseId: args.leaseId,
      purgeLeaseExpiresAt: args.now + 60_000,
      status: "purging",
      updatedAt: args.now,
    });
    return {
      tableIndex: tombstone.purgeTableIndex ?? 0,
      cursor: tombstone.purgeCursor,
      totalDeleted: tombstone.totalDeleted ?? 0,
    };
  },
});

export const saveAccountPurgeProgress = internalMutation({
  args: {
    userId: v.string(),
    leaseId: v.string(),
    tableIndex: v.number(),
    cursor: v.optional(v.string()),
    totalDeleted: v.number(),
    completed: v.boolean(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const tombstone = await ctx.db
      .query("accountDeletionTombstones")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!tombstone || tombstone.purgeLeaseId !== args.leaseId) return false;
    await ctx.db.patch(tombstone._id, {
      purgeTableIndex: args.tableIndex,
      purgeCursor: args.cursor,
      totalDeleted: args.totalDeleted,
      status: args.completed ? "completed" : "purging",
      purgeLeaseId: undefined,
      purgeLeaseExpiresAt: undefined,
      updatedAt: Date.now(),
    });
    return true;
  },
});

export const renewAccountPurgeLease = internalMutation({
  args: { userId: v.string(), leaseId: v.string(), now: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const tombstone = await ctx.db
      .query("accountDeletionTombstones")
      .withIndex("by_user", (query) => query.eq("userId", args.userId))
      .unique();
    if (
      !tombstone
      || tombstone.status === "completed"
      || tombstone.purgeLeaseId !== args.leaseId
    ) return false;
    await ctx.db.patch(tombstone._id, {
      purgeLeaseExpiresAt: args.now + 60_000,
      updatedAt: args.now,
    });
    return true;
  },
});

export const cleanupCompletedAccountDeletionTombstones = internalMutation({
  args: {},
  returns: v.number(),
  // A completed data purge is not proof that the upstream Clerk identity can
  // no longer authenticate. Retain the fence until an authoritative identity
  // deletion acknowledgement is recorded; that handshake is deliberately not
  // approximated with a time-to-live.
  handler: async () => 0,
});
