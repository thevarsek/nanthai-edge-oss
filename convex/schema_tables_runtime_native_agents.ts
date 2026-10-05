import { defineTable } from "convex/server";
import { v } from "convex/values";

const runtimeNativeAgentStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("interrupted"),
  v.literal("shutdown"),
  v.literal("not_found"),
);

const runtimeNativeAgentGroupStatus = v.union(
  v.literal("active"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("interrupted"),
);

const runtimeNativeAgentActivityKind = v.union(
  v.literal("delegation"),
  v.literal("message"),
  v.literal("reasoning"),
  v.literal("tool"),
  v.literal("interaction"),
);

export const runtimeNativeAgentSchemaTables = {
  runtimeNativeAgentGroups: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    generationJobId: v.id("generationJobs"),
    runId: v.id("executionRuns"),
    attemptId: v.id("executionAttempts"),
    fence: v.number(),
    adapterId: v.string(),
    rootNativeSessionId: v.string(),
    rootNativeThreadId: v.string(),
    status: runtimeNativeAgentGroupStatus,
    nextAgentOrdinal: v.number(),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_message", ["messageId"])
    .index("by_attempt", ["attemptId"])
    .index("by_run", ["runId"])
    .index("by_chat", ["chatId", "updatedAt"])
    .index("by_user", ["userId", "updatedAt"]),

  runtimeNativeAgents: defineTable({
    groupId: v.id("runtimeNativeAgentGroups"),
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    nativeThreadId: v.string(),
    parentNativeThreadId: v.optional(v.string()),
    ordinal: v.number(),
    depth: v.number(),
    agentPath: v.optional(v.string()),
    nickname: v.optional(v.string()),
    role: v.optional(v.string()),
    prompt: v.optional(v.string()),
    actualModelProvider: v.optional(v.string()),
    actualModelId: v.optional(v.string()),
    reasoningEffort: v.optional(v.string()),
    status: runtimeNativeAgentStatus,
    latestActivityId: v.optional(v.string()),
    latestActivityKind: v.optional(runtimeNativeAgentActivityKind),
    latestActivity: v.optional(v.string()),
    statusSummary: v.optional(v.string()),
    output: v.optional(v.string()),
    error: v.optional(v.string()),
    startedAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_group_thread", ["groupId", "nativeThreadId"])
    .index("by_group_ordinal", ["groupId", "ordinal"])
    .index("by_group_status", ["groupId", "status", "updatedAt"])
    .index("by_chat", ["chatId", "updatedAt"])
    .index("by_user", ["userId", "updatedAt"]),
};
