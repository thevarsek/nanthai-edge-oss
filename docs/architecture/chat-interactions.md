# Search, chat interaction and notifications


### Search Tier Architecture

Internet search expanded from 2 tiers (Web / Research Paper) to 3:

| Tier | Search Mode | Backend Path | Notes |
|------|------------|--------------|-------|
| Basic | `"normal"` | Path B — OpenRouter `openrouter:web_search` server tool (plugin fallback for non-tool models) | Native search for OpenAI/Anthropic/xAI; Exa for others (~$0.02/req) |
| Web Search | `"web"` | Path C — Perplexity/Sonar | Complexity 1-3 (Quick/Thorough/Comprehensive) |
| Research Paper | `"paper"` | Path D — Multi-phase research pipeline | Complexity 1-3, full tool support |

**M37 research hardening:** Research Paper remains the same client-visible mode and status contract (`planning`, `searching`, `analyzing`, `deepening`, `synthesizing`, `writing`, terminal states). Internally, Convex now asks planning for an inferred research question, scope, source strategy, and structured query rationales; synthesis produces source notes, a literature matrix, claim bank, contradictions, limitations, and research gaps; an internal `paper_architecture` phase runs while the session remains `synthesizing` and stores the title, section outline, evidence map, thesis, claim-evidence-reasoning chains, and drafting notes. Final paper generation consumes those artifacts and preserves the existing `runGeneration` handoff for tools, skills, memory, continuations, and cancellation behavior.

**M38/M38.5 context assembly:** Model-facing context is now assembled from runtime graph records rather than blindly replaying every transcript/tool payload. Tool rounds dual-write durable raw artifacts and compact tool memories, then `assembleRequestContextForGeneration` selects model-visible context by branch lineage, participant ownership, privacy policy, freshness, provenance status, and recovery needs. The visible transcript remains the client contract; context assembly is a backend/runtime concern used by normal generation, autonomous discussion mode, subagent child runs, and parent-resume metadata. Oversized raw arguments and results use separate storage refs, and selected exact/recovery artifacts are rehydrated only after policy selection.

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

### AppState Extensions

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
