import { defineTable } from "convex/server";
import { v } from "convex/values";

export const searchOrchestrationSchemaTables = {
  researchSearchBatches: defineTable({
    sessionId: v.id("searchSessions"),
    phaseOrder: v.number(),
    phaseType: v.union(v.literal("initial_search"), v.literal("depth_iteration")),
    iteration: v.optional(v.number()),
    searchModel: v.string(),
    maxTokens: v.number(),
    requireZdr: v.boolean(),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("completed")),
    expectedCount: v.number(),
    terminalCount: v.number(),
    failedCount: v.number(),
    workpoolOperationIds: v.array(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_session_phase", ["sessionId", "phaseOrder"])
    .index("by_status_updated", ["status", "createdAt"])
    .index("by_session", ["sessionId", "createdAt"]),

  researchSearchTasks: defineTable({
    batchId: v.id("researchSearchBatches"),
    sessionId: v.id("searchSessions"),
    queryIndex: v.number(),
    query: v.string(),
    status: v.union(v.literal("queued"), v.literal("completed"), v.literal("failed"), v.literal("cancelled")),
    workpoolOperationId: v.optional(v.string()),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_batch", ["batchId", "queryIndex"])
    .index("by_status_updated", ["status", "createdAt"])
    .index("by_session", ["sessionId", "createdAt"]),
};
