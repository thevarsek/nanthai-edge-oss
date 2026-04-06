# Service Layer

> Post-M8/M9.5 service architecture. Most services were removed — business logic now lives in Convex backend functions. The iOS app has a thin service layer for auth, Convex communication, shared data subscriptions, and preference batching.

## Overview

Before M8, the app had 8+ protocol-based services (OpenRouterService, ChatService, PersonaService, etc.) handling all business logic on-device. After M8, all LLM orchestration, data persistence, and domain logic moved to Convex backend functions. M9.5 further streamlined the iOS layer by deduplicating subscriptions and adding write batching.

| Service | Type | Purpose |
|---------|------|---------|
| `ConvexService` | `@MainActor class` | ConvexMobile client wrapper — subscriptions, mutations, actions, one-shot queries |
| `SharedAppDataStore` | `@MainActor @Observable class` | Single global subscriptions for preferences, personas, model summaries, model settings, credit balance, and account capabilities. Triggers credit threshold evaluation after each balance update (M14). |
| `PreferenceWriteBuffer` | `actor` | Debounces individual preference field changes into batched mutations (500ms) |
| `StoreService` | `@MainActor @Observable class` | StoreKit 2 integration — two-phase lifecycle, purchase, restore, entitlement sync, revocation handling (M14) |
| `NotificationService` | `@MainActor class` | APNs push notification handling — token registration/removal, foreground display, tap-to-navigate deep linking (M13.5). Scheduled-job pushes are emitted only for fully autonomous scheduled executions, not for later user-driven follow-ups inside those chats. M14 added: `scheduleCreditAlert(threshold:)`, `requestAuthorizationIfNeeded()`, `creditAlertsEnabled` toggle. |
| `CreditBalanceCheck` | `struct` | Pure value type — threshold crossing detection for local credit notifications, UserDefaults persistence of notified thresholds, auto-reset on balance rise (M14) |
| `ClerkAuthService` | `class` | Clerk identity auth (sign-in/out, session management) |
| `AuthService` | `class` | OpenRouter PKCE key exchange (legacy, retained for API key provisioning) |
| `ClerkConvexAuthProvider` | `struct` | Bridges Clerk JWT tokens to ConvexMobile auth |
| `KeychainService` | `class` | Keychain read/write for OpenRouter API key |
| `OpenRouterKeyExchanger` | `struct` | PKCE code-for-key exchange with OpenRouter |

## ConvexService (Core)

The central data gateway. Wraps ConvexMobile's `ConvexClientWithAuth` to provide typed Swift APIs.

```swift
@MainActor
final class ConvexService {
    private let client: ConvexClientWithAuth<ClerkConvexAuthProvider>

    init(deploymentURL: String? = nil) {
        let url = deploymentURL ?? AppConstants.convexDeploymentURL
        self.client = ConvexClientWithAuth(
            deploymentUrl: url,
            authProvider: ClerkConvexAuthProvider()
        )
    }

    // Subscribe to a Convex query (returns Combine publisher, wrapped by ViewModels)
    func subscribe<T: Decodable>(
        to function: String,
        with args: [String: ConvexEncodable?] = [:],
        yielding type: T.Type
    ) -> AnyPublisher<T, ClientError>

    // Call a Convex mutation
    func mutation(
        _ function: String,
        with args: [String: ConvexEncodable?] = [:]
    ) async throws

    // Call a Convex action
    func action(
        _ function: String,
        with args: [String: ConvexEncodable?] = [:]
    ) async throws

    // One-shot query — subscribe, take first value, cancel (M9.5)
    func query<T: Decodable>(
        _ function: String,
        with args: [String: ConvexEncodable?] = [:],
        yielding type: T.Type
    ) async throws -> T

    // One-shot optional query (M9.5)
    func queryOptional<T: Decodable>(
        _ function: String,
        with args: [String: ConvexEncodable?] = [:],
        yielding type: T.Type
    ) async throws -> T?
}
```

### Subscription Pattern in ViewModels

ViewModels subscribe to Convex queries using Combine publishers (ConvexMobile's native API), stored in non-`@Observable` helper classes to avoid `nonisolated(unsafe)` warnings:

```swift
@MainActor @Observable
final class ChatListViewModel {
    var chats: [ConvexChat] = []
    private let _task = TaskHandle()

    func startSubscription(convex: ConvexService) {
        _task.value = Task {
            for await chats in convex.subscribe(
                to: ConvexConstants.Queries.listChats,
                yielding: [ConvexChat].self
            ).values {
                self.chats = chats
            }
        }
    }

    deinit { _task.cancel() }
}
```

### TaskHandle Pattern

To avoid `nonisolated(unsafe)` warnings on `@Observable` classes (where the macro expansion conflicts with the annotation), Task handles are stored in a separate non-`@Observable` wrapper:

```swift
final class TaskHandle: @unchecked Sendable {
    nonisolated(unsafe) var value: Task<Void, Never>?
    nonisolated func cancel() { value?.cancel() }
}
```

For ViewModels with multiple subscriptions, `SubscriptionTasks` provides named task slots.

## SharedAppDataStore (M9.5)

Centralized subscription store that holds one global subscription for each shared data type. Before M9.5, `getPreferences` was subscribed in 6 places, `listPersonas` in 5 places, `listModels` in 3+ places. Now each has exactly one subscription.

```swift
@MainActor @Observable
final class SharedAppDataStore {
    // Subscribed data
    var preferences: ConvexUserPreferences?
    var personas: [ConvexPersona] = []
    var modelSummaries: [ConvexModelSummary] = []
    var modelSettings: [ConvexModelSettings] = []
    var creditBalance: Double?
    var accountCapabilities: ConvexAccountCapabilities?

    // Lifecycle
    func start()    // Called once after Convex auth completes
    func stop()     // Called on sign-out

    // Convenience lookups
    func modelSummary(for openRouterId: String) -> ConvexModelSummary?
    func modelSettingsFor(_ openRouterId: String) -> ConvexModelSettings?
    func persona(for id: String) -> ConvexPersona?
    func hasCapability(_ capability: String) -> Bool

    // Credit balance
    func updateCreditBalance(_ balance: Double)
    func refreshCreditBalance(apiKey: String) async
}
```

All subscription handlers use **shallow equality guards** — they compare incoming data against current values and skip the assignment (and thus SwiftUI re-render) when nothing changed.

Post-M19, the shared store also subscribes to `capabilities/queries:getAccountCapabilitiesPublic`. This keeps Max/runtime gating reactive without forcing every view to maintain its own capability subscription. The runtime UI itself is still mostly implicit — the main immediate consumers are chat/tool presentation and any future internal Max testing surfaces.

The `listModelSummaries` query returns a lightweight projection (`_id`, `modelId`, `name`, `provider`, `supportsImages`, `supportsTools`, `contextLength`, `hasReasoning`, `inputPricePer1M`, `outputPricePer1M`) instead of the full `ConvexCachedModel` with 20+ fields. `ChatViewModel` still keeps its own `listModels` subscription for the full model data it needs.

## PreferenceWriteBuffer (M9.5)

Actor that batches individual preference field changes into a single `upsertPreferences` mutation after 500ms of inactivity.

```swift
actor PreferenceWriteBuffer {
    func set(key: String, value: ConvexEncodable?)    // Buffer a single key
    func setMultiple(_ pairs: [String: ConvexEncodable?])  // Buffer multiple keys
    func flushNow()                                    // Immediate flush (cleanup)
}
```

Rewired consumers: `SettingsViewModel+Preferences` (5 save methods), `MemorySettingsView`, `UnifiedParticipantPickerView+Content`.

## Convex Backend StreamWriter (M9.5)

Server-side utility (`convex/chat/stream_writer.ts`) used by all 5 stream producers. Encapsulates content/reasoning accumulation, throttled patching, and the reasoning→content boundary force-flush.

```typescript
class StreamWriter {
    appendContent(delta: string): void
    appendReasoning(delta: string): void
    patchContentIfNeeded(force?: boolean): Promise<void>
    patchReasoningIfNeeded(force?: boolean): Promise<void>
    handleContentDeltaBoundary(deltaLength: number): Promise<void>
    flush(): Promise<void>  // Force-flush both channels
    get totalContent(): string
    get totalReasoning(): string
    get hasSeenContentDelta(): boolean
}
```

Configurable hooks: `beforePatch` (cancellation checks), `transformContent` (e.g., `clampMessageContent`), `shouldPersistReasoning`.

Current streaming persistence contract:
- `StreamWriter` writes active content/reasoning/tool-call patches into `streamingMessages` rather than directly mutating the heavy `messages` rows.
- Clients subscribe to `chat/queries:listMessages` for stable history and `chat/queries:listStreamingMessages` for live overlays, then merge by `messageId`.
- `finalizeGenerationHandler` copies the last streamed state back into `messages` and deletes the `streamingMessages` row.

Post-M14 tuning:
- Content still patches at 40 chars first, then every 300ms or 120 chars.
- Reasoning now patches earlier (24 chars first, then every 200ms or 80 chars) and also force-flushes on sentence/paragraph boundaries so the collapsed reasoning view stalls less often mid-thought.
- OpenRouter `reasoning_details` blocks are joined with blank lines instead of raw concatenation, which preserves markdown section spacing in the iOS disclosure view.

## Convex Backend Tool Execution (M10)

Server-side tool infrastructure lives in `convex/tools/`. Tools execute within Convex actions — they have full access to `ctx.storage` for file operations and `ctx.runMutation`/`ctx.runQuery` for database access.

The tool execution context is separate from the iOS service layer — tools are invoked by the `runToolCallLoop()` during OpenRouter streaming, not by any iOS service. Generated files are stored in Convex file storage and surfaced to the user via download URLs in the chat message.

Post-M19 the backend registry is profile-driven rather than fully always-on. The base registry is intentionally small (`fetch_image`, `search_chats`, scheduled jobs, persona tools, and skill tools including `load_skill`). Document tools, connected-app tools, runtime tools, and subagents are added later through progressive skill/profile expansion. The `search_chats` tool uses the full-text search index on `messages` with `userId` in `filterFields`, while `spawn_subagents` now sits behind the `subagents` profile instead of the base registry.

Post-M14 added **tool capability gating** (`convex/lib/tool_capability.ts`): `assertToolCapableModelIds()` validates that selected models support tool calling before building the tool registry. `assertParticipantsSupportIntegrations()` checks that participants with enabled integrations use tool-capable models. Returns `TOOL_CAPABLE_MODEL_REQUIRED` error code for actionable client-side recovery. iOS counterparts: `ModelToolRequirement.swift` and `ModelCatalogQuery.swift`.

See `docs/architecture.md` (M10 and M13 sections) for the full tool execution flow.

## Generated Chart UI Seam (M19)

Generated charts are not streamed through a new iOS service. The chat UI follows the same pattern as generated files:

- assistant messages carry `generatedChartIds`
- the message bubble mounts a lightweight per-message subscription to `chat/queries:getGeneratedChartsByMessage`
- `GeneratedChartCardsContainer` renders chart cards reactively as the message updates

This keeps the service layer thin: `ConvexService` remains the generic subscription/query/mutation bridge, while chart-specific behavior lives at the DTO/view layer.

## Audio Message Services (M20)

Audio messages follow the same thin-service pattern. No dedicated AudioService class exists — audio responsibilities are distributed across existing layers:

### iOS Audio Integration

- **Recording**: `ChatViewModel+Attachments.swift` manages `AVAudioRecorder` lifecycle (start/stop/cancel), `AVAudioSession` configuration, and recording file management
- **Transcription**: `SFSpeechRecognizer` runs in real-time during recording, producing `audioTranscript` alongside the audio data
- **Playback**: `ChatViewModel` (or message-level) manages `AVPlayer` instances for audio message playback, with `AVAudioSession` category switching
- **TTS Generation**: `ChatViewModel` calls `chat/mutations:requestAudioGeneration` to trigger backend TTS; subscribes to the message's `audioStorageId` and `audioGenerating` fields for reactive UI updates
- **Auto-Audio**: When `autoAudioResponse` is enabled (user preference or per-chat override), the backend automatically generates audio after assistant message completion; iOS auto-plays when the audio URL becomes available
- **Voice Preference**: `SettingsViewModel` manages `preferredVoice` via `PreferenceWriteBuffer`, and `autoAudioResponse` toggle

### Android Audio Integration

- **Recording**: `MediaRecorder` with Compose `DisposableEffect` lifecycle management
- **Transcription**: Android `SpeechRecognizer` API for real-time speech-to-text
- **Playback**: `MediaPlayer` with Compose lifecycle, waveform visualization
- **TTS/Auto-Audio**: Same backend mutations/queries as iOS

### Backend Audio Pipeline

- `chat/audio_actions.ts` — `generateAudioForMessage` internal action: calls OpenRouter with `gpt-audio-mini` model, receives PCM16 response, encodes to WAV via `pcmToWav()`, stores in Convex `_storage`, patches message fields
- `chat/audio_actions.ts` — `previewVoice` internal action: generates short TTS samples for voice selection UI
- `chat/audio_shared.ts` — Audio constants, PCM→WAV encoder, 6-voice catalog (`alloy`, `echo`, `fable`, `nova`, `onyx`, `shimmer`)
- `chat/audio_trigger.ts` — Auto-audio trigger wired into `finalizeGenerationHandler`
- `chat/audio_public_handlers.ts` — Public mutation (`requestAudioGeneration`) and query (`getMessageAudioUrl`) handlers

## Context Compaction Engine (M13)

Server-side compaction system in `convex/chat/compaction.ts` that summarizes earlier messages when tool-call loops approach the model's context window:

- Triggered within `runToolCallLoop()` (in `convex/tools/execute_loop.ts`) via `shouldExitLoop` callback
- Uses `google/gemini-3.1-flash-lite-preview` (via OpenRouter) as the compaction model
- Mid-loop callback checks between tool rounds — only exits when `finishReason !== "tool_calls"` to avoid dropping pending tool calls
- Constants defined in `convex/lib/compaction_constants.ts`
- If the compaction model is unavailable, compaction silently skips

## Favorites & Pinned Conversations (ChatListViewModel)

### Favorites Subscription

`ChatListViewModel` subscribes to `favorites/queries:listFavorites` alongside the existing `chat/queries:listChats` subscription. Favorites are stored as `[ConvexFavorite]` and rendered in a horizontal `FavoritesStripView` at the top of the chat list. Tapping a favorite calls `createChatFromFavorite(_:)` which creates a new chat via `chat/mutations:createChat` and adds participants via `participants/mutations:addParticipant`.

### Favorites CRUD Surface

| Function | Type | Purpose |
|----------|------|---------|
| `favorites/queries:listFavorites` | Query | Reactive list of user's favorites, sorted by `sortOrder` |
| `favorites/mutations:createFavorite` | Mutation | Create a favorite (name + model IDs, max 20 per user, max 3 models) |
| `favorites/mutations:updateFavorite` | Mutation | Update name or models of an existing favorite |
| `favorites/mutations:deleteFavorite` | Mutation | Delete a favorite |
| `favorites/mutations:reorderFavorites` | Mutation | Reorder favorites by passing `favoriteIds` array in desired order |

### Favorites Editor

`ManageFavoritesView` (Settings → Chat Defaults → Quick Launch) shows the full favorites list with drag-to-reorder and swipe-to-delete. `FavoriteEditorView` reuses `UnifiedParticipantPickerView` in `.favorite` mode for model/persona selection, with a custom group name field shown when 2-3 participants are selected.

### Pinned Chat Management

Pin/unpin is available via long-press context menu and leading swipe action on chat rows. Pinned chats appear in a dedicated "Pinned" section at the top of the chat list, sorted by `pinnedAt` DESC. Methods on `ChatListViewModel`:

- `togglePin(_:)` — toggles `isPinned` and sets/clears `pinnedAt` via `chat/manage:updateChat`
- `reorderPinnedChats(_:)` — reorders pinned chats via `chat/manage:reorderPinnedChats`

**Key behavior**: Pin/unpin-only updates do NOT bump `updatedAt` (backend `isPinOnlyUpdate` logic), ensuring unpinned chats return to their natural chronological position.

### Branch Navigation

Branch pills no longer choose a descendant leaf client-side. iOS, Android, and web call `chat/manage:switchBranchAtFork` with the current active sibling and target sibling for the selected divergence point. Convex resolves the new `activeBranchLeafId`, preserving downstream fork choices where possible and falling back deterministically when the target subtree diverges.

## Scheduled Jobs ViewModel (M13)

`ScheduledJobsViewModel` (`@MainActor @Observable`) manages the scheduled jobs UI:

- Subscribes to `listScheduledJobs` query for the user's jobs
- CRUD operations via Convex mutations (`createScheduledJob`, `updateScheduledJob`, `deleteScheduledJob`)
- Cron expression validation and human-readable schedule display
- Job run history via `listJobRuns` subscription
- Post-M14: multi-step job editing via `ScheduledJobDraftStep` model, `ScheduledJobEditorView+Persistence` and `ScheduledJobEditorView+Sections` extensions

## API Key Server-Side Sync (M13)

OpenRouter API key is synced to the `userSecrets` Convex table for headless scheduled job execution:

- **During PKCE exchange**: After the key is stored in Keychain, `upsertApiKey` mutation is called to sync to server
- **On app launch**: `RootView` bootstrap calls `upsertApiKey` mutation to ensure server copy is current
- Device Keychain remains canonical; server copy is a sync target
- Convex access controls restrict reads to the owning user

## External Integration OAuth Services (M10 Phases B/C/D)

### Google Connection (`GoogleConnectionViewModel`)

`@MainActor @Observable` ViewModel that manages the Google Workspace OAuth lifecycle:
- `connect()` — Opens `ASWebAuthenticationSession` with Google consent screen, handles PKCE callback, calls `exchangeGoogleCode` Convex action
- `disconnect()` — Calls `disconnectGoogle` Convex action to revoke tokens and delete `oauthConnections` row
- Connection status tracked via `SharedAppDataStore.hasGoogleConnection` (subscribed globally)

### Microsoft Connection (`MicrosoftConnectionViewModel`)

Same pattern as Google, with key differences:
- Uses Microsoft's `/common/oauth2/v2.0/authorize` endpoint for multi-tenant + personal accounts
- **No `client_secret` sent** in token exchange (public/native client — AADSTS90023 error if included)
- Needs `offline_access` scope for refresh tokens
- `Mail.Send` is a separate permission (unlike Google where `gmail.modify` covers send)

### Notion Connection (`NotionConnectionViewModel`)

Same general pattern as Google/Microsoft, with key differences:
- **No PKCE** — Notion doesn't use PKCE. State parameter is generated for CSRF protection only.
- **HTTPS relay redirect** — Notion requires `https://` redirect URIs. OAuth redirects to `https://nanthai.tech/oauth/notion/callback` which relays to the app's custom URL scheme (`tech.nanthai.NanthAi-Edge://oauth/notion/callback`).
- **HTTP Basic Auth** for token exchange — `Authorization: Basic base64(client_id:client_secret)`, JSON request body (not form-encoded).
- **No scopes** — access is page-level; user chooses which pages to share during OAuth consent.
- **Conservative token expiry** — Notion doesn't return `expires_in`; we set a 1-hour expiry to trigger proactive refresh.
- **User info from token response** — `owner.user.name` and `owner.user.person.email` embedded in the token exchange response, no separate userinfo endpoint needed.

### Tool Auth Helpers (`convex/tools/google/auth.ts`, `convex/tools/microsoft/auth.ts`, `convex/tools/notion/auth.ts`)

Server-side auth helpers that:
1. Look up the user's `oauthConnections` row for the given provider
2. Check token expiry; if expired, refresh transparently via provider's token endpoint
3. Return a valid access token for API calls
4. All external API calls use raw `fetch()` — no Node.js SDKs

**Notion auth difference:** Uses HTTP Basic Auth (`Authorization: Basic base64(client_id:client_secret)`) for token refresh instead of form-encoded client credentials. Token endpoint accepts JSON body (`Content-Type: application/json`). All Notion API calls require `Notion-Version: 2022-06-28` header.

## StoreService (M14)

StoreKit 2 integration for the single Pro non-consumable unlock. Uses a deliberate **two-phase lifecycle** to allow product loading before Convex auth is available.

```swift
@MainActor @Observable
final class StoreService {
    private(set) var proProduct: Product?
    private(set) var isPurchased: Bool = false
    private(set) var isPurchasing: Bool = false
    private(set) var lastError: String?
    private var pendingSyncTransaction: Transaction?
    private var updateListenerTask: Task<Void, Never>?

    // Phase 1 — before Convex auth
    func startLocal() async   // Load products, check currentEntitlements, start updates listener
    // Phase 2 — after Convex auth
    func connectConvex(_ convex: ConvexService) async  // Flush pendingSyncTransaction

    func purchase() async throws -> Bool
    func restore() async
    func retryLoadProductsIfNeeded() async  // Called on PaywallView .onAppear
    func stop()
}
```

**Phase 1 — `startLocal()`**: Loads the IAP non-consumable product (e.g. `<your-iap-product-id>`), checks `Transaction.currentEntitlements`, starts `Transaction.updates` listener. Called from the onboarding carousel's `.task` so product data and entitlement state are available before sign-in.

**Phase 2 — `connectConvex(_:)`**: Wires in `ConvexService`. Any entitlement found before Convex was ready is held in `pendingSyncTransaction` and flushed immediately on connection.

**Revocation**: `Transaction.updates` detects `transaction.revocationDate != nil`. Sets `isPurchased = false`, calls `revokeEntitlement` Convex mutation (which revokes App Store entitlement rows, disables Pro-only preference toggles, and schedules `purgeUserMemories`).

**`AppDependencies.isProUser`**: Computed property — `true` when `sharedStore.hasProEntitlement` reports an active Convex entitlement from `preferences/queries:getProStatus`. StoreKit purchase state is used only to drive purchase/restore flows and sync entitlements into Convex.

## CreditBalanceCheck (M14)

Pure value type (`struct`) in `Services/CreditBalanceCheck.swift`. Responsible for detecting when the OpenRouter credit balance crosses a notification threshold.

```swift
struct CreditBalanceCheck {
    let thresholds: [Double] = [1.00, 0.50, 0.10]

    func crossedThreshold(balance: Double) -> Double?  // Returns highest un-notified threshold crossed
    func markNotified(threshold: Double)               // Persist to UserDefaults
}
```

UserDefaults key: `"creditNotifiedThresholds"` (persists `Set<Double>` of already-fired thresholds). Auto-clears entries when balance rises back above a threshold, enabling re-notification on subsequent drops.

**Credit notification pipeline** (M14):
`SharedAppDataStore.updateCreditBalance(_:)` → `evaluateCreditThresholds()` → `CreditBalanceCheck.crossedThreshold(balance:)` → `notifications.scheduleCreditAlert(threshold:)` → `CreditBalanceCheck.markNotified(threshold:)`

## NotificationService (M13.5)

Handles APNs push notification lifecycle: token registration/removal with Convex, foreground banner display, and tap-to-navigate deep linking. Set as `UNUserNotificationCenter.current().delegate` on init.

```swift
@MainActor
final class NotificationService: NSObject, UNUserNotificationCenterDelegate {
    private let appState: AppState
    private let convex: ConvexService
    private(set) var currentDeviceToken: String?

    // Token management
    func registerToken(_ token: String) async     // Sync to Convex (sandbox/production env)
    func syncTokenIfNeeded() async                 // Re-sync after Convex auth (1s delay)
    func removeToken() async                       // Remove on sign-out (only clears local on success)

    // M14 additions — local credit notifications
    func scheduleCreditAlert(threshold: Double) async   // Schedule immediate local notification
    func requestAuthorizationIfNeeded() async -> Bool   // Request permission on first threshold crossing
    var creditAlertsEnabled: Bool                        // Persisted in UserDefaults (default: true)

    // UNUserNotificationCenterDelegate
    func willPresent(...) -> [.banner, .sound]     // Foreground display
    func didReceive(...)                           // Tap → deep-link via isUIReady flag
}
```

### Token Registration Flow

1. `AppDelegate.didRegisterForRemoteNotificationsWithDeviceToken` converts token → hex string
2. Posts `Notification.Name.didRegisterAPNsToken` with token in `userInfo`
3. `NotificationService` observes notification, caches token in `currentDeviceToken`
4. If `convex.isAuthenticated` → calls `registerToken()` immediately (token rotation)
5. Otherwise → `syncTokenIfNeeded()` called after Convex auth in `RootView` bootstrap

### Deep-Link Routing

Uses `appState.isUIReady` (set `true` after `RootView` auth bootstrap, `false` on sign-out):

- **Warm launch** (`isUIReady == true`): Sets `appState.selectedChatID` directly
- **Cold launch** (`isUIReady == false`): Sets `appState.pendingDeepLinkChatID`, consumed by `applyPendingDeepLink()` after bootstrap

### Sign-Out Cleanup

`SettingsViewModel+Account.signOut()` awaits `notifications.removeToken()` before `authService.signOut()`, ensuring Convex auth is still valid for the removal mutation. `currentDeviceToken` only cleared after successful server removal.

## ClerkConvexAuthProvider

Bridges Clerk session tokens to ConvexMobile authentication:

```swift
struct ClerkConvexAuthProvider: AuthProvider {
    func login(onIdToken: @escaping (String) -> Void) {
        // Fetch Clerk session token with "convex" JWT template
        Task {
            if let token = try? await Clerk.shared.session?
                .getToken(.init(template: "convex")) {
                onIdToken(token)
            }
        }
    }
}
```

## Auth Services

### AuthServiceProtocol
Abstraction for authentication services. Both `ClerkAuthService` and legacy `AuthService` conform. Key contract:
- `isAuthenticated` / `hasAPIKey` — observable state for UI binding
- `signOut()` — clears identity session and API key
- `revokeAPIKey()` — removes only the OpenRouter API key without signing out of Clerk, enabling users to disconnect/reconnect their OpenRouter account from Settings
- `loadAPIKey()` — retrieves the stored OpenRouter key

### ClerkAuthService
Manages Clerk identity lifecycle. Conforms to `AuthServiceProtocol`. The `hasAPIKey` property is backed by a private stored `_hasAPIKey: Bool` property (not a computed Keychain read) so that `@Observable` can detect changes and trigger SwiftUI re-renders. The `saveAPIKey(_:)` and `revokeAPIKey()` methods update this stored flag.

### AuthService (Legacy PKCE)
Retained for OpenRouter API key provisioning via PKCE flow. Uses `ASWebAuthenticationSession` and `PKCEGenerator`.

### KeychainService
Synchronous C-API wrapper for Keychain operations. Stores OpenRouter API key with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.

## Removed Services (M8)

These services were deleted — their logic now lives in Convex backend functions:

| Removed Service | Replaced By |
|-----------------|-------------|
| `OpenRouterService` (actor) | `convex/lib/openrouter.ts` + `convex/chat/actions.ts` |
| `ChatService` + extensions | `convex/chat/mutations.ts` + `convex/chat/actions.ts` |
| `StreamCoordinator` | Server-side streaming in `runGeneration` action |
| `ModelCacheService` | `convex/models/sync.ts` (cron) |
| `PersonaService` | `convex/personas/mutations.ts` + `queries.ts` |
| `MemoryService` | `convex/memory/operations.ts` + `shared.ts` + `operations_args.ts` + `operations_import_handlers.ts` + `operations_public_handlers.ts` + `operations_internal_handlers.ts` + `embedding_helpers.ts` (post-M14 split) |
| `MemoryExtractionService` | `extractMemories` internal action |
| `ContextManager` | `buildRequestMessages()` in `convex/chat/helpers.ts` |
| `SSEParser` | Server parses OpenRouter SSE directly |
| `TokenCounter` | Server-side token estimation |
| `NetworkMonitor` | Convex WebSocket handles reconnection |

## Removed Types (M8)

| Removed Type | Notes |
|--------------|-------|
| `StreamEvent` | SSE events parsed server-side |
| `OpenRouterStreamTypes` | Server handles OpenRouter response format |
| `OpenRouterResponsesEventTypes` | Server handles response events |
| `OpenRouterServiceProtocol` | No more on-device OpenRouter calls |
| `ChatServiceProtocol` | No more on-device chat orchestration |

## Retained Types

| Type | File | Purpose |
|------|------|---------|
| `ChatRequestParameters` | `OpenRouterServiceTypes.swift` | Parameter struct used by ChatViewModel for preference cascade |
| `OpenRouterTypes` | `OpenRouterTypes.swift` | `OpenRouterModel` for model picker display |
| `OpenRouterMetadataTypes` | `OpenRouterMetadataTypes.swift` | Credits response type for Settings |

## Error Handling

Post-M8, errors come from two sources:

1. **ConvexMobile `ClientError`** — subscription/mutation/action failures
2. **Clerk SDK errors** — auth failures

ViewModels catch these and present user-facing error states. The `AppError` enum pattern is retained for structured error display.

---

*Last updated: 2026-03-22 — M20 audio messages: ChatViewModel+Attachments handles recording, transcription (SFSpeechRecognizer), playback (AVPlayer), auto-audio TTS generation, concurrent loading guards. SettingsViewModel manages voice preference and autoAudioResponse via PreferenceWriteBuffer. Android uses Compose-local MediaPlayer/MediaRecorder with DisposableEffect lifecycle. Backend audio pipeline: gpt-audio-mini TTS via OpenRouter, PCM16→WAV encoding, Convex \_storage blobs.*
