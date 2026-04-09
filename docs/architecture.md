# Architectural Decisions

> Confirmed architecture for NanthAI Edge — decisions, layers, dependency injection, navigation, and Convex backend.

## Confirmed Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Identity Auth | Clerk iOS SDK (`ClerkKit` + `ClerkKitUI`) | Managed identity provider; native sign-in UI, session tokens, user profiles |
| API Key Provisioning | Native PKCE via `ASWebAuthenticationSession` | Retained for OpenRouter key exchange after Clerk sign-in |
| Auth State Machine | Two-phase: Clerk identity → OpenRouter key | `Signed Out → Clerk Sign-In → Signed In, No Key → Connect OpenRouter → Fully Active` |
| Persistence | **Convex** (server-side, realtime subscriptions) | Replaced SwiftData/CloudKit in M8; all data lives in Convex tables |
| LLM Orchestration | **Convex Actions** (server-side) | All OpenRouter calls, streaming, title gen, memory extraction run on Convex backend |
| Realtime Sync | **Convex reactive queries** over WebSocket | iOS subscribes to queries; UI updates automatically as server writes data |
| Model registry | Dynamic fetch + Convex cache | Cron-synced model catalog stored in Convex `cachedModels` table |
| Streaming | **Server-side** via Convex Actions + `StreamWriter` | Convex patches `messages.content`/`reasoning` in-place; iOS sees updates via subscription. `messageChunks` table removed (M9.5). |
| State | `@Observable` (Observation framework) | Modern SwiftUI, fine-grained updates |
| Concurrency | Swift structured concurrency (async/await, actors) | Thread-safe, no Combine needed |
| Secrets | Keychain via Security framework | OS-level encryption for API keys |
| Navigation | `NavigationSplitView` (iPad) / `NavigationStack` (iPhone) | Adaptive layout |
| Navigation (Android) | `ListDetailPaneScaffold` (tablet) / single-pane `NavHost` (phone) | Material 3 Adaptive — M25 |
| Navigation Coordination | `NavigationCoordinator` with `NavigationPath` | Programmatic navigation, deep linking |

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│                   SwiftUI Views                  │
│     (Chat, Ideascape, Settings, Memory, etc.)    │
├─────────────────────────────────────────────────┤
│                  ViewModels                      │
│      (@Observable, own the presentation logic)   │
├─────────────────────────────────────────────────┤
│           SharedAppDataStore (M9.5)              │
│  (Single global subscriptions: preferences,      │
│   personas, modelSummaries, modelSettings,       │
│   creditBalance)                                 │
├─────────────────────────────────────────────────┤
│              AppDependencies                     │
│  (DI container injected via .environment())      │
├─────────────────────────────────────────────────┤
│               ConvexService                      │
│  (ConvexMobile client — subscriptions, mutations │
│   actions, one-shot queries, Clerk JWT auth)     │
├─────────────────────────────────────────────────┤
│            Convex Backend (Server)               │
│  (Schema, mutations, actions, queries, crons,    │
│   StreamWriter, OpenRouter, memory, autonomous)  │
├─────────────────────────────────────────────────┤
│              Platform Services                   │
│    (Keychain, ASWebAuth, Clerk SDK)              │
└─────────────────────────────────────────────────┘
```

## Dependency Injection — AppDependencies Container

All services are bundled into a single `@Observable` container, injected via SwiftUI's `.environment()` modifier at the app root. ViewModels receive `AppDependencies` from the environment.

```swift
@MainActor
@Observable
final class AppDependencies {
    let appState: AppState
    let auth: any AuthServiceProtocol
    let convex: ConvexService
    let sharedStore: SharedAppDataStore       // M9.5: centralized subscriptions
    let preferenceBuffer: PreferenceWriteBuffer // M9.5: debounced preference writes
    var now: () -> Date
    ...
}
```

**Post-M8 simplification (updated M9.5):**
- No more `OpenRouterService`, `ChatService`, `ModelCacheService`, `PersonaService`, `MemoryService`
- All business logic moved to Convex backend functions
- `ConvexService` is the single gateway for all data operations (subscriptions, mutations, actions, one-shot queries)
- `SharedAppDataStore` holds one global subscription per shared data type (preferences, personas, model summaries, model settings), replacing 17+ redundant per-view subscriptions
- `PreferenceWriteBuffer` debounces settings writes (500ms) into batched mutations
- ViewModels call Convex mutations/actions and subscribe to queries directly; shared data is read from `SharedAppDataStore`

```swift
// App entry point — no SwiftData ModelContainer
@main
struct NanthAi_EdgeApp: App {
    @State private var dependencies = AppDependencies()
    @State private var clerk = Clerk.configure(publishableKey: AppConstants.clerkPublishableKey)

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(dependencies)
                .environment(clerk)
                .environment(\.clerkTheme, Self.nanthaiClerkTheme)
        }
    }
}
```

## Navigation — NavigationCoordinator

Programmatic navigation via `NavigationPath` enables deep linking and keeps navigation state testable.

```swift
@Observable
class NavigationCoordinator {
    var chatListPath = NavigationPath()
    var selectedChatId: String?   // Convex document ID (was UUID pre-M8)

    func showChat(_ chatId: String) {
        selectedChatId = chatId
    }

    func popToRoot() {
        chatListPath.removeLast(chatListPath.count)
        selectedChatId = nil
    }
}
```

## Convex Backend Architecture

The Convex backend handles all server-side logic:

- **Chat orchestration**: `sendMessage` mutation creates messages + schedules `runGeneration` action
- **Streaming**: Server writes active content/reasoning/tool-call patches into `streamingMessages` via `StreamWriter`, while `messages` remains the stable persisted history. Clients merge `chat/queries:listMessages` with `chat/queries:listStreamingMessages`; `finalizeGeneration` copies final output back into `messages` and removes the overlay row.
- **Autonomous group chat**: Multi-participant turns, moderator directives, consensus checks
- **Memory**: Vector search (cosine similarity), extraction, consolidation, gating
- **Model catalog**: Cron-synced from OpenRouter API
- **Personas, Folders, Preferences**: Full CRUD with per-user scoping
- **Node positions**: Ideascape spatial data

All functions authenticate via Clerk JWT (`ctx.auth.getUserIdentity().subject`).

### Convex Function Modules

| Module | Functions | Purpose |
|--------|-----------|---------|
| `chat/mutations` | sendMessage, updateTitle, deleteChat, etc. | Chat CRUD + generation scheduling |
| `chat/actions` | runGeneration | Server-side OpenRouter streaming via `StreamWriter` |
| `chat/manage` | updateChat, switchBranchAtFork, deleteChat, bulkDeleteChats, forkChat, duplicateChat, reorderPinnedChats | Chat management — archive, canonical fork switching, duplicate, fork, pin/unpin, reorder pinned |
| `chat/queries` | listChats, getMessages, getChat, getAttachmentUrl, listModelSummaries, listKnowledgeBaseFiles | Reactive data subscriptions |
| `chat/audio_actions` | generateAudioForMessage, previewVoice | TTS generation via `gpt-audio-mini`, PCM→WAV encoding, Convex storage (M20) |
| `chat/audio_shared` | constants, pcmToWav, voice helpers, isLyriaModel, parseMp3DurationMs | Audio constants, encoder, 6-voice catalog (M20), Lyria model IDs + MP3 frame parser (M26) |
| `chat/audio_trigger` | autoAudioTrigger | Wired into finalizeGenerationHandler for auto-audio responses (M20) |
| `chat/audio_public_handlers` | requestAudioGeneration, getMessageAudioUrl | Public mutation/query handlers for audio (M20) |
| `tools/` | registry, execute_loop, progressive_registry, profile registries, index | Tool infrastructure — small base registry plus progressively unlocked document, integration, subagent, and workspace/runtime tool families. |
| `runtime/` | just-bash client, Pyodide/Vercel Sandbox analytics, chart helpers | Per-generation workspace, notebook-style Python analytics, artifact export (M19, rewritten M27). |
| `capabilities/` | queries, mutations, shared helpers | Account capability model layered on top of purchase entitlements (M19). |
| `skills/tool_profiles.ts` | skill profile normalization helpers | Derives `requiredToolProfiles`, runtime mode, and capability consistency for built-in and user-authored skills (post-M19). |
| `lib/` | auth, compaction_constants, openrouter_*, tool_capability (post-M14) | Shared backend utilities — Pro gating, compaction config, OpenRouter streaming, tool capability model assertions |
| `tools/google/` | auth, gmail (6), drive (4), calendar (3), index | Google Workspace integration — 14 OAuth-gated tools (M10 Phase B) |
| `tools/microsoft/` | auth, outlook (6), onedrive (4), calendar (3), index | Microsoft 365 integration — 14 OAuth-gated tools (M10 Phase C) |
| `tools/notion/` | auth, pages (7), index | Notion integration — 7 OAuth-gated tools (M10 Phase D) |
| `oauth/google.ts` | exchangeGoogleCode, refreshGoogleToken, disconnectGoogle | Google OAuth PKCE token exchange + management |
| `oauth/microsoft.ts` | exchangeMicrosoftCode, refreshMicrosoftToken, disconnectMicrosoft | Microsoft OAuth PKCE token exchange + management |
| `oauth/notion.ts` | exchangeNotionCode, refreshNotionToken, disconnectNotion | Notion OAuth token exchange (HTTP Basic Auth) + management |
| `http.ts` | `/download` endpoint | File download with Content-Disposition headers (M10) |
| `subagents/` | actions, mutations, queries, shared | Depth-1 delegated child runs, async parent resume, continuation checkpoints |
| `autonomous/` | actions, mutations, queries | Multi-participant autonomous chat |
| `memory/operations` | extract, search, consolidate | Vector-based memory system |
| `memory/shared` | categories, retrieval modes, scope types, source types | Single source of truth for memory type definitions (post-M14) |
| `memory/operations_args` | argument validators | Zod-like validators for memory operations (post-M14) |
| `memory/operations_import_handlers` | document import pipeline | Extract memories from imported documents (post-M14) |
| `memory/operations_public_handlers` | public CRUD handlers | User-facing memory mutation handlers (post-M14) |
| `memory/operations_internal_handlers` | internal handlers | System-level memory operations (post-M14) |
| `memory/embedding_helpers` | embedding utilities | Embedding generation helpers (post-M14) |
| `personas/` | mutations, queries | Persona CRUD |
| `favorites/` | mutations, queries | Quick-launch favorites — CRUD + reorder (max 20 per user, max 3 models each) |
| `folders/` | mutations, queries | Folder organization |
| `preferences/` | mutations, queries | User prefs + model settings |
| `models/sync` | syncModels, listModelSummaries | Cron-driven model catalog + lightweight projection query |
| `push/` | actions, mutations, mutations_internal, queries | Provider-based push delivery (`apns` + `fcm`) with shared token management and payload routing (M13.5/M16) |
| `scheduledJobs/` | actions, actions_execution, actions_execution_policy, actions_handlers, actions_lifecycle, actions_types, mutations, queries, recurrence, shared | User-created recurring AI tasks — multi-step pipelines, execution tracking, cron parsing, fan-out execution (M13, extended post-M14) |
| `nodePositions/` | mutations, queries | Ideascape spatial positions |

---

## M9.5 Performance Architecture Changes

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

---

## M10 Tool-Calling Architecture

### Decision: Keep Existing Pipeline

The app's hand-rolled `convex/lib/openrouter_*` streaming pipeline is extended with tool-call support rather than migrating to `@convex-dev/agent`. Rationale: fundamental data model mismatch (tree-branched messages vs. linear threads), multi-model fan-out incompatibility, and ~20 OpenRouter-specific features that would be lost.

### Skill-led progressive tool loading

The current architecture now uses additive, skill-led profile expansion during the tool loop:

1. start with a small base registry
2. inject a NanthAI prelude, runtime guard, and lightweight skill catalog
3. when the model calls `load_skill`, read `requiredToolProfiles`
4. rebuild the next-turn `tools` array from the expanded active profile set
5. continue the loop with the newly available domain tools

This keeps ordinary requests lightweight while still allowing specialized workflows to unlock docs, integrations, analytics, or workspace capabilities on demand.

For a product-facing summary of which tiers expose which skills and tool families, see [`tool-skill-access.md`](tool-skill-access.md).

### Tool Infrastructure

```
┌─────────────────────────────────────────────────┐
│         Entry Points (3 callers)                 │
│  runGeneration · paperPhase · regeneratePaper    │
├─────────────────────────────────────────────────┤
│           buildToolRegistry()                    │
│   (convex/tools/index.ts — single source)        │
├─────────────────────────────────────────────────┤
│              ToolRegistry                        │
│   .register(tools)  .getDefinitions()            │
│   .executeTool(name, args, ctx)                  │
├─────────────────────────────────────────────────┤
│         runToolCallLoop()                        │
│   Up to 20 rounds: execute → feed results →      │
│   re-call OpenRouter → stream response           │
├─────────────────────────────────────────────────┤
│          61 Total Tools                           │
│                                                  │
│   ALWAYS-ON / Tier 1 (15):                       │
│   OOXML (9):                                     │
│     generate_docx · read_docx · edit_docx        │
│     generate_pptx · read_pptx · edit_pptx        │
│     generate_xlsx · read_xlsx · edit_xlsx         │
│   Text/Email (4):                                │
│     generate_text_file · read_text_file           │
│     generate_eml · read_eml                       │
│   Utility (1): fetch_image                       │
│   Image Support: image_resolver (shared helper)  │
│                                                  │
│   GOOGLE WORKSPACE / Tier 2 (14):                │
│   Gmail (6): search · read · send · reply ·      │
│     trash · batch_modify                         │
│   Drive (4): search · upload · download · move   │
│   Calendar (3): list · create · delete           │
│   Barrel: convex/tools/google/index.ts           │
│                                                  │
│   MICROSOFT 365 / Tier 2 (14):                   │
│   Outlook (6): search · read · send · reply ·    │
│     delete · move                                │
│   OneDrive (4): search · upload · download · move│
│   MS Calendar (3): list · create · delete        │
│   Barrel: convex/tools/microsoft/index.ts        │
│                                                  │
│   NOTION / Tier 2 (7):                           │
│   Pages (5): search · read · create · update ·   │
│     delete                                       │
│   Database (2): query · update_entry             │
│   Barrel: convex/tools/notion/index.ts           │
│                                                  │
│   APPLE CALENDAR / Tier 2 (4):                   │
│   Calendar (4): list · create · update · delete  │
│   CalDAV via tsdav — iCal format parse/build     │
│   Barrel: convex/tools/apple/index.ts            │
│                                                  │
│   SCHEDULED JOBS + PERSONA + SEARCH / M13 (6):   │
│   Scheduled (3): create · list · delete           │
│   Persona (2): create · delete                    │
│   Search (1): search_chats                        │
│   Files: tools/scheduled_jobs.ts,                 │
│     tools/persona.ts, tools/search_chats.ts       │
└─────────────────────────────────────────────────┘
```

### Tool Execution Flow

1. `buildProgressiveToolRegistry(...)` creates a small base registry, then later turns expand it with profile-specific tools after `load_skill`
2. Registry's `getDefinitions()` produces OpenAI-format `tools` array injected into OpenRouter request
3. If OpenRouter responds with `finish_reason: "tool_calls"`, `runToolCallLoop()` takes over
4. Loop: parse tool calls → execute via `registry.executeTool()` → append `{role: "tool", tool_call_id, content}` → re-stream with all messages + tools
5. Repeats until `finish_reason: "stop"` or 20 rounds exhausted
6. Each loop iteration streams content to the user via `StreamWriter`

### Tool Gating Strategy

- **Base tools**: Minimal shared registry for normal tool-capable chats (`fetch_image`, `search_chats`, scheduled jobs, persona tools, skill tools including `load_skill`).
- **Profile-expanded tools**: Documents, connected apps, runtime/analytics, and subagents are added on later turns after a loaded skill unlocks the corresponding `requiredToolProfiles`.
- **Connection-gated tools**: Google Workspace, Microsoft 365, Notion, and Apple Calendar profiles only register tools when the relevant integrations are both requested and actually connected.
- **Subagent tool**: `spawn_subagents` now lives behind the `subagents` profile, so it is only exposed after a loaded skill calls for delegated parallel work. Child runs never receive this tool.

### Subagent Execution Flow

1. Parent request starts without `spawn_subagents` in the base registry.
2. If a loaded skill unlocks the `subagents` profile, the next parent turn includes `spawn_subagents`.
3. Parent model emits a `spawn_subagents` tool call with 1-3 focused tasks.
4. Convex persists the parent tool-call round, creates a `subagentBatch`, and exits the parent action cleanly.
5. Each child run streams independently using the same participant/model/settings/integrations as the parent, minus `spawn_subagents`.
6. If a child nears the Convex action budget, it checkpoints to `waiting_continuation` with a compacted conversation snapshot and immediately schedules a continuation action.
7. When all children are terminal, Convex reconstructs the parent tool round and injects a synthetic tool result containing all child summaries and statuses.
8. A fresh OpenRouter request resumes the parent into the same visible assistant message.

Terminal child states:

- `completed`
- `failed`
- `cancelled`
- `timedOut`

### Integration Toggle Flow (M10 Phase B)

```
Persona defaults (enabledIntegrations: ["gmail", "drive", "calendar", "outlook"])
    ↓
Chat-level overrides (user toggles via MessageInput + menu)
    ↓
Effective integrations sent as `enabledIntegrations` in sendMessage args
    ↓
Backend: parallel check Google + Microsoft + Notion + Apple Calendar connection status
    ↓
Intersection: only integrations with active connections are passed to buildToolRegistry()
    ↓
Tool registry includes only relevant tool groups
```

Per-chat overrides are persisted to the `chats` table for: temperature, max tokens, reasoning (include + effort), subagent toggle, and search settings (web search on/off, search mode, search complexity). All follow the same pattern — `nil`/absent = inherit global default from `userPreferences`.

### External Integration Connection Flows (M10 Phases B/C/D + Apple Calendar follow-on)

Google, Microsoft, and Notion follow the same general iOS → Convex token exchange pattern (with provider-specific differences):

1. iOS opens `ASWebAuthenticationSession` with provider's consent screen
2. User authorizes → callback with authorization code
3. iOS calls Convex action (`exchangeGoogleCode` / `exchangeMicrosoftCode` / `exchangeNotionCode`) with code + verifier/state
4. Convex exchanges code for tokens via provider's token endpoint
5. Tokens stored in `oauthConnections` table (access + refresh + expiry + scopes + email)
6. Auto-refresh: tool auth helpers check expiry before each API call, refresh transparently

**Key differences:**
- **Google** uses PKCE + `client_secret` in token exchange (iOS client type)
- **Microsoft** uses PKCE but does NOT send `client_secret` (public/native client — AADSTS90023 error if included)
- **Notion** uses HTTP Basic Auth (`base64(client_id:client_secret)`) for token exchange — no PKCE. JSON request body (not form-encoded). OAuth redirect goes through HTTPS relay page at `nanthai.tech` since Notion requires `https://` redirect URIs. No scopes — access is page-level (user chooses during OAuth consent).
- **Apple Calendar** is not OAuth-based in the current design. iOS collects the Apple Account email that owns the iCloud calendar plus an Apple app-specific password. Convex stores those credentials, discovers the user's CalDAV calendars, and executes server-side event CRUD through a thin `tsdav` wrapper.

**API call pattern:** Google, Microsoft, and Notion API calls use raw `fetch()` — no Node.js SDKs (`googleapis`, `@microsoft/microsoft-graph-client`). Apple Calendar is the intentional exception: a thin `tsdav` wrapper handles CalDAV discovery and event CRUD while the rest of the tool stack stays in native Convex TypeScript.

### File Storage & Download

- Tools store generated files via `ctx.storage.store(blob)` → returns `storageId`
- `convex/http.ts` exposes a `/download?storageId=X&filename=Y` HTTP endpoint for named file downloads
- Security: no auth on download endpoint — relies on unguessability of 128-bit random storage IDs (same as Convex's built-in `storage.getUrl()` signed URLs)

### OpenRouter Tool-Call Protocol

- Request: `tools` array of `{type: "function", function: {name, description, parameters}}`, optional `tool_choice`
- `tools` param must be included in EVERY request (initial + follow-up with tool results)
- SSE streaming: `choices[0].delta.tool_calls` arrives incrementally (index-based merging)
- Finish: `finish_reason: "tool_calls"` triggers execution loop
- Tool results: `{role: "tool", tool_call_id, content}` messages fed back with full `tools` array

---

## M13 Scheduled Jobs, Context Compaction & Pro Gating Architecture

### Scheduled Job Execution Pipeline

User-created recurring AI tasks execute entirely server-side:

1. User creates a job (via Settings UI or `create_scheduled_job` AI tool) with cron expression + prompt + persona + model
2. `runScheduledJobs` cron (every 5 minutes) queries due jobs → fans out to `executeScheduledJob` action per job
3. Action creates a `jobRun` (status: running), a new chat (source: "scheduled", sourceJobId, sourceJobName), then calls `runGeneration` with full tool access
4. On completion: job run marked complete, `nextRunAt` advanced via cron parser. On failure: job run marked failed with error message
5. `cleanOldJobRuns` cron (daily at 5 UTC) prunes runs older than 30 days

**Cron parsing**: Standard cron (5-field) with OR semantics when both DOM and DOW are restricted. 366-day horizon for `nextRunAt` calculation.

**Model fallback policy**: `create_scheduled_job` tool fails with actionable error if no modelId provided and no default model set. No hard-coded fallback.

**Scheduled functions lack auth context** — `userId` is passed as an explicit argument from the cron fan-out.

### Context Compaction

Token-aware compaction system for long tool-call loops:

- Triggers within `runToolCallLoop()` when accumulated messages approach the model's context window
- Uses `google/gemini-3.1-flash-lite-preview` (via OpenRouter) to summarize earlier messages into a compact context block
- **Mid-loop `shouldExitLoop` callback** checks between tool rounds — only exits when `finishReason !== "tool_calls"` to avoid dropping pending tool calls
- Original spec described post-loop compaction only; improved to check between rounds
- If compaction model is unavailable, compaction silently skips (generation continues without compaction)
- Constants in `convex/lib/compaction_constants.ts`

### API Key Server-Side Storage

OpenRouter API key stored in `userSecrets` table for headless scheduled job execution:

- **Sync points**: During PKCE exchange (after key is stored in Keychain) + on every app launch (`upsertApiKey` mutation called in `RootView` bootstrap)
- **Security**: Convex access controls restrict reads to owning user. Device Keychain remains canonical; server copy is a sync target.
- **Option 3 strategy** (chosen over env var or per-job encryption)

### Pro Gating Infrastructure

Current Pro gating implementation:

- `requirePro(ctx)` in `convex/lib/auth.ts` enforces backend entitlement checks using `purchaseEntitlements`
- `getProStatus` / `checkProStatus` in `convex/preferences/queries.ts` expose the live entitlement-backed Pro state for UI/tool gating
- `userPreferences` no longer acts as the client-facing Pro source; mobile clients subscribe to `getProStatus`
- all clients gate Pro features from the entitlement-backed Convex state; StoreKit is only a purchase/restore input on iOS
- Pro-gated chat capabilities now include personas, autonomous discussions, advanced search, memory writes, tool access, and subagents

### New AI Tools (7 — Total: 57)

| Tool | File | Purpose |
|------|------|---------|
| `create_scheduled_job` | `tools/scheduled_jobs.ts` | Create a recurring AI task with cron expression |
| `list_scheduled_jobs` | `tools/scheduled_jobs.ts` | List user's scheduled jobs |
| `delete_scheduled_job` | `tools/scheduled_jobs.ts` | Delete a scheduled job |
| `create_persona` | `tools/persona.ts` | Create a new persona (checks for duplicates internally) |
| `delete_persona` | `tools/persona.ts` | Delete an existing persona |
| `search_chats` | `tools/search_chats.ts` | Full-text search across user's chat history |
| `spawn_subagents` | `tools/spawn_subagents.ts` | Delegate up to 3 focused child runs and resume when all are terminal |

### Automated Chat Indicators (UX)

- Clock icon + job name subtitle in chat list rows
- "Scheduled" filter in folder filter bar
- Job name in chat header (provenance subtitle)
- NO in-chat message-level labels

---

*Last updated: 2026-04-09 — M27 Free Code Execution (three-tier runtime, sandboxRuntime gate removed). M26 Lyria music generation, Anthropic prompt caching, model sync bandwidth reduction. M25 Android tablet adaptive navigation. M24 complete.*

---

## M13.5 Search Tiers, Chat Interactions & Push Notifications

### Search Tier Architecture

Internet search expanded from 2 tiers (Web / Research Paper) to 3:

| Tier | Search Mode | Backend Path | Notes |
|------|------------|--------------|-------|
| Basic | `"normal"` | Path B — OpenRouter `web` plugin | Native search for OpenAI/Anthropic/xAI; Exa for others (~$0.02/req) |
| Web Search | `"web"` | Path C — Perplexity/Sonar | Complexity 1-3 (Quick/Thorough/Comprehensive) |
| Research Paper | `"paper"` | Path D — Multi-phase research pipeline | Complexity 1-3, full tool support |

**Globe tap behavior**: Single tap toggles the user's default search mode (from Settings) on/off. Long-press opens the full 3-tab `SearchPanelView` for overrides.

**Settings integration**: `defaultSearchMode` ("basic"/"web"/"paper") and `defaultSearchComplexity` (1-3) on `userPreferences`. Scheduled jobs have `searchMode` and `searchComplexity` fields replacing the boolean `webSearchEnabled`.

**Per-chat persistence**: When a user toggles search or changes search mode/complexity within a specific chat, the override is persisted to the `chats` table (`webSearchOverride`, `searchModeOverride`, `searchComplexityOverride`). These survive navigation, app backgrounding, and relaunch. `nil` = inherit global default. Follows the same pattern as `temperatureOverride`, `maxTokensOverride`, `includeReasoningOverride`, `reasoningEffortOverride`. A `hasAppliedSearchOverrides` guard on both iOS and Android ensures overrides from the chat subscription are only applied during initial load, preventing local state from being overwritten on every subscription tick.

### Message Queueing with Stream Interruption

While the AI is streaming, the user can queue **one** follow-up message:

1. Queued message appears as a card above the input (preview text + Edit + Send + dismiss)
2. **Interrupt-on-send**: Tapping Send calls `cancelGeneration` mutation → marks streaming message as `"cancelled"` → queued message sent immediately
3. **Auto-fire**: If streaming finishes naturally, queued message fires automatically via existing `drainQueuedFollowUpsIfNeeded()` pipeline
4. Partial assistant response preserved in chat (not deleted). Backend includes cancelled message in context for continuity.

### Push Notification Architecture (Provider-Based)

```
iOS App                              Convex Backend
  1. AppDelegate receives           2. registerDeviceToken mutation
     APNs token ──────────────▶        (upsert in deviceTokens table)

                                    3. Generation completes →
  5. NotificationService               finalizeGenerationHandler checks
     receives push ◀──────────────     chat.sourceJobId → schedules
  6. isUIReady?                        sendPushNotification action
     → warm: selectedChatID        4. Action: ES256 JWT + POST to
     → cold: pendingDeepLinkChatID     api.push.apple.com
```

### Push Delivery Pipeline

1. **Token registration**: Platform clients call `registerDeviceToken` with provider metadata (`apns` or `fcm`), persisted in `deviceTokens` via provider-based indexing. On iOS this still flows through `AppDelegate` → `NotificationService` with post-auth token sync handling.

2. **Push trigger**: Centralized in `finalizeGenerationHandler` (`convex/chat/mutations_internal_handlers.ts`). All 4 generation paths (A/B/C/D) converge here. Only fires for scheduled-job chats (`chat.sourceJobId` present).

3. **JWT signing**: ES256 with WebCrypto (`crypto.subtle`). P8 key from `APNS_PRIVATE_KEY` env var. DER-to-raw signature conversion. PEM `\n` literal handling for env var escaping.

4. **Environment filtering**: Maps `APNS_ENVIRONMENT` (development/production) to token environment (sandbox/production). Only sends to matching tokens.

5. **Stale token cleanup**: HTTP 410 Gone → `deleteStaleToken` internal mutation.

6. **Deep-link routing**: `isUIReady` flag on `AppState` distinguishes warm (navigate directly) from cold (stash in `pendingDeepLinkChatID`, apply after bootstrap).

### AppState Extensions (M13.5)

```swift
@MainActor @Observable
final class AppState {
    var selectedChatID: String?
    var appearanceMode: String?
    var isUIReady = false              // Set true after RootView bootstrap
    var pendingDeepLinkChatID: String? // Cold-launch deep link stash

    func applyPendingDeepLink()        // Consume pending → selectedChatID
}
```


## Core Features Architectures

### Autonomous Group Chat (M12)
- **Turn-based multi-participant flow**: Replaced simultaneous streaming with ordered turns.
- **Orchestration Loop**: Managed by `AutoGroupChatOrchestrator` (or backend equivalent), handling cycle limits, pause/resume, and immediate interventions (send now).
- **Consensus & Directives**: Supported alongside moderator directives.
- **Context Handling**: Sibling sets anchor to the active leaf to reflect shared context.

### Memory System (M11)
- **Extraction**: Runs post-assistant-reply asynchronously using a configured model (default `openai/gpt-5-mini`).
- **Gating**: Configurable extraction gates (automatic, manualConfirm, disabled) based on `UserPreferences`, but the entire memory UI and backend access path are Pro-gated at the product level.
- **Storage**: Real-time Convex database (replacing SwiftData). Uses atomic fact storage.
- **Injection**: Retrieved via keyword + recency match and injected as a system block context in generation requests.
- **Revocation Cleanup**: If Apple revokes/refunds Pro access, `revokeEntitlement` disables memory preferences and schedules a purge of the user's memories and memory embeddings.

### Convex-Native Tool Registry (M10)
- **Execution Loop**: Uses an iterative loop (`runToolCallLoop()`) up to 20 rounds, re-calling OpenRouter with tool results before final stream.
- **Registry Structure**: `ToolRegistry` manages strongly typed tool definitions and dispatches execution dynamically.
- **Document & Spreadsheet Tooling**: Custom JSZip-based readers/writers (`docx`, `xlsx`, `pptx`) function entirely in Convex V8 environments, generating files without relying on external SaaS.
- **Integration**: Supports Google Workspace and MS 365 OAuth with tool injection into request params.

### Scheduled Jobs (M13)
- **Self-Rescheduling Pattern**: Instead of static crons, dynamically reschedules itself using `ctx.scheduler.runAt(nextRunTime, self, {jobId})`.
- **Execution Lifecycle**: Reads job config, schedules the next occurrence immediately when the job fires, runs the generation pipeline, then triggers the local notification via subscription mutation. Scheduling first reduces the risk of active jobs becoming orphaned if execution fails mid-run.
- **Context Compaction**: Uses cheap models to compress prompt history automatically if a tool-calling chain or job nears context limits.

## M19/M27 Runtime & Analytics Architecture

M19 introduced runtime capability scaffolding and analytics tools. M27 replaced the E2B sandbox provider with a three-tier free execution architecture and removed the `sandboxRuntime` capability gate — all Pro users now have code execution and analytics.

### Access model

- All workspace tools, analytics tools, and runtime-only skills are available to all Pro users
- No additional capability grant needed (M27 removed `sandboxRuntime` gate)
- Tool exposure is controlled by progressive tool discovery via skill loading

### Execution model

- **Per-generation sandbox** for workspace tools (just-bash)
- sandbox created lazily on first workspace tool call, reused for all subsequent calls in the same generation
- stopped in the generation cleanup path (finally block)
- no cross-generation persistence — each generation starts fresh
- durable artifacts exported back to Convex storage

### Runtime tool families

- generic workspace tools: read/write/list/exec/export/reset
- analytics tools: `data_python_exec` (Pyodide WASM), `data_python_sandbox` (Vercel Sandbox)

The analytics tools use Pyodide (in-process WASM) or Vercel Sandbox (cloud) so Matplotlib outputs can become:

- generated file exports (PNG/data files) stored in Convex `_storage`
- inline chart images rendered via URL detection in all three platform markdown renderers

### Client rendering (M27)

- All three platforms (web, iOS, Android) detect Convex download URLs in the model's markdown response and render them as inline images
- URL pattern: `https://*.convex.site/download?storageId=...&filename=*.png`
- Structured chart renderers (Swift Charts, Compose chart cards) exist but are dead code — 100% of generated charts are `png_image` type

### Push Notification Delivery (M13.5/M16)
- **Token Registration**: Uses `UIApplicationDelegateAdaptor` to get device tokens, syncs them to Convex `deviceTokens` table (with handling for race conditions against Convex authentication).
- **Trigger Strategy**: Centralized in `finalizeGenerationHandler` (so push fires exactly when generation completes, not when queued). Only fires for chats where `sourceJobId` is present.
- **Backend Execution**: Provider-routed by `deviceTokens.provider`; APNs delivery uses ES256 JWT signing via V8 `WebCrypto` (`crypto.subtle`) and FCM delivery uses OAuth bearer token flow plus per-token error parsing for deterministic failure handling.
- **Deep-linking Handling**: `isUIReady` state differentiates between warm launches (direct navigation to chat) and cold launches (stash `pendingDeepLinkChatID` until application auth bootstrap completes).

### Message Queueing & Stream Interruption (M13.5)
- **Interrupt Flow**: While the AI is streaming, sending a queued message calls `cancelGeneration`.
- **Context Preservation**: The mutation marks the currently streaming message as `"cancelled"` and halts the writer. However, the partial text already streamed is retained in the database and included in the context window for the next queued message so the AI understands what it successfully produced before being cut off.

---

## M14 Onboarding, Paywall & Pro Gating Architecture

### StoreKit 2 — Two-Phase Lifecycle

`StoreService` uses a deliberate two-phase lifecycle so StoreKit product data is available before Convex auth completes:

**Phase 1 — `startLocal()`**: Called from the onboarding carousel's `.task` (before sign-in). Loads the IAP non-consumable product (e.g. `<your-iap-product-id>`), checks `Transaction.currentEntitlements`, starts a `Transaction.updates` listener. Sets `isPurchased = true` if an active entitlement exists.

**Phase 2 — `connectConvex(_:)`**: Called after Convex auth completes. Wires in `ConvexService`. Any entitlement found in Phase 1 is held in `pendingSyncTransaction` and flushed immediately by calling `syncEntitlement` mutation.

**Revocation**: `Transaction.updates` detects `transaction.revocationDate != nil`. Sets `isPurchased = false`, calls `revokeEntitlement` Convex mutation → which sets `isMemoryEnabled: false`, `memoryGatingMode: "disabled"`, and schedules `purgeUserMemories` immediately.

### Pro Status

Pro is unlocked from the Convex entitlement state:
- `sharedStore.hasProEntitlement` — Convex reactive state from `preferences/queries:getProStatus`

StoreKit local state is not used as a second feature-gating source. It only exists to:
- drive the purchase / restore UI
- sync verified App Store transactions into Convex entitlements

This check is implemented in:
- `AppDependencies.isProUser` (computed property — used for imperative branching)
- `ProGateModifier` / `ProGatedNavigationLink` (used for SwiftUI view gating)

### Pro Gating — iOS Patterns

Two complementary patterns in `Views/Shared/ProGateModifier.swift`:

**Pattern A — `.proGated(feature:)` ViewModifier**: For free users, wraps content with `disabled(true).opacity(0.6)` and an invisible tap-intercepting overlay that presents `PaywallView` as a sheet. Used on buttons, toggles, and menu items. Full VoiceOver support.

**Pattern B — `ProGatedNavigationLink`**: For free users renders a `Button` that shows the paywall + appends `ProBadge()` to the label. For Pro users renders a normal `NavigationLink`. Used for settings sections and feature entry points.

**`ProBadge`**: Small "PRO" capsule label used in picker sections, settings rows, and navigation links to signal locked features.

### AppDependencies (M14 additions)

```swift
@MainActor @Observable
final class AppDependencies {
    // ... existing services ...
    let store: StoreService                     // M14: StoreKit 2

    // Convenience — true if EITHER Convex OR StoreKit says Pro
    var isProUser: Bool {
        sharedStore.hasProEntitlement || store.isPurchased
    }
}
```

`StoreService` is wired at construction: `sharedStore.notificationService = self.notifications` sets up the credit threshold evaluation pipeline. `store.startLocal()` is called from the onboarding carousel, not from `AppDependencies.init()`, to avoid blocking the DI container.

### Onboarding Coordinator Flow

```
App Launch
    ↓
RootView auth check:
  onboardingCompleted in UserDefaults?  ←— fast local check (no network)
  No → Show OnboardingView (coordinator)
  Yes → Normal auth state machine
    ↓
OnboardingView
  └── OnboardingCarouselView (.task → store.startLocal())
        Pages 1–4: value screens
        Page 5: Free vs Pro (live StoreKit purchase button)
        Page 6: "Get Started" → Sign In CTA
    ↓
  Clerk sign-in (ClerkKit UI)
    ↓
  OpenRouterConnectionView (PKCE key exchange)
    ↓
  setOnboardingCompleted Convex mutation (marks UserDefaults + Convex)
    ↓
  Main app
```

Returning users: `onboardingCompleted: true` in Convex preferences takes precedence over UserDefaults (handles reinstall / new device). Reconciliation: if Convex says completed but UserDefaults doesn't, write UserDefaults. If UserDefaults says completed, skip carousel without waiting for Convex.

### Convex Entitlement Mutations (M14)

| Mutation / Query | Purpose |
|-----------------|---------|
| `syncEntitlement({ originalTransactionId })` | Called after purchase. Idempotent — re-calling with same ID updates the App Store entitlement row in `purchaseEntitlements`. |
| `revokeEntitlement()` | Called on StoreKit revocation/refund. Revokes active App Store entitlement rows, disables Pro-only preference toggles, and schedules `purgeUserMemories`. |
| `setOnboardingCompleted()` | Called after OpenRouter key stored. Sets `onboardingCompleted: true`. |
| `getProStatus()` | Public query. Returns entitlement-backed Pro status for native client UI gating. |
| `checkProStatus` (internalQuery) | Takes `userId: string`. Used by generation actions for server-side Pro gating. |

**`requirePro(ctx, userId)`** in `convex/lib/auth.ts`: Resolves active entitlement state from `purchaseEntitlements` (with a temporary migration fallback for legacy tester rows). Throws `ConvexError("Pro subscription required")` if false. Called from: autonomous session start, memory extraction, advanced search, scheduled job execution, `buildToolRegistry(isPro: false)` path.

### PaywallView

Single-screen sheet (`Views/Shared/PaywallView.swift`). Presented when a free user taps a Pro-gated feature. Calls `store.retryLoadProductsIfNeeded()` on `.onAppear` to handle cases where Phase 1 product load failed. Auto-dismisses 0.8s after a successful purchase.

Feature list (8 items with SF Symbol icons): Personas, Autonomous Discussions, Memory, Ideascapes, Advanced Search, AI Tools, Provider Integrations, Knowledge Base, Document Uploads, Scheduled Jobs.

### Account Deletion — 4-Step Sequence

Implemented in `SettingsViewModel+Account`:

1. `notifications.removeToken()` — while Convex session is still valid
2. `account/actions:deleteAccount` Convex action — cascades through all user tables
3. `authService.deleteAccount()` — Clerk user deletion + Keychain wipe
4. Reset local credit/notification state in `SharedAppDataStore` and `CreditBalanceCheck`

Required by Apple guideline 5.1.1(v). GDPR right-to-erasure compliant.

### Local Credit Notifications (M14)

Architecture: `CreditBalanceCheck` (pure struct, threshold logic) + M14 additions to `NotificationService` (scheduling) + `SettingsNotificationsSection` (user toggle).

Pipeline: `SharedAppDataStore.updateCreditBalance(_:)` → `evaluateCreditThresholds()` → `CreditBalanceCheck.crossedThreshold(balance:)` → `notifications.scheduleCreditAlert(threshold:)` → `CreditBalanceCheck.markNotified(threshold:)`.

Thresholds: `[1.00, 0.50, 0.10]` (£). Notified once per threshold per balance dip (UserDefaults-persisted). Auto-clears when balance rises above. Permission requested on first crossing (not during onboarding).

---

## Post-M14 Weekend Sprint (2026-03-07 → 2026-03-09)

Five PRs merged covering hardening, overhauls, and UX polish across the stack.

### Multi-Step Scheduled Job Pipelines (PR #31)

Scheduled jobs evolved from single-prompt execution to multi-step pipelines:

- **`steps` array** on `scheduledJobs` table — each step has its own prompt, persona, model, search settings, and reasoning config (`ScheduledJobStepConfig`)
- **`getScheduledJobSteps()`** backward-compat shim — normalizes legacy single-step jobs (fields on root document) into the new `steps[]` format so existing jobs continue working
- **Execution tracking fields** (`activeExecutionId`, `activeExecutionChatId`, `activeExecutionStartedAt`, `activeStepIndex`, `activeStepCount`, `activeUserMessageId`, `activeAssistantMessageId`, `activeGenerationJobId`) enable real-time progress reporting
- **Backend refactor** — monolithic `actions.ts` split into 5 focused files: `actions_execution.ts` (step runner), `actions_execution_policy.ts` (retry/timeout policy), `actions_handlers.ts` (entry points), `actions_lifecycle.ts` (start/complete/fail lifecycle), `actions_types.ts` (shared types), plus `shared.ts` for constants
- **iOS multi-step editor** — `ScheduledJobDraftStep.swift` model, `ScheduledJobEditorView+Persistence.swift` and `ScheduledJobEditorView+Sections.swift` extensions
- 4 new backend test files: `scheduled_jobs_execution_handler.test.ts`, `scheduled_jobs_lifecycle_regressions.test.ts`, `scheduled_jobs_update_timezone.test.ts`, `scheduled_jobs_actions_execution_policy.test.ts`

### Memory Personalization Overhaul (PR #29)

Memory system expanded from flat extraction to a rich personalization layer:

- **10 memory categories** (up from the original set), defined in `convex/memory/shared.ts` as single source of truth
- **Retrieval modes**: `"auto"` (system decides), `"always"` (always injected), `"keyword"` (keyword-match only)
- **Scope types**: `"global"` (all chats/personas) and `"persona"` (only when specific personas are active, via `personaIds` field)
- **Source types**: `"extraction"` (auto-extracted from chat), `"manual"` (user-created), `"document_import"` (imported from files via `DocumentImportTextExtractor`)
- **Tags**: User-defined tags for organization and retrieval filtering
- **Backend split**: `memory/operations.ts` expanded into `operations_args.ts`, `operations_import_handlers.ts`, `operations_public_handlers.ts`, `operations_internal_handlers.ts`, `embedding_helpers.ts`
- **iOS**: `MemoryEditorComponents.swift` (rich editor UI), `DocumentImportTextExtractor.swift` (text extraction from imported documents)

### Tool Capability Gating (PR #30)

Model picker and tool execution now enforce tool capability requirements:

- **`convex/lib/tool_capability.ts`** — `assertToolCapableModelIds()` validates that selected models support tool calling; `assertParticipantsSupportIntegrations()` checks that participants with enabled integrations use tool-capable models. Returns `TOOL_CAPABLE_MODEL_REQUIRED` error code for actionable client-side recovery.
- **iOS model catalog query** — `ModelCatalogQuery.swift` and `ModelToolRequirement.swift` provide client-side model capability filtering
- **Picker UI refactor** — `UnifiedModelPickerView` and `UnifiedParticipantPickerView` split into focused files (`+Controls`, `+SelectedSections`, `+SelectionRows`) with new helper views: `ModelCapabilityGlossaryView`, `ModelCompatibilitySummaryView`, `PickerCapabilityHelpSheet`, `PickerRecoveryActionsView`
- **Settings providers section** — `SettingsProvidersSection.swift` extracted from monolithic settings
- 4 new test files: `ModelCatalogQueryTests.swift`, `ModelToolRequirementTests.swift` (iOS), `tool_capability_gating.test.ts`, `search_context_store_usage.test.ts` (Convex)

### Ideascape Hardening (PR #28)

Ideascape canvas gained context resolution, geometry utilities, and user onboarding:

- **`IdeascapeContextResolver.swift`** — resolves which messages are contextually relevant for a selected node in the ideascape canvas
- **`IdeascapeCanvasGeometry.swift`** — geometry calculations for canvas layout, viewport fitting, and node positioning
- **`IdeascapeNodePositionSync.swift`** — debounced sync of node position changes to Convex backend
- **`ChatViewModel+IdeascapeContext.swift`** — ideascape-specific context building extension
- **Context summary views**: `IdeascapeContextBreakdownView.swift` (detailed context tree), `IdeascapeContextSummaryView.swift` (compact summary badge)
- **`IdeascapeHelpDeckView.swift`** — onboarding help deck explaining ideascape interactions
- **Full localization pass** — all ideascape strings and notification copy localized
- 3 new iOS test files: `IdeascapeCanvasGeometryTests.swift`, `IdeascapeContextResolverTests.swift`, `IdeascapeNodePositionSyncTests.swift`

### Chat UX Polish (Standalone Commits)

- **Inline message action bar** (`MessageActionBar.swift`, `3f610b2`) — contextual actions on chat bubbles (copy, retry, branch, etc.)
- **Chat bubble timestamps + day separators** (`ChatTimestampFormatter.swift`, `ChatView+Timestamps.swift`, `c64fcc7`) — relative timestamps on bubbles with day separator headers
- **UITextView-backed text selection** (`SelectableText.swift`, `58064fa`/`597d67a`/`884af6e`) — native text selection via UITextView instead of SwiftUI's limited Text selection
- **Paste image from clipboard** (`11dedcb`) — paste images directly into the message composer
- **Duplicate chat feature** (`3f610b2`) — duplicate an existing chat conversation
- **Hardened Notion tool runs + compaction loop fix** (`9085e27`) — reliability improvements for Notion integration and context compaction edge case
- Test: `ChatTimestampFormatterTests.swift`

### Backend Test Coverage

138 total backend test files in `convex/tests/` (up from ~20 pre-sprint).

---

*Last updated: 2026-03-15 — Added favorites/ module and reorderPinnedChats to chat/manage. Updated Convex function modules table.*


## M20 Audio Messages Architecture

### Audio Pipeline Overview

Audio message support spans three layers: Convex backend (TTS generation, storage), iOS client (recording, transcription, playback), and Android client (recording, transcription, playback).

### Backend Audio Pipeline

```
User taps "generate audio" or auto-audio triggers
    ↓
requestAudioGeneration mutation
    ↓
Sets audioGenerating: true on message
    ↓
Schedules generateAudioForMessage internal action
    ↓
Action: POST to OpenRouter with gpt-audio-mini model
    ↓
Receives PCM16 audio response
    ↓
pcmToWav() encoder → WAV blob
    ↓
ctx.storage.store(wavBlob) → storageId
    ↓
Patches message: audioStorageId, audioVoice, audioGeneratedAt, audioGenerating: false
```

### Auto-Audio Trigger

Wired into `finalizeGenerationHandler` (the same hook used for push notifications):
- Checks `userPreferences.autoAudioResponse` or `chat.autoAudioResponseOverride`
- Only fires for non-scheduled, non-autonomous, assistant messages
- Respects the user's `preferredVoice` selection

### Voice Catalog

6 voices from OpenAI's `gpt-audio-mini`: `alloy`, `echo`, `fable`, `nova`, `onyx`, `shimmer`. Stored as string constants in `chat/audio_shared.ts`.

### iOS Audio Stack

- **Recording**: `AVAudioRecorder` with linear PCM format
- **Transcription**: `SFSpeechRecognizer` for real-time speech-to-text during recording
- **Playback**: `AVPlayer` with `AVAudioSession` configuration for playback category
- **UI**: Waveform visualization in message bubbles, inline playback controls
- **Integration**: `ChatViewModel+Attachments.swift` handles recording lifecycle, `ChatViewModel+Audio.swift` handles playback and generation requests

### Android Audio Stack

- **Recording**: `MediaRecorder` with AAC encoding
- **Transcription**: Android `SpeechRecognizer` API
- **Playback**: `MediaPlayer` with `DisposableEffect` Compose lifecycle management
- **UI**: Compose-native waveform + playback controls in chat detail

### Audio Message Schema Fields

Messages: `audioStorageId`, `audioTranscript`, `audioDurationMs`, `audioVoice`, `audioGeneratedAt`, `audioLastPlayedAt`, `audioGenerating`.
Preferences: `autoAudioResponse`, `preferredVoice`.
Chats: `autoAudioResponseOverride`.

---

## M21 Scalability Audit Architecture Changes

The M21 comprehensive bug audit included a Convex scalability session that made structural improvements:

### Batch Delete Pattern

All bulk deletion operations (chat cascade, account deletion, memory purge) now use a **batched delete with safety cap** pattern:
- Maximum 200 documents per `ctx.runMutation` call
- Cursor-based iteration for larger datasets
- Prevents Convex action time budget exhaustion on accounts with large data volumes

### Rate Limiting

- New `rate_limit` table for backend abuse prevention
- Sliding-window rate checks on expensive operations (generation, audio TTS, search)
- Indexed by `userId + action` for efficient lookup

### Indexed Cleanup Queries

Cleanup crons (stale jobs, old job runs, expired sessions) now use indexed queries instead of full table scans:
- `generationJobs` gained `by_status` index
- `messages` gained `by_audio_storage` index for orphaned audio cleanup
- `rate_limit` uses `by_user_action` index

### Split Repair Mutations

Large repair/migration operations (e.g., `repairInvalidMessagePersonas`) are split into chunked mutations that process a bounded number of documents per call, then reschedule themselves if more work remains. This avoids Convex's 10-second mutation time limit.

---

## M16 Verification Policy

For the current M16 stage, the project intentionally avoids automated GitHub workflow creation. Build/test verification is run locally (Android, iOS, Convex) using documented commands and milestone checklists.

---

## M26 Lyria Music Generation Architecture

### Lyria Audio Pipeline

Google Lyria models (`google/lyria-3-clip-preview` for 30s clips, `google/lyria-3-pro-preview` for full songs) produce MP3 audio from text prompts. The audio pipeline is entirely **server-side** — clients never handle raw audio bytes.

```
User sends prompt to Lyria model
  → Convex action streams from OpenRouter SSE
  → SSE parser detects delta.audio.data (single base64 MP3 chunk)
  → Stream completes → generateForParticipant() decodes base64
    → parseMp3DurationMs() walks MPEG frames for exact duration
    → ctx.storage.store(Blob) → audioStorageId
    → finalizeGeneration patches message: audioStorageId, audioDurationMs, audioGeneratedAt
    → Inserts generatedFiles record (toolName: "lyria_music_generation", mimeType: "audio/mpeg")
  → Clients reactively receive audioStorageId via Convex subscription
    → Query getMessageAudioUrl for signed storage URL → play audio
```

### Key Design Decisions

- **Server-side storage** — audio is decoded and stored within the same Convex action that runs the SSE stream. No client-to-server upload needed.
- **MP3 format** — Lyria outputs MP3 directly (not PCM). No conversion step. The `parseMp3DurationMs()` function walks MPEG frame headers to extract exact duration.
- **Auto-audio suppression** — `finalizeGenerationHandler` skips `maybeScheduleAutoAudio` when `audioStorageId` is already present, preventing TTS from reading out music lyrics.
- **isFree detection** — Lyria models report $0 token prices but charge per-request. `isFree` now uses `:free` slug suffix across all platforms instead of zero-price check.
- **Knowledge Base** — generated audio files are registered in `generatedFiles` and downloadable via the `/download` HTTP endpoint (which now includes `mp3: "audio/mpeg"` MIME type).

### Client Audio Players

All three platforms have inline audio player components for Lyria messages:

| Platform | Component | Features |
|----------|-----------|----------|
| iOS | `AudioPlayerView.swift` | AVPlayer, play/pause, seekable progress bar, M:SS time, 6-speed (0.5x–2x), download via share sheet |
| Android | `LyriaAudioPlayer.kt` | MediaPlayer, play/pause, tap/drag-to-seek, M:SS time, 6-speed, download via Intent.ACTION_VIEW |
| Web | `AudioMessageBubble.tsx` (enhanced) | HTML5 Audio, existing waveform/progress/speed UI + download button + Lyria header |

Detection: each platform checks `audioStorageId != nil/null` AND model ID matches a Lyria slug (`isLyriaMusic` extension property).

---

## Post-M26 Backend Optimizations

### Anthropic Prompt Caching

Anthropic models require explicit opt-in for prompt caching. `openrouter_request.ts` now adds `cache_control: { type: "ephemeral" }` at the top level for all `anthropic/` model requests. Other providers (OpenAI, DeepSeek, Gemini 2.5, Grok, Groq) cache automatically — no special handling needed.

### Model Sync Bandwidth Reduction

The model catalog sync cron was reduced from hourly to every 4 hours. Combined with hash-based skip logic in `sync.ts` (compares a hash of the fetched data against the previous sync), most invocations now do zero mutations. This reduces DB bandwidth by ~75% (~250 MB/month savings). A $50 price cap filter also excludes extremely expensive models from the catalog.

---

*Last updated: 2026-04-07 — M26 Lyria music generation, Anthropic prompt caching, model sync optimization, isFree fix. M20/M21 audio pipeline and scalability audit.*
