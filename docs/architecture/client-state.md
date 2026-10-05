# Client state, streaming and performance


M35/M36 did not change the product API ownership rule: Convex remains the shared source of truth, and iOS, Android, and web remain thin clients over the same functions. The week’s architecture work reduced client-side blast radius and then used those boundaries for parity polish.

### Client Ownership Boundaries

- **iOS:** `ChatViewModel` remains the SwiftUI-facing facade, but high-risk behavior now lives in tested owners/value types: timeline merge/fallback, composer state, send payload construction, attachment projection, branch projection, audio resource cleanup, picker/modal presentation, and streaming interpolation.
- **Web:** `ChatPage` is split into a route/controller plus `ChatPage.view.tsx` and focused helpers for send, retry, branch, attachment, Drive picker, participants, and search behavior. `useChatOverrides` remains as the compatibility adapter while domain/resolution/state helpers own the smaller pieces.
- **Android:** M34 chat/list owners remain the primary Android boundary. M35/M36 Android changes reuse those owners and add parity helpers rather than re-centralizing route logic.

### UI Parity Semantics

Cross-platform UI parity now treats shared meaning separately from platform-native rendering:

- Status/progress/error tone names are the portable contract; each client maps them to native color/type primitives.
- Generated file, citation, chart, pending/search, attachment, integration, Knowledge Base, and skill surfaces should reuse existing backend fields and client owners before adding new client-only interpretation.
- Visual parity work may add platform-specific components, but status and capability decisions should stay in Convex or in small tested client helpers.

### Skill Catalog Seed Contract

The built-in system skill catalog currently seeds 67 skills. `skills/actions:seedSystemCatalog` upserts active system skills and then hard-deletes removed system skills only after pruning their IDs from all persisted override locations:

- `userPreferences.skillDefaults`
- `personas.skillOverrides`
- `chats.skillOverrides`
- `scheduledJobs.turnSkillOverrides`
- `scheduledJobs.steps[].turnSkillOverrides`

The removed standalone skills are `conditions-precedent-checklist`, `credit-agreement-summary`, `release-notes`, `shareholder-agreement-summary`, and `solo-founder-gtm`. Their workflows are represented by broader active skills rather than separate catalog rows. M40 adds bounded comparison behavior to the existing `document-review` parent skill without adding a workspace or catalog row.

---



### Streaming Protocol
- **`messageChunks` table removed** — was write-only waste (iOS client never read it during streaming)
- **`StreamWriter` utility** (`convex/chat/stream_writer.ts`) — shared class used by all 5 stream producers, encapsulating content/reasoning accumulation, throttled patching, and boundary flushing
- **`streamingMessages` table added** — isolates hot streaming writes from the stable `messages` history so `listMessages` is no longer invalidated for every token patch
- **Tuned patch thresholds**: Content patches at 40 chars first, then every 300ms or 120 chars. Reasoning patches at 24 chars first, then every 200ms or 80 chars, with extra force-flushes on sentence and paragraph boundaries.

### Subscription Deduplication
- **`SharedAppDataStore`** — single `@MainActor @Observable` service holding one subscription each for preferences, personas, model summaries, model settings, and cached credit balance. Replaced 17+ redundant per-view subscriptions.
- **Shallow equality guards** on all subscription handlers prevent unnecessary SwiftUI re-renders when data hasn't actually changed

### Client Compute Caching
- **Two-tier branch cache** in `ChatViewModel` — expensive `computeHasBranches()` only runs on structural changes (messages added/removed); cheaper content refresh runs when message content or reasoning updates during streaming
- **Markdown parse cache** keyed by `messageId + contentHash` instead of full text string — near-100% hit rate during streaming instead of 0%

### Message Pagination
- `listMessages` query supports `before` cursor and `limit` parameter
- iOS subscribes with `limit: 50` (recent window), loads older messages on demand via one-shot queries

### Settings Write Batching
- **`PreferenceWriteBuffer`** actor debounces individual field changes into a single `upsertPreferences` mutation after 500ms of inactivity

### Auth Startup
- Single `.task(id: isFullyActive)` in `RootView` replaces dual `.task` + `.onChange` that could double-trigger Convex auth

### Generation startup
- **Consolidated generation preflight**: `chat/queries_generation_context.ts` replaces a long series of internal round-trips with one batched internal query for message, chat, prefs, persona, and connection state.
- **Query embedding cache**: `messageQueryEmbeddings` stores lease-based per-message embeddings so retries, regeneration, and memory retrieval do not repeatedly pay the embedding cost.
- **Full memory-context cache**: `messageMemoryContexts` stores the hydrated memory-hit payload keyed by `messageId` and `textHash`, allowing the generation action to skip embedding, vector search, and memory hydration on cache hit.
- **OpenRouter instrumentation**: request/stream helpers now record provider TTFB timing and preserve hardened fallback behavior for Anthropic endpoint selection issues.
- **Participant preflight parallelization**: cancellation checks, job-state patch, prefs, persona, chat defaults, and skill catalog inputs are resolved together to remove ~150-230ms of sequential startup latency.

---



### Anthropic Prompt Caching

Anthropic models require explicit opt-in for prompt caching. `openrouter_request.ts` now adds `cache_control: { type: "ephemeral" }` at the top level for all `anthropic/` model requests. Other providers (OpenAI, DeepSeek, Gemini 2.5, Grok, Groq) cache automatically — no special handling needed.

### Model Sync Bandwidth Reduction

The model catalog sync cron was reduced from hourly to every 4 hours. Combined with hash-based skip logic in `sync.ts` (compares a hash of the fetched data against the previous sync), most invocations now do zero mutations. This reduces DB bandwidth by ~75% (~250 MB/month savings). A $50 price cap filter also excludes extremely expensive models from the catalog.

---


---
