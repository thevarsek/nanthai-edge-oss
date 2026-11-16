import { defineTable } from "convex/server";
import { v } from "convex/values";

export const storageSchemaTables = {
  clientStorageUploads: defineTable({
    userId: v.string(),
    tokenHash: v.optional(v.string()),
    uploadUrl: v.optional(v.string()),
    /** Set while one request streams through a token; a token works once. */
    claimedAt: v.optional(v.number()),
    storageId: v.optional(v.id("_storage")),
    /**
     * Written by the upload route that also records every durable consumer in
     * an indexed table. Only these rows may be reclaimed by the unreferenced
     * upload sweep; older rows are never deleted by it.
     */
    sweepEligible: v.optional(v.boolean()),
    createdAt: v.number(),
  }).index("by_token", ["tokenHash"]).index("by_storage", ["storageId"]).index("by_user", ["userId"])
    .index("by_sweep_created", ["sweepEligible", "createdAt"]),
  userDailyUsage: defineTable({
    userId: v.string(),
    kind: v.union(v.literal("upload_bytes"), v.literal("platform_embeddings")),
    /** UTC calendar day, `YYYY-MM-DD`. */
    day: v.string(),
    amount: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId", "kind", "day"]).index("by_day", ["day"]),
};
