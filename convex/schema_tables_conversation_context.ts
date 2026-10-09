import { defineTable } from "convex/server";
import { v } from "convex/values";

export const conversationContextSchemaTables = {
  conversationSummaries: defineTable({
    userId: v.string(), chatId: v.id("chats"), participantId: v.string(),
    sourceOperationId: v.optional(v.id("conversationCompactions")),
    previousId: v.optional(v.id("conversationSummaries")), sourceDigest: v.string(),
    coverageCount: v.number(), coverageEndId: v.id("messages"), text: v.string(),
    policyVersion: v.string(), modelId: v.string(), createdAt: v.number(),
    runId: v.id("executionRuns"), attemptId: v.id("executionAttempts"), fence: v.number(),
  }).index("by_user", ["userId"]).index("by_chat", ["chatId"])
    .index("by_scope", ["chatId", "participantId"]),
  conversationSummarySources: defineTable({
    userId: v.string(), chatId: v.id("chats"), summaryId: v.optional(v.id("conversationSummaries")), operationId: v.optional(v.id("conversationCompactions")),
    ordinal: v.number(), messageIds: v.array(v.id("messages")),
  }).index("by_user", ["userId"]).index("by_chat", ["chatId"]).index("by_summary", ["summaryId", "ordinal"]).index("by_operation", ["operationId", "ordinal"]),
  conversationCompactions: defineTable({
    userId: v.string(), chatId: v.id("chats"), participantId: v.string(), jobId: v.id("generationJobs"),
    previousId: v.optional(v.id("conversationSummaries")), sourceDigest: v.string(),
    sourceRevision: v.number(), expand: v.boolean(),
    targetCount: v.number(), coverageEndId: v.id("messages"), text: v.string(),
    status: v.string(), nextChunk: v.number(), chunks: v.number(), stagedSourceCount: v.number(),
    runId: v.id("executionRuns"), attemptId: v.id("executionAttempts"), fence: v.number(),
    summaryId: v.optional(v.id("conversationSummaries")), createdAt: v.number(),
  }).index("by_user", ["userId"]).index("by_chat", ["chatId"]).index("by_job", ["jobId"]),
  conversationCompactionChunks: defineTable({
    userId: v.string(), chatId: v.id("chats"), operationId: v.id("conversationCompactions"),
    ordinal: v.number(), content: v.string(), messageIds: v.array(v.id("messages")),
    status: v.string(), result: v.optional(v.string()),
  }).index("by_user", ["userId"]).index("by_chat", ["chatId"])
    .index("by_operation", ["operationId", "ordinal"]),
};
