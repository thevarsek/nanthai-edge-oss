import { defineTable } from "convex/server";
import { v } from "convex/values";

export const analyticsSchemaTables = {
  analyticsWorkflowRuns: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    userMessageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    toolCallId: v.string(),
    toolName: v.union(v.literal("data_python_exec"), v.literal("data_python_sandbox")),
    artifactKey: v.string(),
    code: v.string(),
    inputFiles: v.array(v.object({
      storageId: v.string(),
      filename: v.optional(v.string()),
    })),
    exportPaths: v.array(v.string()),
    captureCharts: v.boolean(),
    packages: v.array(v.string()),
    timeoutMs: v.optional(v.number()),
    status: v.union(
      v.literal("prepared"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    phase: v.string(),
    workflowId: v.optional(v.string()),
    claimantId: v.optional(v.string()),
    parentEventId: v.optional(v.string()),
    resultJson: v.optional(v.string()),
    resultStorageId: v.optional(v.id("_storage")),
    normalizedResultJson: v.optional(v.string()),
    normalizedResultStorageId: v.optional(v.id("_storage")),
    normalizedResultBytes: v.optional(v.number()),
    executionEnvelopeStorageId: v.optional(v.id("_storage")),
    resultBytes: v.optional(v.number()),
    error: v.optional(v.string()),
    executionRunId: v.id("executionRuns"),
    executionAttemptId: v.id("executionAttempts"),
    executionFence: v.number(),
    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_operation", ["jobId", "toolCallId"])
    .index("by_job", ["jobId", "createdAt"])
    .index("by_job_status", ["jobId", "status", "updatedAt"])
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_message", ["messageId", "createdAt"])
    .index("by_execution_run", ["executionRunId"])
    .index("by_parent_event", ["parentEventId"])
    .index("by_user_status", ["userId", "status", "updatedAt"]),

  analyticsArtifactIntents: defineTable({
    analyticsRunId: v.id("analyticsWorkflowRuns"),
    userId: v.optional(v.string()),
    artifactKey: v.string(),
    ordinal: v.number(),
    kind: v.union(v.literal("chart"), v.literal("output")),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    status: v.union(v.literal("planned"), v.literal("stored")),
    storageId: v.optional(v.id("_storage")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["artifactKey"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_run", ["analyticsRunId", "ordinal"]),
};
