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
  documentEvent,
  documentExtractionStatus,
  documentSource,
  documentStatus,
  documentSyncState,
  documentVersionSource,
  terminalErrorCode,
  usageObject,
  videoJobStatus,
  skillOverrideEntry,
  integrationOverrideEntry,
  retryContract,
} from "./schema_validators";

export const coreSchemaTables = {
  chats: defineTable({
    userId: v.string(),
    title: v.optional(v.string()),
    mode: chatMode,
    folderId: v.optional(v.string()),
    isDeleting: v.optional(v.boolean()),
    deletingAt: v.optional(v.number()),
    isPinned: v.optional(v.boolean()),
    pinnedAt: v.optional(v.number()),
    activeBranchLeafId: v.optional(v.id("messages")),
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
    searchModeOverride: v.optional(v.string()),        // "basic" | "web" | "paper"
    searchComplexityOverride: v.optional(v.number()),   // 1 | 2 | 3
    autoAudioResponseOverride: v.optional(v.union(
      v.literal("enabled"),
      v.literal("disabled"),
    )),
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
    .index("by_user_subagent_override", ["userId", "subagentOverride"])
    .index("by_source_job", ["sourceJobId"]),

  chatParticipants: defineTable({
    chatId: v.id("chats"),
    userId: v.string(),
    modelId: v.string(),
    personaId: v.optional(v.id("personas")),
    personaName: v.optional(v.string()),
    personaEmoji: v.optional(v.string()),
    personaAvatarImageUrl: v.optional(v.string()),
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
    toolCalls: v.optional(v.array(v.object({
      id: v.string(),           // Tool call ID from OpenRouter
      name: v.string(),         // Tool function name
      arguments: v.string(),    // JSON-stringified arguments
    }))),
    toolResults: v.optional(v.array(v.object({
      toolCallId: v.string(),   // Matches toolCalls[].id
      toolName: v.string(),     // Tool function name (denormalized for display)
      result: v.string(),       // JSON-stringified result (truncated)
      isError: v.optional(v.boolean()),
    }))),
    generatedFileIds: v.optional(v.array(v.id("generatedFiles"))),
    generatedChartIds: v.optional(v.array(v.id("generatedCharts"))),
    // Perplexity citation annotations (structured for rich UI rendering)
    citations: v.optional(v.array(v.object({
      url: v.string(),
      title: v.string(),
    }))),
    // M32 — Document Workspace citations. Separate from web-search URL citations.
    documentCitations: v.optional(v.array(documentCitation)),
    // M33 — First-class generated/updated document cards.
    documentEvents: v.optional(v.array(documentEvent)),
    subagentsEnabled: v.optional(v.boolean()),
    subagentBatchId: v.optional(v.id("subagentBatches")),
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

  streamingMessages: defineTable({
    messageId: v.id("messages"),
    chatId: v.id("chats"),
    content: v.string(),
    reasoning: v.optional(v.string()),
    status: messageStatus,
    toolCalls: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      arguments: v.string(),
    }))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_message", ["messageId"])
    .index("by_chat", ["chatId", "updatedAt"]),

  generationJobs: defineTable({
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    streamingMessageId: v.optional(v.id("streamingMessages")),
    userId: v.string(),
    modelId: v.string(),
    status: generationJobStatus,
    error: v.optional(v.string()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    sourceJobId: v.optional(v.id("scheduledJobs")),
    sourceExecutionId: v.optional(v.string()),
    sourceStepIndex: v.optional(v.number()),
    sourceStepTitle: v.optional(v.string()),
    openrouterGenerationId: v.optional(v.string()),
    terminalErrorCode: v.optional(terminalErrorCode),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
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
    requestMessages: v.any(),
    usage: v.optional(usageObject),
    toolCalls: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      arguments: v.string(),
    }))),
    toolResults: v.optional(v.array(v.object({
      toolCallId: v.string(),
      toolName: v.string(),
      result: v.string(),
      isError: v.optional(v.boolean()),
    }))),
    activeProfiles: v.array(v.string()),
    loadedSkills: v.optional(loadedSkillStates),
    compactionCount: v.number(),
    continuationCount: v.number(),
    partialContent: v.optional(v.string()),
    partialReasoning: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    claimedAt: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_job", ["jobId"])
    .index("by_status", ["status", "updatedAt"])
    .index("by_chat", ["chatId", "updatedAt"]),

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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_chat", ["chatId"])
    .index("by_chat_status", ["chatId", "status"])
    .index("by_user_status", ["userId", "status"])
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
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_chat", ["chatId"])
    .index("by_message", ["messageId"])
    .index("by_storage", ["storageId"])
    .index("by_document", ["documentId"])
    .index("by_document_version", ["documentVersionId"]),

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
    participantSnapshot: v.any(),
    childCount: v.number(),
    completedChildCount: v.number(),
    failedChildCount: v.number(),
    continuationScheduledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_parent_message", ["parentMessageId"])
    .index("by_parent_job", ["parentJobId"])
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
    toolCalls: v.optional(v.array(v.object({
      id: v.string(),
      name: v.string(),
      arguments: v.string(),
    }))),
    toolResults: v.optional(v.array(v.object({
      toolCallId: v.string(),
      toolName: v.string(),
      result: v.string(),
      isError: v.optional(v.boolean()),
    }))),
    generatedFiles: v.optional(v.array(v.object({
      storageId: v.id("_storage"),
      filename: v.string(),
      mimeType: v.string(),
      sizeBytes: v.optional(v.number()),
      toolName: v.string(),
    }))),
    generatedCharts: v.optional(v.array(v.object({
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
    }))),
    summaryPayload: v.optional(v.any()),
    conversationSnapshot: v.optional(v.any()),
    continuationCount: v.optional(v.number()),
    error: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
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
    pollingUrl: v.string(),
    status: videoJobStatus,
    model: v.string(),
    prompt: v.string(),
    videoConfig: v.optional(v.object({
      resolution: v.optional(v.string()),
      aspectRatio: v.optional(v.string()),
      duration: v.optional(v.number()),
      generateAudio: v.optional(v.boolean()),
    })),
    error: v.optional(v.string()),
    lastPolledAt: v.optional(v.number()),
    pollCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_messageId", ["messageId"])
    .index("by_status_createdAt", ["status", "createdAt"]),

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
    participantSnapshot: v.any(),
    pickedFileIds: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_parent_message", ["parentMessageId"])
    .index("by_parent_job", ["parentJobId"])
    .index("by_user", ["userId", "updatedAt"])
    .index("by_chat", ["chatId"]),
};
