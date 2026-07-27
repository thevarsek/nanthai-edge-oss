import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  presentationDirectionValidator,
  presentationCreativeDirectionValidator,
  presentationImageModeValidator,
  presentationPlanValidator,
  presentationSourceKindValidator,
  presentationStatusValidator,
  presentationWorkflowPhaseValidator,
} from "./presentations/validators";

export const presentationSchemaTables = {
  presentationAssets: defineTable({
    userId: v.string(),
    projectId: v.optional(v.id("presentationProjects")),
    sourceStorageId: v.optional(v.id("_storage")),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    altText: v.string(),
    kind: v.union(v.literal("attachment"), v.literal("pptx_extracted")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_project", ["projectId", "createdAt"])
    .index("by_user_storage", ["userId", "storageId"])
    .index("by_user_source", ["userId", "sourceStorageId"]),

  // Leaf rows are declared first and purged before their parent project.
  presentationSlides: defineTable({
    userId: v.string(),
    projectId: v.id("presentationProjects"),
    slideId: v.string(),
    position: v.number(),
    title: v.string(),
    notes: v.optional(v.string()),
    html: v.string(),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "updatedAt"])
    .index("by_project", ["projectId", "position"])
    .index("by_project_slide", ["projectId", "slideId"]),

  presentationProjects: defineTable({
    userId: v.string(),
    chatId: v.optional(v.id("chats")),
    originUserMessageId: v.optional(v.id("messages")),
    originAssistantMessageId: v.optional(v.id("messages")),
    originToolCallId: v.optional(v.string()),
    sourceStorageId: v.optional(v.id("_storage")),
    assetStorageIds: v.optional(v.array(v.id("_storage"))),
    title: v.string(),
    status: presentationStatusValidator,
    workflowPhase: v.optional(presentationWorkflowPhaseValidator),
    sourceKind: presentationSourceKindValidator,
    prompt: v.string(),
    direction: presentationDirectionValidator,
    imageMode: presentationImageModeValidator,
    aspectRatio: v.literal("16:9"),
    revision: v.number(),
    modelId: v.optional(v.string()),
    effectiveModelIds: v.optional(v.array(v.string())),
    modelFallbackUsed: v.optional(v.boolean()),
    plan: v.optional(presentationPlanValidator),
    creativeDirection: v.optional(presentationCreativeDirectionValidator),
    snapshotStorageId: v.optional(v.id("_storage")),
    snapshotRevision: v.optional(v.number()),
    snapshotSizeBytes: v.optional(v.number()),
    snapshotKind: v.optional(v.union(v.literal("fallback"), v.literal("browser_html"))),
    // Durable Workflow component identity for the active chat-created run.
    // Canonical product state remains in this table; component history is not
    // exposed to clients.
    workflowId: v.optional(v.string()),
    parentResumeEventId: v.optional(v.string()),
    executionRunId: v.optional(v.id("executionRuns")),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "updatedAt"])
    .index("by_chat", ["chatId", "updatedAt"])
    .index("by_user_chat", ["userId", "chatId", "updatedAt"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_snapshot_storage", ["snapshotStorageId"])
    .index("by_parent_resume_event", ["parentResumeEventId"])
    .index("by_origin_assistant", ["originAssistantMessageId", "updatedAt"])
    .index("by_origin_assistant_status", ["originAssistantMessageId", "status", "updatedAt"]),

  presentationGenerationRuns: defineTable({
    userId: v.string(),
    projectId: v.id("presentationProjects"),
    projectRevision: v.number(),
    jobId: v.id("generationJobs"),
    toolCallId: v.string(),
    selectedModelId: v.string(),
    requireZdrOverride: v.optional(v.boolean()),
    expectedSlideIds: v.array(v.string()),
    completedSlideIds: v.array(v.string()),
    deletedSlideIds: v.array(v.string()),
    studioCount: v.number(),
    status: v.union(
      v.literal("generating"),
      v.literal("curator_queued"),
      v.literal("curating"),
      v.literal("finalizing"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    curatorWorkpoolOperationId: v.optional(v.string()),
    finalizerWorkpoolOperationId: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    executionRunId: v.optional(v.id("executionRuns")),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    fanoutDispatchedFence: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_project_revision", ["projectId", "projectRevision"])
    .index("by_job", ["jobId", "createdAt"]),

  presentationGenerationBatches: defineTable({
    runId: v.id("presentationGenerationRuns"),
    userId: v.string(),
    batchIndex: v.number(),
    slideIds: v.array(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("repairing"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    repairAttempt: v.number(),
    candidateStorageId: v.optional(v.id("_storage")),
    targetSlideId: v.optional(v.string()),
    validationError: v.optional(v.string()),
    validationDetails: v.optional(v.string()),
    validationHistory: v.optional(v.array(v.object({
      attempt: v.number(),
      slideId: v.optional(v.string()),
      code: v.optional(v.string()),
      message: v.string(),
      details: v.optional(v.string()),
    }))),
    effectiveModelIds: v.array(v.string()),
    workpoolOperationId: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_run", ["runId", "batchIndex"])
    .index("by_workpool_operation", ["workpoolOperationId"]),

  presentationSlideCandidates: defineTable({
    runId: v.id("presentationGenerationRuns"),
    userId: v.string(),
    slideId: v.string(),
    position: v.number(),
    title: v.string(),
    notes: v.optional(v.string()),
    html: v.string(),
    effectiveModelId: v.string(),
    revision: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_run", ["runId", "position"])
    .index("by_run_slide", ["runId", "slideId"]),

  presentationCuratorTasks: defineTable({
    runId: v.id("presentationGenerationRuns"),
    userId: v.string(),
    taskKey: v.string(),
    kind: v.union(v.literal("recompose"), v.literal("consolidate")),
    slideIds: v.array(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("complete"),
    ),
    mode: v.union(v.literal("patch"), v.literal("recreate")),
    attempt: v.number(),
    effectiveModelIds: v.array(v.string()),
    workpoolOperationId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_run", ["runId", "taskKey"])
    .index("by_run_status", ["runId", "status"])
    .index("by_workpool_operation", ["workpoolOperationId"]),
};
