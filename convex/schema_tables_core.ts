import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  autonomousStatus,
  chatMode,
  chatSource,
  generatedMediaType,
  generationContinuationStatus,
  generationJobStatus,
  messageRole,
  messageStatus,
  messageSource,
  searchPhaseStatus,
  searchPhaseType,
  searchSessionStatus,
  loadedSkillStates,
  subagentBatchStatus,
  subagentOverride,
  subagentRunStatus,
  drivePickerBatchStatus,
  documentCitation,
  documentEditAnnotation,
  documentEditBatchStatus,
  documentEditStatus,
  documentEvent,
  documentExtractionStatus,
  documentSource,
  documentStatus,
  documentSyncState,
  documentVersionSource,
  assemblyCostPolicy,
  assemblyPriority,
  confidenceDecayCurve,
  confidenceSource,
  contextAssemblyMode,
  contextClass,
  deferredToolKind,
  freshnessClass,
  lineageEdge,
  terminalErrorCode,
  privacyClassification,
  promotionDecision,
  promotionPolicy,
  provenanceResolutionStatus,
  runtimeIsolationPolicy,
  runtimeKind,
  runtimeVisibilityScope,
  toolArtifactStatus,
  toolMemoryBranchScope,
  toolMemoryKind,
  usageObject,
  videoJobStatus,
  skillOverrideEntry,
  integrationOverrideEntry,
  retryContract,
  recordedToolCall,
} from "./schema_validators";
import { presentationContextValidator } from "./presentations/validators";

const generationJobAnalyticsMetadata = v.object({
  platform: v.union(v.literal("web"), v.literal("ios"), v.literal("android")),
  appVersion: v.optional(v.string()),
  buildNumber: v.optional(v.string()),
  surface: v.optional(v.string()),
  routeOrScreen: v.optional(v.string()),
  clientEventId: v.optional(v.string()),
  clientSentAt: v.optional(v.number()),
});

const generationJobAnalyticsSource = v.union(
  v.literal("chat_generation"),
  v.literal("web_search"),
  v.literal("research_paper"),
  v.literal("subagent_parent_resume"),
  v.literal("scheduled_job"),
  v.literal("video_generation"),
);

export const coreSchemaTables = {
  chats: defineTable({
    userId: v.string(),
    title: v.optional(v.string()),
    mode: chatMode,
    folderId: v.optional(v.string()),
    isDeleting: v.optional(v.boolean()),
    deletingAt: v.optional(v.number()),
    executionTeardownCursor: v.optional(v.string()),
    isPinned: v.optional(v.boolean()),
    pinnedAt: v.optional(v.number()),
    activeBranchLeafId: v.optional(v.id("messages")),
    activeBranchLeafFocusOrder: v.optional(v.number()),
    lastMessagePreview: v.optional(v.string()),
    lastMessageDate: v.optional(v.number()),
    messageCount: v.optional(v.number()),
    // M13 — Automated chat provenance
    source: v.optional(chatSource),
    sourceJobId: v.optional(v.id("scheduledJobs")),
    sourceJobName: v.optional(v.string()),
    subagentOverride: v.optional(subagentOverride),
    temperatureOverride: v.optional(v.number()),
    maxTokensOverride: v.optional(v.number()),
    includeReasoningOverride: v.optional(v.boolean()),
    reasoningEffortOverride: v.optional(v.string()),
    // Per-chat internet search overrides (nil = use global default)
    webSearchOverride: v.optional(v.boolean()),
    searchModeOverride: v.optional(v.string()), // "basic" | "web" | "paper"
    searchComplexityOverride: v.optional(v.number()), // 1 | 2 | 3
    autoAudioResponseOverride: v.optional(
      v.union(v.literal("enabled"), v.literal("disabled")),
    ),
    // M30: Layered skill overrides (replaces discoverableSkillIds/disabledSkillIds)
    skillOverrides: v.optional(v.array(skillOverrideEntry)),
    // M30: Layered integration overrides (persisted, replaces ephemeral composer state)
    integrationOverrides: v.optional(v.array(integrationOverrideEntry)),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "updatedAt"])
    .index("by_user_folder", ["userId", "folderId", "updatedAt"])
    .index("by_user_pinned", ["userId", "isPinned", "pinnedAt"])
    .index("by_user_source", ["userId", "source", "updatedAt"])
    .index("by_user_folder_source", [
      "userId",
      "folderId",
      "source",
      "updatedAt",
    ])
    .index("by_user_source_pinned", [
      "userId",
      "source",
      "isPinned",
      "pinnedAt",
    ])
    .index("by_user_folder_source_pinned", [
      "userId",
      "folderId",
      "source",
      "isPinned",
      "pinnedAt",
    ])
    .index("by_user_subagent_override", ["userId", "subagentOverride"])
    .index("by_source_job", ["sourceJobId"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["userId", "folderId", "source"],
    })
    .searchIndex("search_preview", {
      searchField: "lastMessagePreview",
      filterFields: ["userId", "folderId", "source"],
    }),

  chatParticipants: defineTable({
    chatId: v.id("chats"),
    userId: v.string(),
    modelId: v.string(),
    personaId: v.optional(v.id("personas")),
    personaName: v.optional(v.string()),
    personaEmoji: v.optional(v.string()),
    personaAvatarImageUrl: v.optional(v.string()),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    includeReasoning: v.optional(v.boolean()),
    reasoningEffort: v.optional(v.string()),
    sortOrder: v.number(),
    createdAt: v.number(),
  })
    .index("by_chat", ["chatId", "sortOrder"])
    .index("by_user", ["userId"]),

  messages: defineTable({
    chatId: v.id("chats"),
    userId: v.optional(v.string()), // Denormalized for search-index scoping (M13)
    role: messageRole,
    content: v.string(),
    modelId: v.optional(v.string()),
    participantId: v.optional(v.id("personas")),
    participantName: v.optional(v.string()),
    participantEmoji: v.optional(v.string()),
    participantAvatarImageUrl: v.optional(v.string()),
    autonomousParticipantId: v.optional(v.string()),
    parentMessageIds: v.array(v.id("messages")),
    multiModelGroupId: v.optional(v.string()),
    isMultiModelResponse: v.optional(v.boolean()),
    status: messageStatus,
    reasoning: v.optional(v.string()),
    usage: v.optional(usageObject),
    imageUrls: v.optional(v.array(v.string())),
    imageMimeTypes: v.optional(v.array(v.string())),
    imageGenerationExpectedCount: v.optional(v.number()),
    imageGenerationResult: v.optional(
      v.object({
        requestedCount: v.number(),
        generatedCount: v.number(),
        failedCount: v.number(),
      }),
    ),
    // M29 — Video generation: parallel to imageUrls
    videoUrls: v.optional(v.array(v.string())),
    audioStorageId: v.optional(v.id("_storage")),
    audioTranscript: v.optional(v.string()),
    audioDurationMs: v.optional(v.number()),
    audioVoice: v.optional(v.string()),
    audioGeneratedAt: v.optional(v.number()),
    audioGenerating: v.optional(v.boolean()),
    audioLastPlayedAt: v.optional(v.number()),
    attachments: v.optional(
      v.array(
        v.object({
          type: v.string(),
          url: v.string(),
          storageId: v.optional(v.id("_storage")),
          name: v.optional(v.string()),
          mimeType: v.optional(v.string()),
          sizeBytes: v.optional(v.number()),
          driveFileId: v.optional(v.string()),
          lastRefreshedAt: v.optional(v.number()),
          // M29 — Video generation role for this image attachment
          videoRole: v.optional(
            v.union(
              v.literal("first_frame"),
              v.literal("last_frame"),
              v.literal("reference"),
            ),
          ),
        }),
      ),
    ),
    presentationContext: v.optional(presentationContextValidator),
    mcpInvocationIds: v.optional(v.array(v.id("mcpInvocations"))),
    enabledIntegrations: v.optional(v.array(v.string())),
    source: v.optional(messageSource),
    sourceJobId: v.optional(v.id("scheduledJobs")),
    sourceStepIndex: v.optional(v.number()),
    sourceStepTitle: v.optional(v.string()),
    chatCompletionNotifiedAt: v.optional(v.number()),
    postProcessScheduledAt: v.optional(v.number()),
    // M9 — Internet Search
    searchContext: v.optional(v.any()), // Cached search queries + results for retry
    searchSessionId: v.optional(v.id("searchSessions")),
    // M10 — Tool Execution Metadata
    toolCalls: v.optional(v.array(recordedToolCall)),
    toolResults: v.optional(
      v.array(
        v.object({
          toolCallId: v.string(), // Matches toolCalls[].id
          toolName: v.string(), // Tool function name (denormalized for display)
          result: v.string(), // JSON-stringified result (truncated)
          isError: v.optional(v.boolean()),
        }),
      ),
    ),
    generatedFileIds: v.optional(v.array(v.id("generatedFiles"))),
    generatedChartIds: v.optional(v.array(v.id("generatedCharts"))),
    // Perplexity citation annotations (structured for rich UI rendering)
    citations: v.optional(
      v.array(
        v.object({
          url: v.string(),
          title: v.string(),
        }),
      ),
    ),
    // M32 — Document Workspace citations. Separate from web-search URL citations.
    documentCitations: v.optional(v.array(documentCitation)),
    // M33 — First-class generated/updated document cards.
    documentEvents: v.optional(v.array(documentEvent)),
    // M39 — Hydrated DOCX tracked-change proposal cards.
    documentEditAnnotations: v.optional(v.array(documentEditAnnotation)),
    subagentsEnabled: v.optional(v.boolean()),
    subagentBatchId: v.optional(v.id("subagentBatches")),
    advisorBatchId: v.optional(v.id("advisorBatches")),
    drivePickerBatchId: v.optional(v.id("drivePickerBatches")),
    // Autonomous moderator — directive injected before this turn
    moderatorDirective: v.optional(v.string()),
    // M30: Orchestration traces — which skills/integrations were used
    loadedSkillIds: v.optional(v.array(v.id("skills"))),
    usedIntegrationIds: v.optional(v.array(v.string())),
    // M30: Turn-level overrides from slash chips (snapshot)
    turnSkillOverrides: v.optional(v.array(skillOverrideEntry)),
    turnIntegrationOverrides: v.optional(v.array(integrationOverrideEntry)),
    // Retry replay snapshot and diagnostics.
    retryContract: v.optional(retryContract),
    openrouterGenerationId: v.optional(v.string()),
    terminalErrorCode: v.optional(terminalErrorCode),
    createdAt: v.number(),
  })
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_chat_group", ["chatId", "multiModelGroupId"])
    .index("by_chat_status", ["chatId", "status"])
    .index("by_audio_storage", ["audioStorageId"])
    .index("by_advisor_batch", ["advisorBatchId"])
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["chatId", "userId"],
    }),

  documents: defineTable({
    userId: v.string(),
    title: v.string(),
    filename: v.string(),
    mimeType: v.string(),
    source: documentSource,
    currentVersionId: v.optional(v.id("documentVersions")),
    originChatId: v.optional(v.id("chats")),
    folderId: v.optional(v.id("folders")),
    sourceStorageId: v.optional(v.id("_storage")),
    fileAttachmentId: v.optional(v.id("fileAttachments")),
    generatedFileId: v.optional(v.id("generatedFiles")),
    generatedMediaId: v.optional(v.id("generatedMedia")),
    driveFileId: v.optional(v.string()),
    externalModifiedTime: v.optional(v.string()),
    externalSyncedVersionId: v.optional(v.id("documentVersions")),
    status: documentStatus,
    syncState: v.optional(documentSyncState),
    lastExtractedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "updatedAt"])
    .index("by_user_folder", ["userId", "folderId", "updatedAt"])
    .index("by_current_version", ["currentVersionId"])
    .index("by_source_storage", ["sourceStorageId"])
    .index("by_file_attachment", ["fileAttachmentId"])
    .index("by_generated_file", ["generatedFileId"])
    .index("by_generated_media", ["generatedMediaId"])
    .index("by_origin_chat", ["originChatId"]),

  documentVersions: defineTable({
    documentId: v.id("documents"),
    userId: v.string(),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    versionNumber: v.number(),
    source: documentVersionSource,
    parentVersionId: v.optional(v.id("documentVersions")),
    contentHash: v.optional(v.string()),
    extractionStatus: documentExtractionStatus,
    extractionTextStorageId: v.optional(v.id("_storage")),
    extractionMarkdownStorageId: v.optional(v.id("_storage")),
    extractionByteLength: v.optional(v.number()),
    extractionError: v.optional(v.string()),
    pageCount: v.optional(v.number()),
    wordCount: v.optional(v.number()),
    externalModifiedTime: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId", "versionNumber"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_storage", ["storageId"])
    .index("by_extraction_status", ["extractionStatus"]),

  documentEditBatches: defineTable({
    userId: v.string(),
    documentId: v.id("documents"),
    assistantMessageId: v.optional(v.id("messages")),
    generatedFileId: v.optional(v.id("generatedFiles")),
    generationKey: v.string(),
    baseVersionId: v.id("documentVersions"),
    currentVersionId: v.id("documentVersions"),
    status: documentEditBatchStatus,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_document", ["documentId", "createdAt"])
    .index("by_generation", ["generationKey"])
    .index("by_generation_document", ["generationKey", "documentId"])
    .index("by_message", ["assistantMessageId"])
    .index("by_user", ["userId", "createdAt"]),

  documentEdits: defineTable({
    userId: v.string(),
    documentId: v.id("documents"),
    batchId: v.id("documentEditBatches"),
    assistantMessageId: v.optional(v.id("messages")),
    introducedVersionId: v.id("documentVersions"),
    preResolutionVersionId: v.optional(v.id("documentVersions")),
    resolvedVersionId: v.optional(v.id("documentVersions")),
    changeId: v.string(),
    delWId: v.optional(v.string()),
    insWId: v.optional(v.string()),
    deletedText: v.string(),
    insertedText: v.string(),
    contextBefore: v.optional(v.string()),
    contextAfter: v.optional(v.string()),
    reason: v.optional(v.string()),
    status: documentEditStatus,
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.string()),
  })
    .index("by_document", ["documentId", "createdAt"])
    .index("by_batch", ["batchId", "createdAt"])
    .index("by_introduced_version", ["introducedVersionId", "createdAt"])
    .index("by_resolved_version", ["resolvedVersionId", "createdAt"])
    .index("by_message", ["assistantMessageId"])
    .index("by_status", ["documentId", "status"])
    .index("by_user", ["userId", "createdAt"]),

  streamingMessages: defineTable({
    userId: v.optional(v.string()),
    messageId: v.id("messages"),
    chatId: v.id("chats"),
    content: v.string(),
    reasoning: v.optional(v.string()),
    status: messageStatus,
    toolCalls: v.optional(v.array(recordedToolCall)),
    activeToolCallIds: v.optional(v.array(v.string())),
    toolResults: v.optional(
      v.array(
        v.object({
          toolCallId: v.string(),
          toolName: v.string(),
          result: v.string(),
          isError: v.optional(v.boolean()),
        }),
      ),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_user", ["userId", "updatedAt"])
    .index("by_chat", ["chatId", "updatedAt"]),

  generationJobs: defineTable({
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    streamingMessageId: v.optional(v.id("streamingMessages")),
    userId: v.string(),
    modelId: v.string(),
    status: generationJobStatus,
    error: v.optional(v.string()),
    sourceJobId: v.optional(v.id("scheduledJobs")),
    sourceExecutionId: v.optional(v.string()),
    sourceStepIndex: v.optional(v.number()),
    sourceStepTitle: v.optional(v.string()),
    openrouterGenerationId: v.optional(v.string()),
    analytics: v.optional(generationJobAnalyticsMetadata),
    analyticsSource: v.optional(generationJobAnalyticsSource),
    terminalErrorCode: v.optional(terminalErrorCode),
    startedAt: v.optional(v.number()),
    analyticsStartedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    executionRunId: v.optional(v.id("executionRuns")),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_chat_status", ["chatId", "status"])
    .index("by_user_status", ["userId", "status"])
    .index("by_status", ["status", "createdAt"]),

  generationContinuations: defineTable({
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    userId: v.string(),
    status: generationContinuationStatus,
    participantSnapshot: v.any(),
    groupSnapshot: v.any(),
    checkpointVersion: v.optional(v.union(v.literal("v1"), v.literal("v2"))),
    assembledCheckpoint: v.optional(v.any()),
    requestMessages: v.any(),
    usage: v.optional(usageObject),
    toolCalls: v.optional(v.array(recordedToolCall)),
    toolResults: v.optional(
      v.array(
        v.object({
          toolCallId: v.string(),
          toolName: v.string(),
          result: v.string(),
          isError: v.optional(v.boolean()),
        }),
      ),
    ),
    activeProfiles: v.array(v.string()),
    loadedSkills: v.optional(loadedSkillStates),
    compactionCount: v.number(),
    continuationCount: v.number(),
    partialContent: v.optional(v.string()),
    partialReasoning: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    claimedAt: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    claimantId: v.optional(v.string()),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    roundKey: v.optional(v.string()),
    deferredResumeEventId: v.optional(v.string()),
    deferredOwnership: v.optional(v.union(
      v.object({
        kind: v.literal("subagents"),
        batchId: v.id("subagentBatches"),
      }),
      v.object({
        kind: v.literal("presentation"),
        projectId: v.id("presentationProjects"),
        toolCallId: v.string(),
        modelId: v.string(),
        requireZdrOverride: v.optional(v.boolean()),
      }),
      v.object({
        kind: v.literal("analytics"),
        analyticsRunId: v.id("analyticsWorkflowRuns"),
      }),
      v.object({
        kind: v.literal("drive_picker"),
        batchId: v.id("drivePickerBatches"),
      }),
      v.object({
        kind: v.literal("remote_mcp"),
        invocationId: v.id("mcpInvocations"),
        toolCallId: v.string(),
      }),
    )),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_user", ["userId", "updatedAt"])
    .index("by_status", ["status", "updatedAt"])
    .index("by_chat", ["chatId", "updatedAt"]),

  generationRoundJournal: defineTable({
    jobId: v.id("generationJobs"),
    chatId: v.id("chats"),
    userId: v.string(),
    roundKey: v.string(),
    workflowId: v.string(),
    eventOffset: v.optional(v.string()),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    phase: v.union(
      v.literal("pre_dispatch"),
      v.literal("dispatched"),
      v.literal("committed"),
      v.literal("outcome_unknown"),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job_round", ["jobId", "roundKey"])
    .index("by_job_updated", ["jobId", "updatedAt"])
    .index("by_job_workflow_updated", ["jobId", "workflowId", "updatedAt"])
    .index("by_chat_updated", ["chatId", "updatedAt"])
    .index("by_user", ["userId", "updatedAt"]),

  toolExecutionArtifacts: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    captureKey: v.optional(v.string()),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    branchRootMessageId: v.optional(v.id("messages")),
    sourceUserMessageId: v.optional(v.id("messages")),
    multiModelGroupId: v.optional(v.string()),
    runtimeKind: v.optional(runtimeKind),
    subagentBatchId: v.optional(v.id("subagentBatches")),
    subagentRunId: v.optional(v.id("subagentRuns")),
    parentMessageId: v.optional(v.id("messages")),
    parentJobId: v.optional(v.id("generationJobs")),
    parentToolCallId: v.optional(v.string()),
    promotionDecision: v.optional(promotionDecision),
    visibilityScope: runtimeVisibilityScope,
    ownerParticipantId: v.optional(v.string()),
    ownerModelRunId: v.optional(v.string()),
    sharedWithParticipants: v.optional(v.array(v.string())),
    runtimeIsolationPolicy,
    toolCallId: v.string(),
    toolName: v.string(),
    round: v.number(),
    argumentsRaw: v.optional(v.string()),
    argumentsHash: v.string(),
    argumentsBytes: v.number(),
    resultRaw: v.optional(v.string()),
    resultHash: v.optional(v.string()),
    resultBytes: v.optional(v.number()),
    argumentsStorageId: v.optional(v.id("_storage")),
    resultStorageId: v.optional(v.id("_storage")),
    status: toolArtifactStatus,
    isError: v.optional(v.boolean()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    deferredKind: v.optional(deferredToolKind),
    provider: v.optional(v.string()),
    runtime: v.optional(v.string()),
    integrationId: v.optional(v.string()),
    skillIds: v.optional(v.array(v.id("skills"))),
    activeProfiles: v.optional(v.array(v.string())),
    privacyClassification,
    contextClass,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_message", ["messageId", "createdAt"])
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_job", ["jobId", "createdAt"])
    .index("by_job_capture", ["jobId", "captureKey"])
    .index("by_tool_call", ["toolCallId"])
    .index("by_user_status", ["userId", "status", "updatedAt"]),

  toolMemories: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    branchScope: toolMemoryBranchScope,
    runtimeKind: v.optional(runtimeKind),
    subagentBatchId: v.optional(v.id("subagentBatches")),
    subagentRunId: v.optional(v.id("subagentRuns")),
    parentMessageId: v.optional(v.id("messages")),
    parentJobId: v.optional(v.id("generationJobs")),
    parentToolCallId: v.optional(v.string()),
    promotionDecision: v.optional(promotionDecision),
    visibilityScope: runtimeVisibilityScope,
    ownerParticipantId: v.optional(v.string()),
    ownerModelRunId: v.optional(v.string()),
    sharedWithParticipants: v.optional(v.array(v.string())),
    runtimeIsolationPolicy,
    kind: toolMemoryKind,
    contextClass,
    promotionPolicy,
    summary: v.string(),
    structuredPayload: v.optional(v.any()),
    artifactIds: v.array(v.id("toolExecutionArtifacts")),
    sourceArtifactIds: v.array(v.id("toolExecutionArtifacts")),
    sourceToolNames: v.array(v.string()),
    confidence: v.number(),
    confidenceSource,
    confidenceRationale: v.optional(v.string()),
    ambiguities: v.optional(v.array(v.string())),
    limitations: v.optional(v.array(v.string())),
    privacyClassification,
    freshnessClass,
    observedAt: v.number(),
    staleAfter: v.optional(v.number()),
    confidenceDecayCurve: v.optional(confidenceDecayCurve),
    requiresRevalidation: v.boolean(),
    provenanceLocators: v.optional(v.any()),
    revalidationToolNames: v.optional(v.array(v.string())),
    lastResolvedAt: v.optional(v.number()),
    lastResolutionStatus: v.optional(provenanceResolutionStatus),
    repairAttempts: v.optional(v.number()),
    conflictsWith: v.optional(v.array(v.id("toolMemories"))),
    supersedes: v.optional(v.array(v.id("toolMemories"))),
    supersededBy: v.optional(v.array(v.id("toolMemories"))),
    lineageEdges: v.optional(v.array(lineageEdge)),
    invalidatedBy: v.optional(v.array(v.id("toolMemories"))),
    partiallyInvalidatedFields: v.optional(v.array(v.string())),
    assemblyPriority: v.optional(assemblyPriority),
    costPolicy: v.optional(assemblyCostPolicy),
    expiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_message", ["messageId", "createdAt"])
    .index("by_chat", ["chatId", "updatedAt"])
    .index("by_user_kind", ["userId", "kind", "updatedAt"]),

  contextAssemblyLogs: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    jobId: v.id("generationJobs"),
    visibilityScope: runtimeVisibilityScope,
    ownerParticipantId: v.optional(v.string()),
    ownerModelRunId: v.optional(v.string()),
    runtimeKind: v.optional(runtimeKind),
    subagentBatchId: v.optional(v.id("subagentBatches")),
    subagentRunId: v.optional(v.id("subagentRuns")),
    parentMessageId: v.optional(v.id("messages")),
    parentJobId: v.optional(v.id("generationJobs")),
    parentToolCallId: v.optional(v.string()),
    promotionDecision: v.optional(promotionDecision),
    mode: contextAssemblyMode,
    legacyMessageCount: v.number(),
    assembledMessageCount: v.number(),
    legacyEstimatedTokens: v.number(),
    assembledEstimatedTokens: v.number(),
    rawArtifactCount: v.number(),
    memoryCount: v.number(),
    rehydratedArtifactCount: v.number(),
    rehydratedArtifactBytes: v.optional(v.number()),
    storageRehydrationMs: v.optional(v.number()),
    provenanceRepairMs: v.optional(v.number()),
    provenanceRepairAttempts: v.optional(v.number()),
    safetyMismatches: v.array(v.string()),
    toolSelectionDrift: v.boolean(),
    retryDivergence: v.boolean(),
    branchDivergence: v.boolean(),
    memoryInclusionDivergence: v.boolean(),
    providerRoutingDivergence: v.boolean(),
    resolvedPolicyVersion: v.optional(v.string()),
    resolvedPolicySummary: v.optional(v.string()),
    excludedReasonCounts: v.optional(v.any()),
    graphCandidateCount: v.optional(v.number()),
    graphSelectedCount: v.optional(v.number()),
    graphQueryMs: v.optional(v.number()),
    policyEvaluationMs: v.optional(v.number()),
    serializationMs: v.optional(v.number()),
    automatedJudgement: v.optional(v.any()),
    decisionSummary: v.string(),
    createdAt: v.number(),
  })
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_message", ["messageId", "createdAt"])
    .index("by_user", ["userId", "createdAt"]),

  autonomousSessions: defineTable({
    chatId: v.id("chats"),
    userId: v.string(),
    status: autonomousStatus,
    currentCycle: v.number(),
    maxCycles: v.number(),
    currentParticipantIndex: v.optional(v.number()),
    turnOrder: v.array(v.string()),
    moderatorParticipantId: v.optional(v.string()),
    autoStopOnConsensus: v.boolean(),
    pauseBetweenTurns: v.number(),
    parentMessageIds: v.array(v.id("messages")),
    stopReason: v.optional(v.string()),
    error: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    executionRunId: v.optional(v.id("executionRuns")),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    executionClaimantId: v.optional(v.string()),
    executionEpoch: v.optional(v.number()),
    activeTurnCycle: v.optional(v.number()),
    activeTurnParticipantIndex: v.optional(v.number()),
    activeTurnExecutionEpoch: v.optional(v.number()),
    activeTurnMessageId: v.optional(v.id("messages")),
    activeTurnJobId: v.optional(v.id("generationJobs")),
    lastSettledTurnCycle: v.optional(v.number()),
    lastSettledTurnParticipantIndex: v.optional(v.number()),
    lastSettledTurnExecutionEpoch: v.optional(v.number()),
    lastSettledTurnOutcome: v.optional(v.union(
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    )),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_chat", ["chatId"])
    .index("by_chat_status", ["chatId", "status"])
    .index("by_user_status", ["userId", "status"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_execution_run", ["executionRunId"])
    .index("by_user_created", ["userId", "createdAt"]),

  // M9 — Internet Search: search session progress beacon
  searchSessions: defineTable({
    chatId: v.id("chats"),
    userId: v.string(),
    assistantMessageId: v.id("messages"),
    query: v.string(),
    mode: v.union(v.literal("web"), v.literal("paper")),
    complexity: v.number(),
    status: searchSessionStatus,
    progress: v.number(),
    currentPhase: v.string(),
    phaseOrder: v.number(),
    participantId: v.optional(v.id("personas")),
    workflowId: v.optional(v.string()),
    executionRunId: v.optional(v.id("executionRuns")),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    executionClaimantId: v.optional(v.string()),
    generationHandoffOperationId: v.optional(v.string()),
    generationHandoffAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    // M9.5 — Per-session cost telemetry
    searchCallCount: v.optional(v.number()),
    perplexityModelTier: v.optional(v.string()),
    participantCount: v.optional(v.number()),
  })
    .index("by_chat", ["chatId"])
    .index("by_user", ["userId", "startedAt"])
    .index("by_message", ["assistantMessageId"])
    .index("by_execution_run", ["executionRunId"])
    .index("by_status_started", ["status", "startedAt"]),

  // M9 — Internet Search: cached search payloads keyed by assistant message.
  // Kept out of `messages` to avoid re-sending large payloads on chat subscriptions.
  searchContexts: defineTable({
    messageId: v.id("messages"),
    chatId: v.id("chats"),
    userId: v.string(),
    mode: v.union(v.literal("web"), v.literal("paper")),
    payload: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_chat", ["chatId"])
    .index("by_user", ["userId", "updatedAt"]),

  // M9 — Internet Search: intermediate results for Research Paper pipeline
  searchPhases: defineTable({
    sessionId: v.id("searchSessions"),
    phaseType: searchPhaseType,
    phaseOrder: v.number(),
    iteration: v.optional(v.number()),
    status: searchPhaseStatus,
    data: v.any(),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_session", ["sessionId", "phaseOrder"]),

  // M10 — Generated Files: links tool-generated documents to messages
  generatedFiles: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    toolName: v.string(),
    documentId: v.optional(v.id("documents")),
    documentVersionId: v.optional(v.id("documentVersions")),
    presentationProjectId: v.optional(v.id("presentationProjects")),
    presentationRevision: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_chat", ["chatId"])
    .index("by_message", ["messageId"])
    .index("by_storage", ["storageId"])
    .index("by_document", ["documentId"])
    .index("by_document_version", ["documentVersionId"])
    .index("by_presentation_project", ["presentationProjectId", "createdAt"]),

  googleDriveFileGrants: defineTable({
    userId: v.string(),
    fileId: v.string(),
    name: v.string(),
    mimeType: v.string(),
    webViewLink: v.optional(v.string()),
    size: v.optional(v.string()),
    grantedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    // Cached ingest of Drive file bytes into Convex storage. Lets the model
    // operate on the file via the standard attachment pipeline (read_pdf,
    // image preview, etc.) without re-downloading on every turn.
    cachedStorageId: v.optional(v.id("_storage")),
    // Drive's `modifiedTime` (RFC 3339) at the time we ingested. If Drive
    // reports a newer value on a later turn, we re-ingest and replace.
    cachedModifiedTime: v.optional(v.string()),
    cachedSizeBytes: v.optional(v.number()),
    cachedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "grantedAt"])
    .index("by_user_file", ["userId", "fileId"])
    .index("by_user_cached_storage", ["userId", "cachedStorageId"]),

  generatedCharts: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    toolName: v.string(),
    chartType: v.union(
      v.literal("line"),
      v.literal("bar"),
      v.literal("scatter"),
      v.literal("pie"),
      v.literal("box"),
      v.literal("png_image"),
    ),
    title: v.optional(v.string()),
    xLabel: v.optional(v.string()),
    yLabel: v.optional(v.string()),
    xUnit: v.optional(v.string()),
    yUnit: v.optional(v.string()),
    elements: v.any(),
    pngBase64: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_message", ["messageId", "createdAt"]),

  // M10 — Uploaded file attachment lookup: denormalized index for KB queries.
  // Populated when user messages with storage-backed attachments are created.
  // Avoids O(chats × messages) scans for Knowledge Base listing & deletion.
  //
  // M24 Phase 6 — `chatId` and `messageId` are now optional so KB-only entries
  // (Settings KB upload, Drive imports) can live in this table without being
  // tied to a specific chat message. `driveFileId` is set for rows imported
  // from Google Drive; presence of that field is what `source: "drive"` is
  // derived from at read time. `lastRefreshedAt` tracks the most recent
  // Drive `modifiedTime` re-check (lazy refresh on tool/storage read).
  fileAttachments: defineTable({
    userId: v.string(),
    chatId: v.optional(v.id("chats")),
    messageId: v.optional(v.id("messages")),
    storageId: v.id("_storage"),
    filename: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    createdAt: v.number(),
    driveFileId: v.optional(v.string()),
    lastRefreshedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_storage", ["storageId"])
    .index("by_chat", ["chatId"])
    .index("by_message", ["messageId"])
    .index("by_user_drive_file", ["userId", "driveFileId"]),

  kbUploadSessions: defineTable({
    userId: v.string(),
    storageId: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("pending"),
      v.literal("consumed"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_storage", ["userId", "storageId"]),

  chatUploadSessions: defineTable({
    userId: v.string(),
    storageId: v.optional(v.id("_storage")),
    status: v.union(
      v.literal("pending"),
      v.literal("consumed"),
      v.literal("cancelled"),
    ),
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_storage", ["userId", "storageId"])
    .index("by_status_createdAt", ["status", "createdAt"]),

  subagentBatches: defineTable({
    parentMessageId: v.id("messages"),
    sourceUserMessageId: v.id("messages"),
    parentJobId: v.id("generationJobs"),
    chatId: v.id("chats"),
    userId: v.string(),
    status: subagentBatchStatus,
    toolCallId: v.string(),
    toolCallArguments: v.string(),
    toolRoundCalls: v.any(),
    toolRoundResults: v.any(),
    childConversationSeed: v.any(),
    resumeConversationSeed: v.any(),
    paramsSnapshot: v.any(),
    workflowResumeEventId: v.optional(v.string()),
    participantSnapshot: v.any(),
    childCount: v.number(),
    completedChildCount: v.number(),
    failedChildCount: v.number(),
    continuationScheduledAt: v.optional(v.number()),
    parentRecoveryScheduledAt: v.optional(v.number()),
    parentRecoveryGateAt: v.optional(v.number()),
    resumeDeliveredEventId: v.optional(v.string()),
    resumeDeliveredAt: v.optional(v.number()),
    m38ResumeMetadata: v.optional(v.any()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_parent_message", ["parentMessageId"])
    .index("by_parent_job", ["parentJobId"])
    .index("by_parent_job_resume_event", ["parentJobId", "workflowResumeEventId"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_user", ["userId", "updatedAt"])
    .index("by_chat", ["chatId"]),

  subagentRuns: defineTable({
    batchId: v.id("subagentBatches"),
    childIndex: v.number(),
    title: v.string(),
    taskPrompt: v.string(),
    status: subagentRunStatus,
    content: v.optional(v.string()),
    reasoning: v.optional(v.string()),
    usage: v.optional(usageObject),
    toolCalls: v.optional(v.array(recordedToolCall)),
    toolResults: v.optional(
      v.array(
        v.object({
          toolCallId: v.string(),
          toolName: v.string(),
          result: v.string(),
          isError: v.optional(v.boolean()),
        }),
      ),
    ),
    generatedFiles: v.optional(
      v.array(
        v.object({
          storageId: v.id("_storage"),
          filename: v.string(),
          mimeType: v.string(),
          sizeBytes: v.optional(v.number()),
          toolName: v.string(),
        }),
      ),
    ),
    generatedCharts: v.optional(
      v.array(
        v.object({
          toolName: v.string(),
          chartType: v.union(
            v.literal("line"),
            v.literal("bar"),
            v.literal("scatter"),
            v.literal("pie"),
            v.literal("box"),
            v.literal("png_image"),
          ),
          title: v.optional(v.string()),
          xLabel: v.optional(v.string()),
          yLabel: v.optional(v.string()),
          xUnit: v.optional(v.string()),
          yUnit: v.optional(v.string()),
          elements: v.any(),
          pngBase64: v.optional(v.string()),
        }),
      ),
    ),
    summaryPayload: v.optional(v.any()),
    conversationSnapshot: v.optional(v.any()),
    continuationCount: v.optional(v.number()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    analyticsStartedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    workpoolOperationId: v.optional(v.string()),
    workflowId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_batch", ["batchId", "childIndex"])
    .index("by_status", ["status", "updatedAt"]),

  // ── M29: Video Generation ─────────────────────────────────────────

  /** Tracks async video generation polling state. */
  videoJobs: defineTable({
    messageId: v.id("messages"),
    chatId: v.id("chats"),
    userId: v.string(),
    openRouterJobId: v.string(),
    outputUploadId: v.optional(v.id("videoOutputUploads")),
    status: videoJobStatus,
    model: v.string(),
    prompt: v.string(),
    videoConfig: v.optional(
      v.object({
        resolution: v.optional(v.string()),
        aspectRatio: v.optional(v.string()),
        duration: v.optional(v.number()),
        generateAudio: v.optional(v.boolean()),
      }),
    ),
    error: v.optional(v.string()),
    lastPolledAt: v.optional(v.number()),
    pollCount: v.number(),
    executionRunId: v.optional(v.id("executionRuns")),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    cancellationRequestedAt: v.optional(v.number()),
    providerTerminalAt: v.optional(v.number()),
    providerTerminalStatus: v.optional(v.union(
      v.literal("completed"),
      v.literal("failed"),
    )),
    createdAt: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_status_createdAt", ["status", "createdAt"]),

  /** Tracks provider uploads for ZDR video models that cannot return hosted output URLs. */
  videoOutputUploads: defineTable({
    tokenHash: v.string(),
    messageId: v.id("messages"),
    chatId: v.id("chats"),
    userId: v.string(),
    status: v.union(v.literal("pending"), v.literal("uploaded")),
    storageId: v.optional(v.id("_storage")),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    createdAt: v.number(),
    expiresAt: v.number(),
    uploadedAt: v.optional(v.number()),
    executionRunId: v.optional(v.id("executionRuns")),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_chat", ["chatId", "createdAt"])
    .index("by_user", ["userId", "createdAt"])
    .index("by_messageId", ["messageId"]),

  /** Surfaces generated images and videos in Knowledge Base. */
  generatedMedia: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    storageId: v.id("_storage"),
    type: generatedMediaType,
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    durationSeconds: v.optional(v.number()),
    model: v.optional(v.string()),
    prompt: v.optional(v.string()),
    referenceTrackingVersion: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_chatId", ["chatId"])
    .index("by_messageId", ["messageId"])
    .index("by_storageId", ["storageId"]),

  /**
   * Drive picker resume batches. Created when `drive_list` defers because the
   * user has no Drive grants yet; resolved when the picker callback fires
   * `attachPickedDriveFiles`. Mirrors `subagentBatches` but without children.
   */
  drivePickerBatches: defineTable({
    parentMessageId: v.id("messages"),
    sourceUserMessageId: v.id("messages"),
    parentJobId: v.id("generationJobs"),
    chatId: v.id("chats"),
    userId: v.string(),
    status: drivePickerBatchStatus,
    toolCallId: v.string(),
    toolCallArguments: v.string(),
    toolRoundCalls: v.any(),
    toolRoundResults: v.any(),
    resumeConversationSeed: v.any(),
    paramsSnapshot: v.any(),
    workflowResumeEventId: v.optional(v.string()),
    workflowResumeSignaledEventId: v.optional(v.string()),
    workflowResumeSignaledAt: v.optional(v.number()),
    participantSnapshot: v.any(),
    pickedFileIds: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_parent_message", ["parentMessageId"])
    .index("by_parent_job", ["parentJobId"])
    .index("by_parent_job_status", ["parentJobId", "status", "updatedAt"])
    .index("by_parent_job_resume_event", ["parentJobId", "workflowResumeEventId"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_user", ["userId", "updatedAt"])
    .index("by_chat", ["chatId"]),
};
