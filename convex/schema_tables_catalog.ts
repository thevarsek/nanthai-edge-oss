import { defineTable } from "convex/server";
import { v } from "convex/values";
import { cachedModelsTable } from "./schema_table_cached_models";
import {
  memoryRetrievalMode,
  memoryScopeType,
  memorySourceType,
  memoryType,
  skillCompilationStatus,
  skillLockState,
  skillOrigin,
  skillRuntimeMode,
  skillScope,
  skillStatus,
  storedSkillToolProfile,
  skillVisibility,
  skillOverrideEntry,
  integrationOverrideEntry,
} from "./schema_validators";

export const catalogSchemaTables = {
  // ── Sync metadata (singleton rows, one per sync job) ────────────────
  syncMeta: defineTable({
    key: v.string(), // e.g. "modelCatalog"
    contentHash: v.string(), // SHA-256 of the last-seen API response
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  personas: defineTable({
    userId: v.string(),
    displayName: v.string(),
    personaDescription: v.optional(v.string()),
    systemPrompt: v.string(),
    modelId: v.optional(v.string()),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    includeReasoning: v.optional(v.boolean()),
    reasoningEffort: v.optional(v.string()),
    avatarEmoji: v.optional(v.string()),
    avatarImageStorageId: v.optional(v.id("_storage")),
    avatarSFSymbol: v.optional(v.string()),
    avatarColor: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    // M30: Layered skill overrides (replaces discoverableSkillIds)
    skillOverrides: v.optional(v.array(skillOverrideEntry)),
    // M30: Layered integration overrides (replaces enabledIntegrations)
    integrationOverrides: v.optional(v.array(integrationOverrideEntry)),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_default", ["userId", "isDefault"]),

  memories: defineTable({
    userId: v.string(),
    content: v.string(),
    category: v.optional(v.string()),
    memoryType: v.optional(memoryType),
    retrievalMode: v.optional(memoryRetrievalMode),
    scopeType: v.optional(memoryScopeType),
    personaIds: v.optional(v.array(v.string())),
    sourceType: v.optional(memorySourceType),
    sourceFileName: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    importanceScore: v.optional(v.number()),
    confidenceScore: v.optional(v.number()),
    reinforcementCount: v.optional(v.number()),
    lastReinforcedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    isSuperseded: v.optional(v.boolean()),
    supersededByMemoryId: v.optional(v.id("memories")),
    supersedesMemoryId: v.optional(v.id("memories")),
    supersededAt: v.optional(v.number()),
    sourceMessageId: v.optional(v.id("messages")),
    sourceChatId: v.optional(v.id("chats")),
    isPinned: v.boolean(),
    isPending: v.boolean(),
    accessCount: v.number(),
    lastAccessedAt: v.optional(v.number()),
    relationshipsBuiltAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_type", ["userId", "memoryType", "createdAt"])
    .index("by_user_retrieval_mode", ["userId", "retrievalMode", "createdAt"])
    .index("by_user_pinned", ["userId", "isPinned"])
    .index("by_user_pending", ["userId", "isPending"]),

  memoryRelationships: defineTable({
    userId: v.string(),
    fromMemoryId: v.id("memories"),
    toMemoryId: v.id("memories"),
    relationType: v.union(
      v.literal("related"),
      v.literal("sameTopic"),
      v.literal("supersedes"),
    ),
    source: v.union(
      v.literal("embedding"),
      v.literal("metadata"),
      v.literal("lifecycle"),
    ),
    confidence: v.number(),
    sharedTags: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "updatedAt"])
    .index("by_user_from", ["userId", "fromMemoryId"])
    .index("by_user_to", ["userId", "toMemoryId"]),

  memoryEmbeddings: defineTable({
    memoryId: v.id("memories"),
    // userId is optional so pre-migration rows remain valid; backfillEmbeddingUserIds
    // populates it for existing rows. New inserts always include userId.
    userId: v.optional(v.string()),
    embedding: v.array(v.float64()),
  })
    .index("by_memory", ["memoryId"])
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1536,
      // userId in filterFields allows O(1) user-scoped vector search,
      // eliminating the 5x overfetch + post-filter pattern.
      filterFields: ["memoryId", "userId"],
    }),

  messageQueryEmbeddings: defineTable({
    messageId: v.id("messages"),
    userId: v.string(),
    chatId: v.optional(v.id("chats")),
    provider: v.union(v.literal("openrouter")),
    modelId: v.string(),
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    embedding: v.optional(v.array(v.float64())),
    textHash: v.string(),
    usage: v.optional(v.object({
      promptTokens: v.number(),
      totalTokens: v.number(),
    })),
    generationId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    usageRecordedAt: v.optional(v.number()),
    usageRecordedMessageId: v.optional(v.id("messages")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_message", ["messageId"]),

  // Phase 3 TTFT cache: full memory-context chain (embedding + vector search +
  // hydrate) prewarmed when the user message is inserted. Keyed by messageId.
  // `hydratedHits` stores vector seeds plus one-hop related memories so the
  // generation action can skip embedding, vector search, and graph expansion
  // entirely on the critical path. `usage`/`generationId`
  // mirror the embedding row so billing is attributed to the assistant
  // message via `usageRecordedAt` / `usageRecordedMessageId` exactly once.
  // Staleness model: cache is message-scoped, so edits that change the
  // message text invalidate via `textHash` (lease re-claim). Mid-turn memory
  // mutations are NOT tracked — accepted tradeoff for smaller rows and no
  // cross-table invalidation. Next turn is fresh regardless.
  messageMemoryContexts: defineTable({
    messageId: v.id("messages"),
    userId: v.string(),
    chatId: v.optional(v.id("chats")),
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("failed")),
    textHash: v.string(),
    memoryQueryText: v.optional(v.string()),
    // Raw hydrated memory rows plus retrieval metadata. `v.any()` on elements
    // because the memories table schema
    // is wide and evolves independently; the consumer re-validates via
    // `normalizeMemoryRecord`.
    hydratedHits: v.optional(v.array(v.any())),
    // Embedding usage passed through from the underlying embedding cache so
    // billing can be attributed when the assistant message consumes the row.
    usage: v.optional(v.object({
      promptTokens: v.number(),
      totalTokens: v.number(),
    })),
    generationId: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    leaseOwner: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    usageRecordedAt: v.optional(v.number()),
    usageRecordedMessageId: v.optional(v.id("messages")),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_message", ["messageId"]),

  cachedModels: cachedModelsTable,

  usageRecords: defineTable({
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    modelId: v.string(),
    promptTokens: v.number(),
    completionTokens: v.number(),
    totalTokens: v.number(),
    cost: v.optional(v.number()),
    isByok: v.optional(v.boolean()),
    cachedTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    audioPromptTokens: v.optional(v.number()),
    videoTokens: v.optional(v.number()),
    reasoningTokens: v.optional(v.number()),
    imageCompletionTokens: v.optional(v.number()),
    audioCompletionTokens: v.optional(v.number()),
    upstreamInferenceCost: v.optional(v.number()),
    upstreamInferencePromptCost: v.optional(v.number()),
    upstreamInferenceCompletionsCost: v.optional(v.number()),
    cacheDiscount: v.optional(v.number()),
    webSearchRequests: v.optional(v.number()),
    // M23: Cost source label for ancillary cost tracking.
    // "generation" | "title" | "compaction" | "memory_extraction" |
    // "memory_embedding" | "search_query_gen" | "search_perplexity" |
    // "search_planning" | "search_analysis" | "search_synthesis" |
    // "search_architecture" | "subagent" | "tool_web_search"
    source: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_model", ["userId", "modelId"])
    .index("by_chat", ["chatId"])
    .index("by_message", ["messageId"]),

  // ── M18: AI Skills ──────────────────────────────────────────────────
  skills: defineTable({
    slug: v.string(),
    name: v.string(),
    summary: v.string(),
    instructionsRaw: v.string(),
    instructionsCompiled: v.optional(v.string()),
    compilationStatus: skillCompilationStatus,
    scope: skillScope,
    ownerUserId: v.optional(v.string()),
    origin: skillOrigin,
    visibility: skillVisibility,
    lockState: skillLockState,
    status: skillStatus,
    runtimeMode: skillRuntimeMode,
    requiredToolIds: v.array(v.string()),
    requiredToolProfiles: v.optional(v.array(storedSkillToolProfile)),
    requiredIntegrationIds: v.array(v.string()),
    requiredCapabilities: v.optional(v.array(v.string())),
    unsupportedCapabilityCodes: v.array(v.string()),
    validationWarnings: v.array(v.string()),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_scope", ["scope", "status"])
    .index("by_owner", ["ownerUserId", "status"])
    .index("by_slug", ["slug"])
    .index("by_status", ["status"]),
};
