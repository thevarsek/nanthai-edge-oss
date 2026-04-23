# Data Model (Convex)

> All data lives in Convex tables. SwiftData was fully removed in M8. iOS uses Codable DTOs decoded from Convex subscriptions.

## Schema Overview

The Convex schema is defined across 4 files imported into `convex/schema.ts` — 44 app tables total, plus Convex system tables such as `_scheduled_functions`. Shared validators live in `schema_validators.ts`. All records are scoped by `userId` (Clerk `identity.subject`). iOS uses Codable DTO structs in `Models/DTOs/ConvexTypes.swift` plus focused extensions such as `ConvexGeneratedChart.swift`, and Android maps the same documents into Kotlin DTOs under `android/app/src/main/java/com/nanthai/edge/data/`.

### Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `chats` | Conversations | title, userId, folderId, activeBranchLeafId, mode (`chatMode` validator: `"chat"` / `"ideascape"`), isPinned, pinnedAt, source (M13), sourceJobId (M13), sourceJobName (M13), subagentOverride, temperatureOverride, maxTokensOverride, includeReasoningOverride, reasoningEffortOverride, webSearchOverride, searchModeOverride, searchComplexityOverride, skillOverrides (M30), integrationOverrides (M30), autoAudioResponseOverride (M20). `activeBranchLeafId` remains the only persisted branch-selection field; per-fork pill switching is resolved canonically by `chat/manage:switchBranchAtFork`. |
| `messages` | Chat messages | chatId, role, content, modelId, parentMessageIds, status, reasoning, userId (M13 — denormalized for search index), searchSessionId (M9), enabledIntegrations (per-message snapshot), turnSkillOverrides (M30), turnIntegrationOverrides (M30), loadedSkillIds (M30), usedIntegrationIds (M30), toolCalls/toolResults (M10), generatedFileIds (M10), generatedChartIds (M19), citations (2026-03-31 Perplexity URL metadata), subagentsEnabled, subagentBatchId, audioStorageId (M20), audioTranscript (M20), audioDurationMs (M20), audioVoice (M20), audioGeneratedAt (M20), audioGenerating (M20), audioLastPlayedAt (M20), videoUrls (M29), hasVideo (M29), retryContract (PR #78 — full participant/config snapshot stored at send time for retry use), terminalErrorCode (PR #78 — canonical failure reason: `stream_timeout` / `provider_error` / `cancelled_by_retry` / `cancelled_by_user` / `unknown_error`). Final assistant output is persisted here; active streaming state is overlaid from `streamingMessages`. |
| `streamingMessages` | Active streaming overlay rows | messageId, chatId, content, reasoning, status, toolCalls, createdAt, updatedAt. Written by `StreamWriter` during generation so live token patches avoid invalidating heavy `listMessages` subscriptions. |
| `chatParticipants` | Models/personas in a chat | chatId, modelId, personaId, sortOrder, personaName, personaEmoji, personaAvatarImageUrl, createdAt |
| `generationJobs` | LLM generation tracking | messageId, status (pending/running/completed/failed), terminalErrorCode (PR #78 — canonical failure code on failed jobs) |
| `generationContinuations` | Durable generation checkpoints | chatId, messageId, jobId, userId, status (`waiting`/`running`/`completed`/`cancelled`), participantSnapshot, groupSnapshot, requestMessages, usage, toolCalls, toolResults, activeProfiles, compactionCount, continuationCount, partialContent, partialReasoning, scheduledAt, scheduledFunctionId, claimedAt, leaseExpiresAt. Indexes: `by_job`, `by_status`, `by_chat`. |
| `autonomousSessions` | Group chat orchestration | chatId, status, cycleCount, maxCycles |
| `subagentBatches` | Parent delegation batches | parentMessageId, parentJobId, status, tool-call round metadata, child counters, params snapshot |
| `subagentRuns` | Child delegated runs | batchId, childIndex, title, taskPrompt, status, streamed content/reasoning, continuation snapshot |
| `searchSessions` | Web search / research paper sessions | chatId, status, complexity, searchCallCount, perplexityModelTier, participantCount |
| `searchContexts` | Search run context snapshots | messageId, phase metadata, retrieval context |
| `searchPhases` | Search workflow phase state | sessionId, phase, status, result metadata |
| `skills` | AI skill definitions (system catalog + user-authored) | slug, name, summary, instructionsRaw, instructionsCompiled?, compilationStatus, scope (system/user), origin, visibility, lockState, status, runtimeMode, requiredToolIds, requiredToolProfiles, requiredIntegrationIds, requiredCapabilities, unsupportedCapabilityCodes, validationWarnings, version. Indexed by scope+status+visibility, slug, ownerUserId. |
| `generatedFiles` | AI-generated file metadata (M10) | userId, chatId, messageId, storageId, filename, mimeType, sizeBytes, toolName |
| `generatedCharts` | AI-generated native chart metadata (M19) | userId, chatId, messageId, toolName, chartType, title?, xLabel?, yLabel?, xUnit?, yUnit?, elements |
| `fileAttachments` | Uploaded file attachment metadata | userId, chatId, messageId, storageId, filename, mimeType, sizeBytes |
| `personas` | Custom AI personas | displayName, personaDescription, modelId, avatarEmoji, avatarImageStorageId, avatarSFSymbol, avatarColor, temperature, skillOverrides (M30), integrationOverrides (M30) |
| `memories` | Extracted memories | content, category, isPending (boolean), memoryType, importanceScore, retrievalMode (post-M14), scopeType (post-M14), personaIds (post-M14), sourceType (post-M14), sourceFileName (post-M14), tags (post-M14), citationChatId, citationMessageId |
| `memoryEmbeddings` | Memory vector index rows | memoryId, embedding, model metadata |
| `messageQueryEmbeddings` | Lease-based per-message query embedding cache | messageId, userId, chatId, provider, modelId, status, embedding, textHash, usage, generationId, errorCode, leaseOwner, leaseExpiresAt, usageRecordedAt, usageRecordedMessageId |
| `messageMemoryContexts` | Lease-based per-message hydrated memory-context cache | messageId, userId, chatId, status, textHash, memoryQueryText, hydratedHits, usage, generationId, errorCode, leaseOwner, leaseExpiresAt, usageRecordedAt, usageRecordedMessageId |
| `cachedModels` | OpenRouter model catalog + benchmark guidance cache | modelId, name, provider, canonicalSlug, pricing, contextLength, supportsImages, supportsTools, supportsVideo (M29), videoCapabilities (M29: durations, resolutions, aspectRatios, audio), benchmarkLlm, benchmarkMedia, openRouterUseCases, guidanceMatch, derivedGuidance |
| `usageRecords` | Per-message API cost tracking (M23) | userId, chatId, messageId, modelId, promptTokens, completionTokens, totalTokens, cost, source (M23: `"generation"` / `"title"` / `"compaction"` / `"memory_extraction"` / `"memory_embedding"` / `"search_query_gen"` / `"search_perplexity"` / `"search_planning"` / `"search_analysis"` / `"search_synthesis"` / `"subagent"`), token breakdowns (cached, reasoning, audio, image, video), upstreamInferenceCost. Indexes: `by_user`, `by_user_model`, `by_chat`, `by_message` (M23) |
| `folders` | Chat organization | name, userId, sortOrder |
| `userPreferences` | Global user settings | defaultModelId, temperature, maxTokens, hapticFeedback, onboardingCompleted (M14), defaultSearchMode (M13.5), defaultSearchComplexity (M13.5), subagentsEnabledByDefault, autoAudioResponse (M20), preferredVoice (M20), showBalanceInChat (post-M21), showAdvancedStats (M23), hasSeenIdeascapeHelp (M17), hasSeenMainHelp (post-M21), defaultVideoDuration (M29), defaultVideoResolution (M29), defaultVideoAspectRatio (M29), defaultVideoAudio (M29), skillDefaults (M30), integrationDefaults (M30), etc. |
| `modelSettings` | Per-model overrides | openRouterId, temperature, maxTokens, systemPrompt |
| `nodePositions` | Ideascape spatial layout | chatId, messageId, x, y, width, height |
| `oauthConnections` | External integration OAuth tokens (M10) | userId, provider (google/microsoft/notion/slack/cloze), accessToken, refreshToken, expiresAt, scopes, email, status |
| `integrationRequestGates` | Per-user integration approval state | userId, provider, gating metadata, timestamps |
| `purchaseEntitlements` | Cross-platform Pro entitlement source of truth | userId, platform, source, productId, externalPurchaseId, status, activatedAt, revokedAt, lastVerifiedAt |
| `scheduledJobs` | User-created recurring AI tasks (M13) | userId, name, prompt, personaId, modelId, cronExpression, recurrence, status, searchMode (M13.5), searchComplexity (M13.5), includeReasoning, reasoningEffort, steps (post-M14), activeExecutionId (post-M14), activeExecutionChatId (post-M14), activeExecutionStartedAt (post-M14), activeStepIndex (post-M14), activeStepCount (post-M14), activeUserMessageId (post-M14), activeAssistantMessageId (post-M14), activeGenerationJobId (post-M14) |
| `jobRuns` | Execution history for scheduled jobs (M13) | jobId, userId, status, chatId, startedAt, completedAt, errorMessage |
| `userSecrets` | Server-side API key storage (M13) | userId, apiKey — synced during PKCE exchange + app launch |
| `deviceTokens` | Provider-based push notification tokens (M13.5/M16) | userId, token, platform (`ios`/`android`), provider (`apns`/`fcm`), optional APNs environment, updatedAt. Indexes: `by_user`, `by_token`, `by_platform_provider` |
| `favorites` | Quick-launch model/persona/group shortcuts | userId, name, modelIds, personaId, personaName, personaEmoji, personaAvatarImageUrl, sortOrder, createdAt, updatedAt. Index: `by_user` |
| `userCapabilities` | Internal/manual feature grants layered on top of purchase entitlements | userId, capability (`pro` / `mcpRuntime`), source, status, grantedAt, expiresAt?, metadata. **Note (M27):** `sandboxRuntime` was removed — all Pro users now get runtime access without an additional capability grant. |
| `sandboxSessions` | Active Vercel runtime session tracking for sandbox-backed tools. Sessions are keyed by `chatId`, `userId`, and runtime `environment` (`python` / `node`). | userId, chatId, environment, providerSandboxId, provider, status, cwd, lastActiveAt, timeoutMs, internetEnabled, publicTrafficEnabled, failureCount |
| `sandboxArtifacts` | Runtime artifact bookkeeping for files exported from sandbox-backed tools into durable storage. | userId, chatId, sandboxSessionId, path, filename, mimeType, sizeBytes?, storageId?, isDurable |
| `sandboxEvents` | Runtime observability trail for sandbox-backed workflows. | sandboxSessionId?, userId, chatId, eventType, details?, createdAt |
| `videoJobs` | Async video generation tracking (M29) | userId (v.string()), chatId, messageId, model, status (pending/in_progress/completed/failed), error, createdAt. Indexes: `by_messageId`, `by_status_createdAt` |
| `generatedMedia` | Generated media file metadata (M29) | userId, chatId, messageId, storageId, type (video/audio/image), mimeType, sizeBytes, model, durationSeconds |
| `_scheduled_functions` | Convex system table | Scheduled function execution |

### Identity & Scoping

- All user-facing tables include a `userId` field = `ctx.auth.getUserIdentity().subject` (Clerk user ID)
- Queries filter by authenticated user automatically
- No cross-user data leakage possible at the query level

### IDs

- All Convex document IDs are strings (e.g., `"j57..."`)
- iOS DTOs use `String` for all ID fields (was `UUID` with SwiftData)
- Convex IDs are typed per-table in the backend: `Id<"chats">`, `Id<"messages">`, etc.

## iOS DTO Types

All Convex data is decoded into Swift structs defined in `Models/DTOs/ConvexTypes.swift`:

```swift
struct ConvexChat: Codable, Identifiable, Hashable {
    let _id: String
    let title: String
    let userId: String
    let folderId: String?
    let activeBranchLeafId: String?
    let mode: String?             // "chat" or "ideascape" (chatMode validator)
    let source: String?           // M13: "manual" | "scheduled"
    let sourceJobId: String?      // M13: Id<"scheduledJobs">
    let sourceJobName: String?    // M13: denormalized job name for chat list display
    let isPinned: Bool?           // Pin to top of chat list
    let pinnedAt: Double?         // Timestamp when pinned (for sort order)
    // Per-chat search overrides (nil = inherit global default)
    let webSearchOverride: Bool?
    let searchModeOverride: String?   // "basic" | "web" | "paper"
    let searchComplexityOverride: Double?  // 1 | 2 | 3
    let _creationTime: Double
    var id: String { _id }
}

struct ConvexMessage: Codable, Identifiable, Hashable {
    let _id: String
    let chatId: String
    let role: String
    let content: String
    let modelId: String?
    let parentMessageIds: [String]?
    let status: String?
    let reasoning: String?
    let userId: String?           // M13: denormalized for search index filterFields
    let _creationTime: Double
    var id: String { _id }
}
```

Additional DTOs: `ConvexChatParticipant`, `ConvexPersona`, `ConvexFolder`, `ConvexCachedModel`, `ConvexModelSummary` (lightweight projection — M9.5), `ConvexMemory`, `ConvexNodePosition`, `ConvexUserPreferences`, `ConvexModelSettings`, `ConvexGenerationJob`, `ConvexAutonomousSession`, `ConvexSearchSession`, `ConvexToolCall`, `ConvexToolResult`, `ConvexGeneratedFile` (M10), `ConvexGeneratedChart` (M19), `ConvexOAuthConnection` (M10), `ConvexScheduledJob` (M13), `ConvexJobRun` (M13), `ConvexUserSecrets` (M13), `ConvexProStatus` (M16), `ConvexFavorite`, `ConvexSkill` (M18), and account-capability payloads returned by `capabilities/queries:getAccountCapabilitiesPublic`.

`ConvexSkill` now also carries optional profile-routing metadata:

- `requiredToolProfiles?: [String]`
- `requiredCapabilities?: [String]`

These are persisted for both built-in and user-authored skills and are normalized on create/update to keep runtime and integration requirements internally consistent.

Subagent DTOs are defined separately in `Models/DTOs/ConvexTypes+Subagents.swift`:

- `ConvexSubagentBatch`
- `ConvexSubagentRun`
- `ConvexSubagentBatchView`

### Enums

Two enums previously embedded in SwiftData models are now standalone in `ConvexTypes.swift`:

```swift
enum MessageRole: String, Codable, Sendable {
    case system, user, assistant
}

enum MemoryGatingMode: String, Codable, Sendable {
    case auto, always, never, ask
}
```

## Convex Schema Definition

The authoritative schema is `convex/schema.ts`. Key design patterns:

- **Indexes**: Every table has indexes for common query patterns (e.g., `by_chat` on messages, `by_userId` on chats, `by_user_pinned` on chats for pinned conversation queries, `by_user` on favorites)
- **Vector indexes**: `memories` table has a vector index for semantic search (1536 dimensions, cosine similarity)
- **Optional relationships**: Foreign key fields (`folderId`, `personaId`) are optional (`v.optional(v.id("table"))`)
- **String enums**: Role, status, and category fields use `v.union(v.literal("..."), ...)` for type safety
- **Shared validators**: `schema_validators.ts` exports reusable validators (`scheduledJobStatus`, `scheduledJobRecurrence`, `jobRunStatus`, `chatSource`, `memoryRetrievalMode` (post-M14), `memoryScopeType` (post-M14), `memorySourceType` (post-M14), `scheduledJobStep` (post-M14)) used by both schema and function argument validators
- **Search indexes**: `messages` table has a search index on `content` with `userId` in `filterFields` for cross-chat search scoped to the authenticated user
- **Timestamps**: `_creationTime` is automatic; `updatedAt` is manual where needed

## Migration from SwiftData

| SwiftData (Pre-M8) | Convex (Post-M8) |
|---------------------|-------------------|
| `@Model final class Chat` | `chats` table + `ConvexChat` DTO |
| `@Model final class Message` | `messages` table + `ConvexMessage` DTO |
| `@Relationship` | Foreign key IDs (e.g., `chatId: v.id("chats")`) |
| `ModelContainer` + `ModelContext` | `ConvexService` subscriptions |
| `@Query` in views | `convex.subscribe(to:)` in ViewModels |
| `modelContext.insert()` / `.delete()` | `convex.mutation()` calls |
| `UUID` identifiers | `String` Convex document IDs |
| CloudKit sync | Convex realtime WebSocket |
| `SchemaV1` / migration plans | Convex schema push (automatic) |

---

## M9.5 Schema Changes

| Change | Details |
|--------|---------|
| **Removed `messageChunks` table** | Was write-only waste — iOS client never read it during streaming. The replacement architecture patches `streamingMessages` during generation, then persists the final content/reasoning back into `messages` during `finalizeGeneration`. |
| **Added telemetry to `searchSessions`** | `searchCallCount`, `perplexityModelTier`, `participantCount` fields for cost tracking. |
| **Added `listModelSummaries` query** | Lightweight projection returning only 10 fields per model (vs 20+ in full `cachedModels`). Used by `SharedAppDataStore` for views that don't need full model data. |
| **Added `before` param to `listMessages`** | Cursor-based pagination — iOS subscribes with `limit: 50` for the recent window, loads older messages on demand. |
| **Added `getAttachmentUrl` query** | On-demand attachment URL resolution by `storageId`, replacing the per-subscription-tick `withRefreshedAttachmentUrls` call. |

---

## M10 Schema Changes

| Change | Details |
|--------|---------|
| **Added `generatedFiles` table** | AI-generated file metadata: storageId, filename, mimeType, sizeBytes, toolName. Indexes: `by_user`, `by_chat`, `by_message`. |
| **Added `oauthConnections` table** | External integration OAuth tokens. Stores provider (google/microsoft/notion/slack/cloze), access/refresh tokens, expiry, scopes, user email, status. Indexes: `by_user`, `by_user_provider`, `by_status`. Notion uses HTTP Basic Auth for token exchange (no PKCE). Slack uses OAuth 2.0 (workspace-level). Cloze uses API key auth (no OAuth). |
| **Added tool fields to `messages`** | `toolCalls` (v.optional array), `toolResults` (v.optional array), `generatedFileIds` (v.optional array of Id<"generatedFiles">). |
| **Added `enabledIntegrations` to `sendMessageArgs`** | Passed to backend as the per-message effective integration snapshot. M30 keeps this on message/send paths while persona/chat defaults now live in layered override fields. |
| **Schema split** | `convex/schema.ts` now imports from 4 table definition files: `schema_tables_core.ts` (14 tables), `schema_tables_catalog.ts` (6 tables), `schema_tables_user.ts` (12 tables), `schema_tables_runtime.ts` (4 tables). |

---

## M13 Schema Changes

| Change | Details |
|--------|---------|
| **Added `scheduledJobs` table** | User-created recurring AI tasks: name, prompt, personaId, modelId, cronExpression, recurrence, status, nextRunAt, lastRunAt, includeReasoning, reasoningEffort. Indexes: `by_user`, `by_status`, `by_nextRunAt`. |
| **Added `jobRuns` table** | Execution history: jobId, userId, status (pending/running/completed/failed), chatId, startedAt, completedAt, errorMessage. Indexes: `by_job`, `by_user`. |
| **Added `userSecrets` table** | Server-side API key storage: userId, openRouterApiKey. Synced during PKCE exchange + on every app launch. Index: `by_userId`. |
| **Added `schema_validators.ts`** | Shared validators (`scheduledJobStatus`, `scheduledJobRecurrence`, `jobRunStatus`, `chatSource`) used by schema and function args. |
| **Added `source`, `sourceJobId`, `sourceJobName` to `chats`** | Chat provenance for scheduled jobs. `sourceJobName` denormalized to avoid extra query in chat list. |
| **Added `userId` to `messages`** | Denormalized for efficient cross-user search scoping via search index `filterFields`. |
| **Added search index on `messages`** | Full-text search on `content` with `userId` in `filterFields`. |
| **Added `isProUnlocked`, `proUnlockedAt` to `userPreferences`** | Legacy Pro mirror fields. **Removed** in the post-M21 entitlement schema cleanup — `purchaseEntitlements` is the sole source of truth for Pro status. |
| **Added `includeReasoning`, `reasoningEffort` to `scheduledJobs`** | Reasoning overrides for reasoning-capable models in jobs. |
| **New cron: `cleanOldJobRuns`** | Daily at 5 UTC — prunes job runs older than 30 days. 7 system crons total (including `cleanStaleSearchPhases` at 4 UTC). |
| **Table count: 19 → 22** | 3 new tables: `scheduledJobs`, `jobRuns`, `userSecrets`. |

---

## M13.5 Schema Changes

| Change | Details |
|--------|---------|
| **Added `defaultSearchMode`, `defaultSearchComplexity` to `userPreferences`** | Default internet search tier (`"basic"` / `"web"` / `"paper"`) and complexity (1-3) for new chats. |
| **Added `webSearchOverride`, `searchModeOverride`, `searchComplexityOverride` to `chats`** | Per-chat search setting overrides. `nil` = inherit global default from `userPreferences`. Once a user explicitly toggles search within a chat, the override is persisted and survives navigation, backgrounding, and app relaunch. Follows the same pattern as `temperatureOverride`, `maxTokensOverride`, etc. |
| **Replaced `webSearchEnabled` on `scheduledJobs`** | New fields: `searchMode` (`"none"` / `"basic"` / `"web"` / `"research"`) and `searchComplexity` (1-3). Backward compat: absent `searchMode` + `webSearchEnabled: true` → `"basic"`. |
| **Added `deviceTokens` table** | Provider-based push notification tokens: userId, token, platform, provider, optional APNs environment, updatedAt. Indexes: `by_user`, `by_token`, `by_platform_provider`. Table count: 22 → 23. |

---

## M14 Schema Changes

| Change | Details |
|--------|---------|
| **Added `originalTransactionId` to `userPreferences`** | `v.optional(v.string())` — legacy StoreKit audit field retained for migration/backward compatibility. |
| **Added `onboardingCompleted` to `userPreferences`** | `v.boolean()` — set `true` after the user completes onboarding (OpenRouter key stored). Convex value takes precedence over UserDefaults to handle reinstalls and new devices. |

> **Note:** `isProUnlocked` and `proUnlockedAt` have been removed from the `userPreferences` schema (post-M21 entitlement cleanup). `originalTransactionId` remains for StoreKit audit compatibility. Pro state comes exclusively from `purchaseEntitlements` via `preferences/entitlements.ts` and `preferences/queries:getProStatus`.

No new tables. Table count remains 23.

### `userPreferences` (legacy fields + onboarding)

The following legacy and onboarding fields remain on `userPreferences`:

```typescript
originalTransactionId: v.optional(v.string()), // legacy StoreKit audit field
onboardingCompleted: v.boolean(),             // M14: has user completed onboarding carousel
```

### iOS DTO Update

`ConvexUserPreferences` still includes onboarding and non-billing preference fields, while Pro UI now reads `preferences/queries:getProStatus`:

```swift
let onboardingCompleted: Bool

struct ConvexProStatus {
    let isPro: Bool
    let source: String
}
```

---

## M16 Schema Changes

| Change | Details |
|--------|---------|
| **Added `purchaseEntitlements` table** | Cross-platform Pro source of truth for App Store + Play Billing purchases. Clients now read `preferences/queries:getProStatus` instead of inferring billing from `userPreferences`. |
| **Added `integrationRequestGates` table** | Server-owned gating state for integration request flows and approval metadata. |
| **Added `searchContexts` + `searchPhases` tables** | Persisted search workflow context and per-phase progress for shared iOS/Android deep research surfaces. |
| **Added `fileAttachments` table** | Canonical metadata for uploaded conversation attachments and generated file associations. |
| **Added `memoryEmbeddings` table** | Separated embedding rows from logical memory records to support richer memory indexing. |
| **Added `usageRecords` table** | Usage and cost telemetry records for backend-side reporting and budgeting. |
| **Android client contract added** | Android consumes the same schema through Kotlin DTOs in `android/app/src/main/java/com/nanthai/edge/data/ConvexDTOs.kt`. |

## Model Guidance System (2026-03-15)

The model catalog is no longer just a cached OpenRouter pricing/capabilities list. `cachedModels` now also stores benchmark and trend metadata used by the guided picker and "Help me choose" flows on both iOS and Android.

### `cachedModels` guidance fields

| Field | Type | Details |
|-------|------|---------|
| `canonicalSlug` | `v.optional(v.string())` | Stable-ish OpenRouter canonical slug used for family matching and display. |
| `benchmarkLlm` | optional object | Artificial Analysis LLM benchmark snapshot: source, externalId, slug, creator fields, intelligence/coding/math/agentic scores, speed, latency, AA pricing, `syncedAt`. |
| `benchmarkMedia` | optional object | Artificial Analysis text-to-image benchmark snapshot. |
| `openRouterUseCases` | optional array | OpenRouter weekly category ranks stored as trend hints (`category`, `returnedRank`, `syncedAt`). |
| `guidanceMatch` | optional object | Match metadata from the OpenRouter ↔ Artificial Analysis family matcher (`strategy`, `confidence`). |
| `derivedGuidance` | optional object | Locale-agnostic labels, supported intents, normalized scores, per-category ranks, `totalRanked`, `lastDerivedAt`. |

### Model guidance backend modules

- `convex/models/sync.ts` — OpenRouter catalog sync + public re-exports
- `convex/models/artificial_analysis_sync.ts` — fetch AA benchmark datasets
- `convex/models/artificial_analysis_apply.ts` — match, normalize, score, and patch guidance fields
- `convex/models/openrouter_usecase_sync.ts` — fetch/store OpenRouter trend hints
- `convex/models/guidance_matching.ts` — family-based OpenRouter ↔ AA matcher
- `convex/models/guidance_scoring*.ts` — normalized picker scores, ranks, labels, wizard scoring
- `convex/models/queries.ts` — `listModels`, `listModelSummaries`, `getModel`

### Mobile numeric gotcha

Although rank-like values are conceptually integers, they are still stored as Convex `v.number()` fields. On the mobile wire they may arrive as `3.0` / `129.0` / `135.0`. Android hit this on 2026-03-15 when `derivedGuidance.ranks.*` and `totalRanked` were modeled as `Int` in Kotlin DTOs, breaking the entire models subscription. Client DTOs should decode these guidance numeric fields as floating-point and convert later.

---

## M18 Schema Changes

| Change | Details |
|--------|---------|
| **Added `skills` table** | AI skill definitions (system catalog + user-authored): slug, name, summary, instructionsRaw, instructionsCompiled?, compilationStatus, scope, ownerUserId, origin, visibility, lockState, status, runtimeMode, requiredToolIds, requiredIntegrationIds, unsupportedCapabilityCodes, validationWarnings, version, createdAt, updatedAt. 20+ fields, 4 indexes (`by_scope`, `by_owner`, `by_slug`, `by_status`). Table count: 29 → 30. |
| **M30 replaced legacy skill attachment fields** | `personas` now use `skillOverrides` / `integrationOverrides`; `chats` now use `skillOverrides` / `integrationOverrides`; legacy `discoverableSkillIds`, `disabledSkillIds`, and persona-level `enabledIntegrations` were removed after rollout stabilization. |

---

## M19 Schema Changes

| Change | Details |
|--------|---------|
| **Added `generatedCharts` table** | Native chart metadata persisted separately from file exports. Stores normalized chart payloads (`line`, `bar`, `scatter`, `pie`, `box`) for chat rendering. Indexes: `by_user`, `by_chat`, `by_message`. |
| **Added runtime/capability schema file** | `convex/schema_tables_runtime.ts` introduces 4 tables: `userCapabilities`, `sandboxSessions`, `sandboxArtifacts`, `sandboxEvents`. |
| **Added `generatedChartIds` to `messages`** | Assistant messages can now reference chart records alongside generated files. |
| **Capability model added** | `userCapabilities` stores internal/manual grants (currently `pro` and `mcpRuntime`), layered on top of entitlement-derived `pro`. **Note (M27):** `sandboxRuntime` was removed — all Pro users now get runtime access. |
| **Per-chat sandbox lifecycle persisted** | [DEPRECATED — M27] `sandboxSessions` was used for E2B provider sandbox tracking. Runtime now uses ephemeral per-generation just-bash sandboxes — no persistent session tracking needed. |
| **Runtime artifacts and observability persisted** | `sandboxArtifacts` tracks exported files related to a sandbox; `sandboxEvents` stores lifecycle and analytics events. |
| **Table count: 30 → 35** | 5 new tables: `generatedCharts`, `userCapabilities`, `sandboxSessions`, `sandboxArtifacts`, `sandboxEvents`. |

---

## 2026-04-20 / 2026-04-21 Schema Changes

| Change | Details |
|--------|---------|
| **Added `messageQueryEmbeddings` table** | Per-message lease-based embedding cache keyed by `messageId`. Stores embedding vectors, usage, generation IDs, error state, and one-time billing attribution markers so memory/query embedding work can be prewarmed and deduplicated. |
| **Added `messageMemoryContexts` table** | Per-message hydrated memory-context cache keyed by `messageId` + `textHash`. Stores the full post-vector-search memory hit payload so generation can skip the full retrieval chain on cache hit. |
| **Model privacy metadata expanded** | `cachedModels` now includes `hasZdrEndpoint` so clients can enforce ZDR-compatible model choices when the user enables Zero Data Retention. |
| **User preferences expanded** | `userPreferences.zdrEnabled` persists the global Zero Data Retention toggle used by model pickers, chat defaults, and runtime request gating across iOS, Android, and web. |
| **Table count: 42 → 44** | The two new memory/embedding cache tables are now part of the catalog schema domain. |

## Post-M14 Weekend Sprint Schema Changes (2026-03-07 → 2026-03-09)

### `memories` table — Memory Personalization Overhaul (PR #29)

| Field | Type | Details |
|-------|------|---------|
| `retrievalMode` | `v.optional(memoryRetrievalMode)` | `"auto"` / `"always"` / `"keyword"` — controls how the memory is retrieved for injection |
| `scopeType` | `v.optional(memoryScopeType)` | `"global"` / `"persona"` — whether memory applies to all personas or specific ones |
| `personaIds` | `v.optional(v.array(v.id("personas")))` | Persona-scoped memories — only injected when one of these personas is active |
| `sourceType` | `v.optional(memorySourceType)` | `"extraction"` / `"manual"` / `"document_import"` — provenance of the memory |
| `sourceFileName` | `v.optional(v.string())` | Original filename for document-imported memories |
| `tags` | `v.optional(v.array(v.string()))` | User-defined tags for organization and retrieval |

New shared validators in `schema_validators.ts`: `memoryRetrievalMode`, `memoryScopeType`, `memorySourceType`.

Memory categories expanded to 10 (defined in `convex/memory/shared.ts` as single source of truth).

### `scheduledJobs` table — Multi-Step Pipelines (PR #31)

| Field | Type | Details |
|-------|------|---------|
| `steps` | `v.optional(v.array(scheduledJobStep))` | Array of step configs — each step has its own prompt, persona, model, and settings. `getScheduledJobSteps()` normalizes legacy single-step jobs to the new format for backward compatibility. |
| `activeExecutionId` | `v.optional(v.id("jobRuns"))` | Currently executing job run ID |
| `activeExecutionChatId` | `v.optional(v.id("chats"))` | Chat created for current execution |
| `activeExecutionStartedAt` | `v.optional(v.number())` | Timestamp when current execution started |
| `activeStepIndex` | `v.optional(v.number())` | Current step being executed (0-indexed) |
| `activeStepCount` | `v.optional(v.number())` | Total number of steps in current execution |
| `activeUserMessageId` | `v.optional(v.id("messages"))` | User message ID for current step |
| `activeAssistantMessageId` | `v.optional(v.id("messages"))` | Assistant message ID for current step |
| `activeGenerationJobId` | `v.optional(v.id("generationJobs"))` | Generation job tracking current step |

New shared validator: `scheduledJobStep` (in `schema_validators.ts`).

### `messages` table — Integration Tracking (PR #30)

| Field | Type | Details |
|-------|------|---------|
| `enabledIntegrations` | `v.optional(v.array(v.string()))` | Per-message record of which integrations were active when the message was sent (e.g., `["gmail", "drive", "notion", "slack", "cloze"]`) |
| `turnSkillOverrides` | `v.optional(v.array(v.object({ skillId, state })))` | Turn-only skill overrides stamped on the user/assistant message path for auditability (M30). |
| `turnIntegrationOverrides` | `v.optional(v.array(v.object({ integrationId, enabled })))` | Turn-only integration overrides stamped on the message path (M30). |
| `loadedSkillIds` | `v.optional(v.array(v.id("skills")))` | Assistant orchestration trace of skills loaded into the run (M30). |
| `usedIntegrationIds` | `v.optional(v.array(v.string()))` | Assistant orchestration trace of integrations actually used during the run (M30). |

No new tables. Table count remains 23.

---

*Last updated: 2026-04-09 — M27 Free Code Execution: deprecated sandbox session/artifact/event tables; see M27 Schema Changes section below. M19 Max Runtime: added `generatedCharts`, runtime/capability tables, `messages.generatedChartIds`, and chart/capability DTO surfaces.*

---

## M20 Schema Changes

| Change | Details |
|--------|---------|
| **Added audio fields to `messages`** | `audioStorageId` (v.optional(v.id("_storage"))), `audioTranscript` (v.optional(v.string())), `audioDurationMs` (v.optional(v.number())), `audioVoice` (v.optional(v.string())), `audioGeneratedAt` (v.optional(v.number())), `audioLastPlayedAt` (v.optional(v.number())), `audioGenerating` (v.optional(v.boolean())). |
| **Added `by_audio_storage` index to `messages`** | Index on `audioStorageId` for orphaned audio cleanup queries. |
| **Added audio preference fields to `userPreferences`** | `autoAudioResponse` (v.optional(v.boolean())), `preferredVoice` (v.optional(v.string())). |
| **Added `autoAudioResponseOverride` to `chats`** | `v.optional(v.boolean())` — per-chat override for auto-audio preference. |

No new tables. Table count remains 35.

---

## M21 Schema Changes

| Change | Details |
|--------|---------|
| **Added `rate_limit` table** | Backend rate limiting for abuse prevention. Fields: `userId`, `action`, `windowStart`, `count`, `updatedAt`. Indexed by `by_user_action`. Table count: 35 → 36. |
| **Added `by_status` index to `generationJobs`** | Enables indexed cleanup of stale generation jobs instead of full table scan. |
| **Added `audioGenerating` flag to `messages`** | Transient boolean flag indicating TTS generation is in progress, patched false on completion or failure. |
| **Split `repairInvalidMessagePersonas`** | Not a schema change but a migration pattern: large repair mutations are chunked (process N documents per call, reschedule if more remain) to stay within Convex's mutation time budget. |

---

## M23 Schema Changes

| Change | Details |
|--------|---------|
| **Extended `usageRecords` with `source` labels** | 11 previously-untracked cost sources (title, compaction, memory extraction/embedding, search query/perplexity/planning/analysis/synthesis, subagent) now have `source` field + `by_message` index for per-message cost aggregation. |
| **Added `showAdvancedStats` to `userPreferences`** | `v.optional(v.boolean())` — toggle for per-message/chat cost display. |

No new tables. Table count remains 36.

---

## M26 Schema Changes

| Change | Details |
|--------|---------|
| **No new schema fields** | M26 reuses existing M20 audio fields (`audioStorageId`, `audioDurationMs`, `audioGeneratedAt`) for Lyria music. The `generatedFiles` table's existing schema accommodates Lyria audio with `toolName: "lyria_music_generation"` and `mimeType: "audio/mpeg"`. |
| **Extended `openrouter_request.ts`** | Added `cache_control: { type: "ephemeral" }` for Anthropic models (prompt caching opt-in). Not a schema change but affects request shape. |
| **Extended `http.ts` MIME map** | Added `mp3: "audio/mpeg"`, `wav: "audio/wav"`, `m4a: "audio/mp4"` to the `/download` endpoint. |
| **Extended `listModelSummaries` response** | `isFree` field now computed server-side via `:free` slug suffix instead of zero-price check. All clients decode this field. |

No new tables. Table count remains 36.

---

## M27 Schema Changes

| Change | Details |
|--------|---------|
| **Added `png_image` to `generatedCharts.chartType`** | The `chartType` union now includes `png_image` in addition to `line`, `bar`, `scatter`, `pie`, `box`. Added across all 6 schema/validator/type locations: `schema_tables_core.ts` (2 tables), `mutations_args.ts`, `subagents/mutations.ts` (3 validators). |
| **Added `pngBase64` optional field to `generatedCharts`** | `v.optional(v.string())` — stores base64-encoded PNG for `png_image` chart type. Added to schema, validators, TypeScript interfaces, DB insert handlers, and query response. **Note:** This field is no longer populated in practice — chart PNGs now go exclusively through Convex `_storage` → `generatedFiles`. |
| **Made `sandboxSessionId` optional in `sandboxArtifacts`** | Changed from `v.id("sandboxSessions")` to `v.optional(v.id("sandboxSessions"))` to support Pyodide/just-bash runs that have no sandbox session. |
| **Added `data_python_sandbox` to tool registrations** | Added to `FILE_PRODUCING_TOOLS` in `generated_file_helpers.ts` and `KNOWN_TOOL_IDS` in `validators.ts`. |
| **Deprecated tables** | `sandboxSessions`, `sandboxArtifacts`, `sandboxEvents` are effectively deprecated — no longer populated by the current runtime architecture. They remain in the schema for backward compatibility. |
| **Removed `sandboxRuntime` capability checks** | The `sandboxRuntime` capability is no longer checked in tool registry, skill visibility, or runtime profile logic. The `userCapabilities` table still exists but `sandboxRuntime` grants are no longer required. |
| **Removed 5 banned patterns from `validators.ts`** | `USES_BASH`, `USES_FILESYSTEM`, `USES_RAW_FETCH`, `USES_BUNDLED_SCRIPTS`, `USES_GIT` removed from `BANNED_PATTERNS` since just-bash handles these operations. |

No new tables. Table count remains 36.

---

## Post-M27 Schema Changes (Durable Generation Continuations)

| Change | Details |
|--------|---------|
| **Added `generationContinuations` table** | Durable cross-action checkpoint/resume for long-running generation pipelines. Fields: `chatId` (v.id("chats")), `messageId` (v.id("messages")), `jobId` (v.id("generationJobs")), `userId` (string), `status` (generationContinuationStatus: `"waiting"` / `"running"` / `"completed"` / `"cancelled"`), `participantSnapshot` (any — serialized participant config), `groupSnapshot` (any — serialized group state), `requestMessages` (any — accumulated OpenRouter messages), `usage` (optional usage object), `toolCalls` (optional array of {id, name, arguments}), `toolResults` (optional array of {toolCallId, toolName, result, isError?}), `activeProfiles` (array of string — active skill tool profiles), `compactionCount` (number), `continuationCount` (number), `partialContent` (optional string), `partialReasoning` (optional string), `scheduledAt` (optional number), `scheduledFunctionId` (optional v.id("_scheduled_functions")), `claimedAt` (optional number), `leaseExpiresAt` (optional number), `createdAt` (number), `updatedAt` (number). Indexes: `by_job` (jobId), `by_status` (status, updatedAt), `by_chat` (chatId, updatedAt). Table count: 36 → 37. |
| **Moved `isJobCancelled` to `internalQuery`** | Was `internalMutation` in `chat/mutations.ts`; now `internalQuery` in `chat/queries.ts`. Pure read operation — all 7 callers changed from `ctx.runMutation` to `ctx.runQuery`. Reduces OCC contention during streaming. |
| **Added orphan continuation reaping to `cleanStale`** | `jobs/cleanup.ts` now scans non-terminal `generationContinuations` rows during each 15-minute cron run. Deletes rows with terminal/missing parent jobs, expired leases (2× lease duration grace), or unclaimed waiting rows (24-minute cutoff). Cancels associated scheduled functions before deletion. |

Table count: 37.

---

*Last updated: 2026-04-13 — Post-M27 durable generation continuations (generationContinuations table, isJobCancelled → internalQuery, orphan continuation reaping). M27 Free Code Execution (png_image chart type, sandboxSessionId optional, sandboxRuntime removal, deprecated runtime tables). Table count: 37.*

---

## PR #78 — Retry Semantics Overhaul (2026-04-22)

| Change | Details |
|--------|---------|
| **Added `retryContract` to `messages`** | `v.optional(retryContract)` — full participant/config snapshot stored on every assistant message at send time. Shape: `{ participants[], searchMode, searchComplexity?, enabledIntegrations?, subagentsEnabled?, turnSkillOverrides?, turnIntegrationOverrides?, videoConfig? }`. Used by all clients as the read-only source of truth for base participant config when retrying a message. Clients must not round-trip it as mutable state. |
| **Added `terminalErrorCode` to `messages`** | `v.optional(terminalErrorCode)` — canonical failure reason stored on failed assistant messages. Values: `"stream_timeout"` / `"provider_error"` / `"cancelled_by_retry"` / `"cancelled_by_user"` / `"unknown_error"`. Replaces per-client string matching on `message.status`. |
| **Added `terminalErrorCode` to `generationJobs`** | Same `terminalErrorCode` validator — stored on failed generation jobs for backend-level failure tracking and cleanup. |
| **New module: `convex/chat/retry_contract.ts`** | Exports `RetryContract`, `RetryParticipantSnapshot`, `RetryVideoConfig`, `RetrySearchMode` types + `cloneRetryContract()` and `buildRetryContract()` helpers. Single source of truth for retry contract assembly. |
| **New module: `convex/chat/terminal_error.ts`** | Exports `TerminalErrorCode` type and `classifyTerminalErrorCode()` function. Fixed a race where `cancelled_by_retry` could be overwritten by late-arriving finalizations from a prior generation. |
| **Cross-platform DTO updates** | iOS, Android, and web `RetryContract` DTOs updated to include `turnSkillOverrides`, `turnIntegrationOverrides`, `videoConfig`, and `systemPrompt` fields. |
| **No new tables** | Table count remains 37. |

### `schema_validators.ts` additions

Two new shared validators added:

- `retryContract` — object validator for the full retry config snapshot
- `retryParticipantSnapshot` / `retrySearchMode` / `retryVideoConfig` — sub-validators used by `retryContract`
- `terminalErrorCode` — union of the 5 terminal error code literals

*Last updated: 2026-04-22 — PR #78 retry semantics overhaul: `retryContract` and `terminalErrorCode` on messages, `terminalErrorCode` on generationJobs, two new backend modules, cross-platform DTO parity.*
