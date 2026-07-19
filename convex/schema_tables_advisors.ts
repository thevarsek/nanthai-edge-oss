import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  advisorBatchStatus,
  advisorPersonaSnapshot,
  advisorRunStage,
  advisorRunStatus,
} from "./advisors/validators";
import { usageObject } from "./schema_validators";

export const advisorSchemaTables = {
  chatAdvisors: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    personaId: v.id("personas"),
    instanceName: v.string(),
    sortOrder: v.number(),
    allowWebSearch: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_chat", ["chatId", "sortOrder"])
    .index("by_chat_and_persona", ["chatId", "personaId"])
    .index("by_persona", ["personaId", "updatedAt"])
    .index("by_user", ["userId", "updatedAt"]),

  advisorBatches: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    userMessageId: v.id("messages"),
    assistantMessageIds: v.array(v.id("messages")),
    status: advisorBatchStatus,
    brief: v.optional(v.string()),
    expectedRunCount: v.number(),
    completedRunCount: v.number(),
    failedRunCount: v.number(),
    generationSnapshot: v.any(),
    workflowId: v.optional(v.string()),
    executionRunId: v.optional(v.id("executionRuns")),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    executionClaimantId: v.optional(v.string()),
    generationOperationIds: v.optional(v.array(v.string())),
    generationDispatchedAt: v.optional(v.number()),
    scheduledFinalGenerationId: v.optional(v.id("_scheduled_functions")),
    scheduledFinalGenerationIds: v.optional(
      v.array(v.id("_scheduled_functions")),
    ),
    scheduledFinalGenerationAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_message", ["userMessageId"])
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_chat_status", ["chatId", "status"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_execution_run", ["executionRunId"])
    .index("by_status", ["status", "updatedAt"]),

  advisorRuns: defineTable({
    batchId: v.id("advisorBatches"),
    userId: v.string(),
    chatId: v.id("chats"),
    userMessageId: v.id("messages"),
    personaId: v.id("personas"),
    personaAvatarStorageId: v.optional(v.id("_storage")),
    personaSnapshot: advisorPersonaSnapshot,
    instanceName: v.string(),
    sortOrder: v.number(),
    status: advisorRunStatus,
    stage: advisorRunStage,
    brief: v.optional(v.string()),
    allowWebSearch: v.boolean(),
    resolvedInstructions: v.string(),
    requestedModelId: v.string(),
    actualModelId: v.optional(v.string()),
    partialAdvice: v.optional(v.string()),
    advice: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    responseId: v.optional(v.string()),
    outputItemId: v.optional(v.string()),
    replayItems: v.optional(v.any()),
    usage: v.optional(usageObject),
    cost: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    workpoolOperationId: v.optional(v.string()),
    watchdogScheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    lastActivityAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_batch", ["batchId", "sortOrder"])
    .index("by_persona", ["personaId", "createdAt"])
    .index("by_persona_avatar_storage", ["personaId", "personaAvatarStorageId"])
    .index("by_chat_and_persona", ["chatId", "personaId", "createdAt"])
    .index("by_user_message_and_persona", ["userMessageId", "personaId"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_status", ["status", "updatedAt"]),
};
