import { defineTable } from "convex/server";
import { v } from "convex/values";
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
  skillToolProfile,
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_user_type", ["userId", "memoryType", "createdAt"])
    .index("by_user_pinned", ["userId", "isPinned"])
    .index("by_user_pending", ["userId", "isPending"]),

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
  // `hydratedHits` stores the raw output of `hydrateRelevantMemoryHits`
  // (memory rows + score) so the generation action can skip embedding, vector
  // search, AND hydrate entirely on the critical path. `usage`/`generationId`
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
    // Raw hydrated memory rows + score (mirrors hydrateRelevantMemoryHits
    // return shape). `v.any()` on elements because the memories table schema
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

  cachedModels: defineTable({
    modelId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    provider: v.optional(v.string()),
    contextLength: v.optional(v.number()),
    maxCompletionTokens: v.optional(v.number()),
    inputPricePer1M: v.optional(v.number()),
    outputPricePer1M: v.optional(v.number()),
    supportsImages: v.optional(v.boolean()),
    supportsTools: v.optional(v.boolean()),
    supportedParameters: v.optional(v.array(v.string())),
    architecture: v.optional(
      v.object({
        tokenizer: v.optional(v.string()),
        instructType: v.optional(v.string()),
        modality: v.optional(v.string()),
      }),
    ),
    canonicalSlug: v.optional(v.string()),
    // M29 — Video generation
    supportsVideo: v.optional(v.boolean()),
    videoCapabilities: v.optional(v.object({
      supportedResolutions: v.array(v.string()),
      supportedAspectRatios: v.array(v.string()),
      supportedDurations: v.array(v.number()),
      supportedFrameImages: v.array(v.string()),
      supportedSizes: v.array(v.string()),
      generateAudio: v.boolean(),
      seed: v.boolean(),
      pricingSkus: v.optional(v.object({
        videoTokens: v.optional(v.string()),
        videoTokensWithoutAudio: v.optional(v.string()),
        perVideoSecond: v.optional(v.string()),
        perVideoSecond1080p: v.optional(v.string()),
      })),
      allowedPassthroughParameters: v.optional(v.array(v.string())),
      syncedAt: v.number(),
    })),
    // ZDR (Zero Data Retention) — true if model has a ZDR endpoint on OpenRouter
    hasZdrEndpoint: v.optional(v.boolean()),
    lastSyncedAt: v.number(),

    // ── Model Guidance: Artificial Analysis benchmarks ──────────────
    benchmarkLlm: v.optional(
      v.object({
        source: v.literal("artificial_analysis"),
        externalId: v.string(),
        slug: v.string(),
        creatorSlug: v.optional(v.string()),
        creatorName: v.optional(v.string()),
        intelligenceIndex: v.optional(v.number()),
        codingIndex: v.optional(v.number()),
        mathIndex: v.optional(v.number()),
        agenticIndex: v.optional(v.number()),
        speedTokensPerSecond: v.optional(v.number()),
        timeToFirstTokenSeconds: v.optional(v.number()),
        aaInputPricePer1M: v.optional(v.number()),
        aaOutputPricePer1M: v.optional(v.number()),
        aaBlendedPricePer1M: v.optional(v.number()),
        syncedAt: v.number(),
      }),
    ),

    // ── Model Guidance: Artificial Analysis text-to-image benchmarks ─
    benchmarkMedia: v.optional(
      v.object({
        textToImage: v.optional(
          v.object({
            source: v.literal("artificial_analysis"),
            externalId: v.string(),
            slug: v.string(),
            elo: v.optional(v.number()),
            rank: v.optional(v.number()),
            releaseDate: v.optional(v.string()),
            syncedAt: v.number(),
          }),
        ),
      }),
    ),

    // ── Model Guidance: OpenRouter category result sets (trend hints) ─
    openRouterUseCases: v.optional(
      v.array(
        v.object({
          category: v.string(),
          returnedRank: v.number(),
          syncedAt: v.number(),
        }),
      ),
    ),

    // ── Model Guidance: match metadata ──────────────────────────────
    guidanceMatch: v.optional(
      v.object({
        source: v.literal("artificial_analysis"),
        strategy: v.union(
          v.literal("manual"),
          v.literal("exact_slug"),
          v.literal("canonical_slug_minus_date"),
          v.literal("display_name_exact"),
          v.literal("family_plus_variant_resolution"),
          v.literal("canonical_family"),
          // Legacy values (kept for backward compat with existing data)
          v.literal("normalized_name"),
        ),
        confidence: v.number(),
      }),
    ),

    // ── Model Guidance: derived scores, ranks, and labels ────────────
    derivedGuidance: v.optional(
      v.object({
        labels: v.array(v.string()),
        primaryLabel: v.optional(v.string()),
        supportedIntents: v.array(v.string()),
        scores: v.object({
          recommended: v.optional(v.number()),
          coding: v.optional(v.number()),
          research: v.optional(v.number()),
          fast: v.optional(v.number()),
          value: v.optional(v.number()),
          image: v.optional(v.number()),
        }),
        // Per-category rank (1-based, competition ranking: 1,1,3,4,…)
        ranks: v.optional(
          v.object({
            recommended: v.optional(v.number()),
            coding: v.optional(v.number()),
            research: v.optional(v.number()),
            fast: v.optional(v.number()),
            value: v.optional(v.number()),
            image: v.optional(v.number()),
          }),
        ),
        // Total number of scored models (denominator for "#3 of 168")
        totalRanked: v.optional(v.number()),
        lastDerivedAt: v.number(),
      }),
    ),
  })
    .index("by_modelId", ["modelId"])
    .index("by_provider", ["provider"]),

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
    webSearchRequests: v.optional(v.number()),
    // M23: Cost source label for ancillary cost tracking.
    // "generation" | "title" | "compaction" | "memory_extraction" |
    // "memory_embedding" | "search_query_gen" | "search_perplexity" |
    // "search_planning" | "search_analysis" | "search_synthesis" | "subagent"
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
    requiredToolProfiles: v.optional(v.array(skillToolProfile)),
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
