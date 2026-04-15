import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  scheduledJobStatus,
  scheduledJobRecurrence,
  jobRunStatus,
  scheduledJobStep,
  purchasePlatform,
  purchaseSource,
  purchaseEntitlementStatus,
  pushPlatform,
  pushProvider,
} from "./schema_validators";

export const userSchemaTables = {
  // ── Favorites: quick-launch model/persona/group shortcuts ───────────
  favorites: defineTable({
    userId: v.string(),
    name: v.string(),
    /** Model IDs in this favorite (1 = single model, 2-3 = group). */
    modelIds: v.array(v.string()),
    /** Optional persona for single-model favorites. */
    personaId: v.optional(v.id("personas")),
    personaName: v.optional(v.string()),
    personaEmoji: v.optional(v.string()),
    personaAvatarImageUrl: v.optional(v.string()),
    /** User-defined display order (lower = first). */
    sortOrder: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "sortOrder"]),

  folders: defineTable({
    userId: v.string(),
    name: v.string(),
    color: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId", "sortOrder"]),

  userPreferences: defineTable({
    userId: v.string(),
    defaultModelId: v.optional(v.string()),
    defaultPersonaId: v.optional(v.id("personas")),
    sendOnEnter: v.boolean(),
    showReasoning: v.boolean(),
    hapticFeedback: v.boolean(),
    appearanceMode: v.string(),
    colorTheme: v.optional(v.union(
      v.literal("vibrant"),
      v.literal("highContrast"),
      v.literal("teal"),
      v.literal("lilac"),
    )),
    defaultTemperature: v.optional(v.number()),
    defaultMaxTokens: v.optional(v.number()),
    includeReasoning: v.optional(v.boolean()),
    reasoningEffort: v.optional(v.string()),
    pickerFilterFree: v.boolean(),
    pickerFilterExcludeFree: v.optional(v.boolean()),
    pickerFilterVision: v.boolean(),
    pickerFilterImageGen: v.boolean(),
    pickerFilterTools: v.boolean(),
    pickerSortPrimaryKey: v.optional(v.union(
      v.literal("recommended"),
      v.literal("coding"),
      v.literal("research"),
      v.literal("fast"),
      v.literal("value"),
      v.literal("image"),
      v.literal("price"),
      v.literal("context"),
    )),
    pickerSortPrimaryDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    pickerSortSecondaryKey: v.optional(v.union(
      v.literal("recommended"),
      v.literal("coding"),
      v.literal("research"),
      v.literal("fast"),
      v.literal("value"),
      v.literal("image"),
      v.literal("price"),
      v.literal("context"),
    )),
    pickerSortSecondaryDirection: v.optional(v.union(v.literal("asc"), v.literal("desc"))),
    webSearchEnabledByDefault: v.boolean(),
    subagentsEnabledByDefault: v.optional(v.boolean()),
    chatCompletionNotificationsEnabled: v.optional(v.boolean()),
    defaultSearchMode: v.optional(v.string()), // "basic" | "web" | "paper"
    defaultSearchComplexity: v.optional(v.number()), // 1 | 2 | 3
    autoAudioResponse: v.optional(v.boolean()),
    preferredVoice: v.optional(v.string()),
    defaultAudioSpeed: v.optional(v.number()), // 1 | 1.5 | 2
    isMemoryEnabled: v.boolean(),
    memoryGatingMode: v.string(),
    memoryExtractionModelId: v.optional(v.string()),
    titleModelId: v.optional(v.string()),
    disabledProviders: v.optional(v.array(v.string())),
    onboardingCompleted: v.optional(v.boolean()),
    hasSeenIdeascapeHelp: v.optional(v.boolean()),
    hasSeenMainWalkthrough: v.optional(v.boolean()),
    showBalanceInChat: v.optional(v.boolean()),
    showAdvancedStats: v.optional(v.boolean()), // M23: per-message cost display
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  modelSettings: defineTable({
    userId: v.string(),
    openRouterId: v.string(),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    includeReasoning: v.optional(v.boolean()),
    reasoningEffort: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_model", ["userId", "openRouterId"]),

  nodePositions: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    x: v.number(),
    y: v.number(),
    width: v.number(),
    height: v.number(),
  })
    .index("by_chat", ["chatId"])
    .index("by_chat_message", ["chatId", "messageId"]),

  // Connection credentials for third-party integrations (Google, Microsoft, etc.)
  oauthConnections: defineTable({
    userId: v.string(),
    provider: v.string(), // "google" | "microsoft" | "notion" | "apple_calendar"
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(), // Unix timestamp (ms) when accessToken expires
    scopes: v.array(v.string()),
    email: v.optional(v.string()),
    displayName: v.optional(v.string()),
    workspaceId: v.optional(v.string()),
    workspaceName: v.optional(v.string()),
    clientType: v.optional(v.string()),
    status: v.string(), // "active" | "expired" | "revoked" | "error"
    connectedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    // Timestamp (ms) of the last successful token refresh. Used as a
    // compare-and-swap guard to prevent parallel tool executions from
    // racing on refresh — see Bug H-2.
    lastRefreshedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_provider", ["userId", "provider"])
    .index("by_status", ["status"]),

  // Per-user/provider outbound request coordination for integration APIs.
  integrationRequestGates: defineTable({
    userId: v.string(),
    provider: v.string(),
    activeRequestId: v.optional(v.string()),
    activeLeaseExpiresAt: v.optional(v.number()),
    nextAllowedAt: v.optional(v.number()),
    lastRequestStartedAt: v.optional(v.number()),
    lastRequestFinishedAt: v.optional(v.number()),
    lastResponseStatus: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_user_provider", ["userId", "provider"])
    .index("by_provider", ["provider", "updatedAt"]),



  purchaseEntitlements: defineTable({
    userId: v.string(),
    platform: purchasePlatform,
    source: purchaseSource,
    productId: v.string(),
    externalPurchaseId: v.string(),
    status: purchaseEntitlementStatus,
    activatedAt: v.number(),
    revokedAt: v.optional(v.number()),
    lastVerifiedAt: v.number(),
    rawEnvironment: v.optional(v.string()),
    metadata: v.optional(v.any()),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_external_purchase", ["externalPurchaseId"])
    .index("by_platform_source", ["platform", "source"]),

  // ── M13: Scheduled Jobs ──────────────────────────────────────────────

  /** User-created recurring AI tasks. */
  scheduledJobs: defineTable({
    userId: v.string(),

    // Job definition
    name: v.string(),
    prompt: v.string(),
    modelId: v.string(),
    personaId: v.optional(v.id("personas")),
    enabledIntegrations: v.optional(v.array(v.string())),
    webSearchEnabled: v.optional(v.boolean()), // Deprecated: use searchMode
    searchMode: v.optional(v.union(
      v.literal("none"),
      v.literal("basic"),
      v.literal("web"),
      v.literal("research"),
    )),
    searchComplexity: v.optional(v.number()), // 1 | 2 | 3
    knowledgeBaseFileIds: v.optional(v.array(v.id("_storage"))),
    steps: v.optional(v.array(scheduledJobStep)),

    // Request parameter overrides (optional — inherits from persona or defaults)
    includeReasoning: v.optional(v.boolean()),
    reasoningEffort: v.optional(v.string()),

    // Schedule
    recurrence: scheduledJobRecurrence,
    timezone: v.optional(v.string()),
    targetFolderId: v.optional(v.id("folders")),

    // State
    status: scheduledJobStatus,
    nextRunAt: v.optional(v.number()),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    lastRunAt: v.optional(v.number()),
    lastRunChatId: v.optional(v.id("chats")),
    lastRunStatus: v.optional(jobRunStatus),
    lastRunError: v.optional(v.string()),
    consecutiveFailures: v.optional(v.number()),
    totalRuns: v.optional(v.number()),
    activeExecutionId: v.optional(v.string()),
    activeExecutionChatId: v.optional(v.id("chats")),
    activeExecutionStartedAt: v.optional(v.number()),
    activeExecutionVariables: v.optional(v.record(v.string(), v.string())),
    activeStepIndex: v.optional(v.number()),
    activeStepCount: v.optional(v.number()),
    activeUserMessageId: v.optional(v.id("messages")),
    activeAssistantMessageId: v.optional(v.id("messages")),
    activeGenerationJobId: v.optional(v.id("generationJobs")),

    // Metadata
    createdBy: v.union(v.literal("user"), v.literal("ai")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "status"])
    .index("by_user_next_run", ["userId", "nextRunAt"])
    .index("by_status", ["status", "nextRunAt"]),

  /** Per-execution run history (retained 30 days). */
  jobRuns: defineTable({
    jobId: v.id("scheduledJobs"),
    userId: v.string(),
    chatId: v.optional(v.id("chats")),
    status: jobRunStatus,
    error: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
  })
    .index("by_job", ["jobId", "startedAt"])
    .index("by_user", ["userId", "startedAt"])
    .index("by_completedAt", ["completedAt"])
    .index("by_chat", ["chatId"]),

  /** API trigger tokens for scheduled jobs (hashed at rest). */
  scheduledJobTriggerTokens: defineTable({
    userId: v.string(),
    jobId: v.id("scheduledJobs"),
    label: v.optional(v.string()),
    tokenPrefix: v.string(),
    tokenHash: v.string(),
    status: v.union(v.literal("active"), v.literal("revoked")),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "status"])
    .index("by_job", ["jobId", "status"])
    .index("by_token_hash", ["tokenHash"]),

  /** Audit log for scheduled-job API trigger attempts and outcomes. */
  scheduledJobApiInvocations: defineTable({
    userId: v.string(),
    jobId: v.id("scheduledJobs"),
    tokenId: v.optional(v.id("scheduledJobTriggerTokens")),
    requestId: v.string(),
    idempotencyKey: v.optional(v.string()),
    status: v.union(
      v.literal("triggered"),
      v.literal("duplicate"),
      v.literal("throttled"),
      v.literal("unauthorized"),
      v.literal("not_found"),
      v.literal("error"),
    ),
    variables: v.optional(v.record(v.string(), v.string())),
    scheduledFunctionId: v.optional(v.id("_scheduled_functions")),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_job_created", ["jobId", "createdAt"])
    .index("by_job_idempotency", ["jobId", "idempotencyKey"])
    .index("by_request_id", ["requestId"]),

  /** Server-side API key storage for scheduled jobs (populated during PKCE exchange). */
  userSecrets: defineTable({
    userId: v.string(),
    apiKey: v.string(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // ── M13.5: Push Notifications ────────────────────────────────────────

  /** Provider-based device tokens for push notification delivery. */
  deviceTokens: defineTable({
    userId: v.string(),
    // Optional during migration from legacy APNs-only rows.
    // Missing values should be treated as ios/apns by consumers.
    platform: v.optional(pushPlatform),
    provider: v.optional(pushProvider),
    token: v.string(),
    subscription: v.optional(v.string()),
    environment: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["token"])
    .index("by_platform_provider", ["platform", "provider"]),
};
