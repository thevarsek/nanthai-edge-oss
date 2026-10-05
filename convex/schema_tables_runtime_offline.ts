import { defineTable } from "convex/server";
import { v } from "convex/values";
export const runtimeOfflineSchemaTables = {
  runtimeOfflineImports: defineTable({
    chatId: v.id("chats"), userId: v.string(), deviceId: v.string(), localResultId: v.string(), inputHash: v.string(),
    originRunId: v.id("executionRuns"), runId: v.id("executionRuns"),
    userMessageId: v.id("messages"), assistantMessageId: v.id("messages"),
    disposition: v.union(v.literal("synced"), v.literal("review")), createdAt: v.number(),
  }).index("by_assistant_message", ["assistantMessageId"])
  .index("by_device_result", ["deviceId", "localResultId"])
    .index("by_user", ["userId"])
    .index("by_chat", ["chatId"]),
};
