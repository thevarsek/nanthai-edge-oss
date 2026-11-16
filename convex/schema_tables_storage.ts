import { defineTable } from "convex/server";
import { v } from "convex/values";

export const storageSchemaTables = {
  clientStorageUploads: defineTable({
    userId: v.string(),
    tokenHash: v.optional(v.string()),
    uploadUrl: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  }).index("by_token", ["tokenHash"]).index("by_storage", ["storageId"]).index("by_user", ["userId"]),
};
