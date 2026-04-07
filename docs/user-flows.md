# User Flows

> Complete map of user-facing flows across iOS, Android, and Convex backend.
> Use this document to understand data flow, identify cross-platform parity gaps, and locate key files for each feature.

## 1. Authentication & Onboarding

### 1.1 Clerk Sign-In
User signs in via Clerk OAuth. Clerk provides identity + session tokens for Convex authentication.

| Platform | Key Files |
|----------|-----------|
| iOS | `OnboardingView`, `OnboardingClerkSignInView`, `OnboardingAuthRouter`, `ClerkAuthService`, `ClerkConvexAuthProvider`, `RootView` |
| Android | `AuthRoute`, `OnboardingSignInLanding`, `OnboardingCarousel`, `RealClerkAuthBridge`, `ClerkConvexAuthProvider`, `AuthRepository` |
| Convex | `lib/auth.ts` (requireAuth, optionalAuth), `auth.config.ts` |

### 1.2 OpenRouter PKCE Key Exchange
After Clerk sign-in, user connects OpenRouter API key via PKCE OAuth. Code+verifier exchanged for key, stored in Keychain/Keystore.

| Platform | Key Files |
|----------|-----------|
| iOS | `OpenRouterConnectionView`, `AuthService`, `OpenRouterKeyExchanger`, `PKCEGenerator`, `KeychainService` |
| Android | `OpenRouterConnectionRoute`, `OpenRouterKeyRepository`, `PkceGenerator`, `SecureStorage` |
| Convex | (client-side only; exchange direct with `openrouter.ai`) |

### 1.3 Sign-Out
Clears Clerk session, revokes API key, logs out of Convex.

| Platform | Key Files |
|----------|-----------|
| iOS | `ClerkAuthService`, `SettingsViewModel`, `AuthServiceProtocol` |
| Android | `AuthRepository`, `SettingsViewModel` |
| Convex | `push/mutations:removeDeviceToken` |

### 1.4 Account Deletion
Permanently deletes user account and all data across all tables.

| Platform | Key Files |
|----------|-----------|
| iOS | `SettingsViewModel+Account`, `ClerkAuthService` |
| Android | `SettingsViewModel` |
| Convex | `account/actions:deleteAccount`, `account/mutations:deleteUserTableBatch` |

---

## 2. Chat

### 2.1 Create Chat
Creates a new conversation with optional folder assignment.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatListViewModel`, `ChatListView`, `AppState` |
| Android | `ChatViewModel`, `ChatRoute` |
| Convex | `chat/mutations:createChat` |

### 2.2 Send Message
User types or speaks a message. Persisted, then generation job kicked off server-side.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Sending`, `MessageInput`, `ChatView+Content` |
| Android | `ChatDetailViewModel` (performSend), `ChatDetailComposerComponents`, `ChatRepository` |
| Convex | `chat/mutations:sendMessage`, `chat/actions:runGeneration` |

### 2.3 Receive Response (Streaming)
Server streams SSE tokens via Convex real-time subscriptions. Stable history comes from `listMessages`; live token overlays come from `listStreamingMessages` and are merged client-side by `messageId`. Tokens are then interpolated for smooth rendering.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Subscriptions`, `StreamingRenderEngine`, `MessageBubble` |
| Android | `ChatDetailViewModel`, `ChatDetailMessageComponents`, `ChatRepository` |
| Convex | `chat/queries:listMessages`, `chat/queries:listStreamingMessages`, `chat/queries:getStreamingContent`, `chat/stream_writer.ts`, `chat/actions_run_generation_handler.ts`, `chat/actions_run_generation_loop.ts` |

### 2.4 Cancel / Interrupt Generation
Cancels active generation mid-stream. Job marked cancelled, SSE stream aborted.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Sending` (cancelActiveGeneration, interruptAndSendQueued) |
| Android | `ChatDetailViewModel` (interruptActiveGeneration, interruptAndSendQueued) |
| Convex | `chat/mutations:cancelGeneration`, `chat/mutations:cancelActiveGeneration` |

### 2.5 Retry / Regenerate Message
Retries a failed response or regenerates with same or different participant.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Actions` (retryMessage, retryMessageWithParticipants), `MessageActionBar` |
| Android | `ChatDetailViewModel` (retryMessage, retryMessageWithParticipant, regenerateMessage) |
| Convex | `chat/mutations:retryMessage`, `chat/mutations_retry_handler.ts` |

### 2.6 Fork Chat
Forks conversation at a specific message, creating a new chat with history up to that point.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Actions` (forkChat), `MessageContextMenu` |
| Android | `ChatDetailViewModel` (forkMessage) |
| Convex | `chat/manage:forkChat`, `chat/manage_copy_helpers.ts` |

### 2.7 Branch Navigation
Navigate between sibling branches (alternate responses at the same tree node).

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Branching`, `BranchIndicatorView`, `ChatView+MessageList` |
| Android | `ChatDetailViewModel` (switchToBranch, siblingMessages), `ChatDetailBranchComponents`, `ChatDetailAlgorithms` |
| Convex | `chat/manage:switchBranchAtFork` (canonical fork switching), `chat/manage:updateChat` (activeBranchLeaf persistence for direct state updates) |

### 2.8 Queued Follow-Ups
User queues additional messages while a generation is in-flight. Auto-send after current generation completes.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+QueuedFollowUps`, `PendingFollowUpQueueView` |
| Android | `ChatDetailViewModel` (queueCurrentDraft, drainQueuedFollowUpsIfNeeded), `ChatDetailQueueComponents` |
| Convex | (client-side queue; drains via `chat/mutations:sendMessage`) |

### 2.9 Chat Management (Rename, Delete, Pin, Folders)
Rename, delete (bulk), pin/reorder, and organize chats into folders.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatListViewModel`, `ChatListViewModel+Folders`, `FolderManagerView` |
| Android | `ChatViewModel`, `ChatRoute`, `SettingsRepository` |
| Convex | `chat/manage:updateChat`, `chat/manage:deleteChat`, `chat/manage:bulkDeleteChats`, `chat/manage:reorderPinnedChats`, `folders/mutations:*` |

### 2.10 Mention Autocomplete
User types `@` to mention a model or persona inline with autocomplete.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Mentions`, `MentionAutocompleteView`, `MessageInput` |
| Android | `ChatDetailViewModel`, `ChatDetailComposerComponents` |
| Convex | (client-side; uses cached models/personas) |

---

## 3. Audio (M20)

### 3.1 Audio Recording
User records voice via microphone. Transcribed and optionally attached as audio.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Attachments` (startAudioRecording, stopAudioRecording), `MessageInput` |
| Android | `ChatDetailRoute` (beginRecording, stopRecording), `AndroidAudioRecorder`, `AndroidAudioProcessor` |
| Convex | `chat/mutations:createUploadUrl`, `chat/mutations:sendMessage` (with audio attachment) |

### 3.2 Audio Import
User imports existing audio file from device file system.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Attachments` (prepareImportedAttachment) |
| Android | `ChatDetailRoute` (documentPicker), `ChatDetailViewModel` (stageAttachment) |
| Convex | `chat/mutations:createUploadUrl` |

### 3.3 TTS Audio Generation
User requests text-to-speech for an assistant message. Server generates via OpenRouter TTS.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Attachments` (toggleMessageAudioPlayback), `MessageActionBar` |
| Android | `ChatDetailViewModel` (requestAudioGeneration), `ChatDetailRoute` (toggleMessageAudio) |
| Convex | `chat/mutations:requestAudioGeneration`, `chat/actions:generateAudioForMessage`, `chat/audio_actions.ts`, `chat/audio_public_handlers.ts` |

### 3.4 Auto-Audio Response
When enabled, TTS automatically generated and played for assistant responses to audio-input messages.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Subscriptions` (syncPendingAutoAudioGenerationState, maybeAutoPlayGeneratedAssistantAudio, retryAutoPlayAfterPlaybackFinished) |
| Android | `ChatDetailRoute` (LaunchedEffect auto-audio sync), `ChatDetailUtils` (computeAutoAudioSyncResult) |
| Convex | `chat/mutations:requestAudioGeneration`, `chat/actions:generateAudioForMessage` |

### 3.5 Audio Playback
User plays back generated or attached audio on a message.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Attachments` (playMessageAudio, stopMessageAudioPlayback, resolvePlayableAudioURL) |
| Android | `ChatDetailRoute` (toggleMessageAudio, stopMessageAudio) |
| Convex | `chat/queries:getMessageAudioUrl` |

### 3.6 Voice Preview
User previews a TTS voice sample from settings.

| Platform | Key Files |
|----------|-----------|
| iOS | `SettingsViewModel`, `ChatParametersView` |
| Android | `ChatDetailViewModel`, `ChatRepository` (previewVoice) |
| Convex | `chat/actions:previewVoice`, `chat/audio_actions.ts` (previewVoiceHandler) |

---

## 4. Multi-Participant

### 4.1 Add / Remove / Reorder Participants
Manage multi-model group: add models/personas, remove, reorder turn priority.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Participants`, `UnifiedParticipantPickerView` (+ Content, SelectionRows, Controls) |
| Android | `ChatDetailViewModel` (addChatParticipant, removeChatParticipant, moveChatParticipant) |
| Convex | `participants/mutations:addParticipant`, `participants/mutations:removeParticipant`, `participants/mutations:setParticipants` |

### 4.2 Multi-Model Response Display
Multiple participants generate responses shown side-by-side or sequentially.

| Platform | Key Files |
|----------|-----------|
| iOS | `MultiModelResponseView`, `ChatView+MessageList` |
| Android | `ChatDetailMessageComponents`, `ChatDetailRoute` (MultiModelMessageGroup) |
| Convex | `chat/actions_run_generation_participant.ts`, `participants/queries:listByChat` |

---

## 5. Autonomous Mode

### 5.1 Configure Settings
User configures max cycles, pause between turns, auto-stop on consensus, moderator.

| Platform | Key Files |
|----------|-----------|
| iOS | `AutonomousSettingsSheet`, `ChatViewModel+Autonomous`, `AutonomousSettings` |
| Android | `ChatDetailViewModel` (updateAutonomousMaxCycles, etc.), `ChatDetailAutonomousComponents` |

### 5.2 Start Session
Participants take turns generating responses automatically.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Autonomous` (startAutonomousMode), `ChatViewModel+AutonomousSession` |
| Android | `ChatDetailViewModel` (startAutonomousMode) |
| Convex | `autonomous/mutations:startSession`, `autonomous/actions:runCycle`, `autonomous/actions_run_cycle_handler.ts` |

### 5.3 Pause / Resume / Stop
Lifecycle controls for active autonomous sessions.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Autonomous` (pauseAutonomous, resumeAutonomous, stopAutonomous), `AutonomousToolbar` |
| Android | `ChatDetailViewModel` (pauseAutonomousMode, resumeAutonomousMode, stopAutonomousMode) |
| Convex | `autonomous/mutations:pauseSession`, `autonomous/mutations:resumeSession`, `autonomous/mutations:stopSession` |

### 5.4 User Intervention
User injects a message or directive into an active session.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Autonomous` (handleAutonomousIntervention) |
| Android | `ChatDetailViewModel` (handleAutonomousIntervention) |
| Convex | `autonomous/mutations:handleUserIntervention` |

---

## 6. Ideascape

### 6.1 Toggle View
Switch between linear chat view and spatial canvas.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Branching` (toggleViewMode), `ChatView+Toolbar` |
| Android | `ChatDetailViewModel` (toggleViewMode), `ChatDetailIdeascapeComponents` |

### 6.2 Node Positioning / Drag
Drag message nodes on canvas. Positions synced to Convex with debounce.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Ideascape`, `IdeascapeCanvasView+Gestures`, `IdeascapeNodePositionSync`, `IdeascapeLayoutEngine` |
| Android | `ChatDetailViewModel` (updateNodePosition, observeNodePositions) |
| Convex | `nodePositions/mutations:upsert`, `nodePositions/mutations:batchUpsert`, `nodePositions/queries:listByChat` |

### 6.3 Node Selection / Canvas Send
Select nodes as context, send message referencing selected nodes.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+IdeascapeContext`, `IdeascapeContextResolver`, `IdeascapeContextSummaryView` |
| Android | `ChatDetailViewModel` (toggleIdeascapeSelection, focusIdeascapeNode) |
| Convex | `chat/mutations:sendMessage` (with explicitParentIds) |

---

## 7. Search

### 7.1 Web Search (Inline)
Model runs web search tool during generation.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Preferences` (toggleWebSearch, setSearchMode), `SearchPanelView` |
| Android | `ChatDetailViewModel` (setWebSearchEnabled, setSearchMode, setSearchComplexity) |
| Convex | `search/actions_web_search.ts:runWebSearch`, `search/queries:watchSearchSession` |

### 7.2 Research Paper Generation
Multi-phase deep research pipeline (planning, search, analysis, depth search, synthesis, paper).

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Sending` (sendResearchPaper), `ResearchProgressView` |
| Android | `ChatDetailViewModel`, `ChatRepository` (startResearchPaper) |
| Convex | `search/mutations:startResearchPaper`, `search/workflow.ts:researchPaperPipeline`, `search/workflow_nonstream_phases.ts`, `search/workflow_paper_phase.ts` |

---

## 8. Attachments

### 8.1 Image Attachment
Attach image from photo library or camera.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Attachments` (addAttachment), `CameraView`, `StagedAttachmentStrip` |
| Android | `ChatDetailRoute` (imagePicker), `ChatDetailViewModel` (stageAttachment) |
| Convex | `chat/mutations:createUploadUrl`, `chat/mutations:sendMessage` |

### 8.2 Document Attachment
Attach PDF, DOCX, TXT, etc.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Attachments` (prepareImportedAttachment), `DocumentImportTextExtractor` |
| Android | `ChatDetailRoute` (documentPicker), `ChatDetailViewModel` |
| Convex | `chat/mutations:createUploadUrl`, `chat/mutations:sendMessage` |

### 8.3 Knowledge Base File Attachment
Select previously uploaded KB files to attach.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatViewModel+Attachments` (attachKBFiles), `KBFilePickerView` |
| Android | `ChatDetailViewModel` (stageKnowledgeFile), `ChatDetailComposerComponents` |
| Convex | `chat/queries:listKnowledgeBaseFiles` |

---

## 9. Settings

### 9.1 Model Selection
Default model and per-chat override. Model catalog browsing, capability filtering, wizard.

| Platform | Key Files |
|----------|-----------|
| iOS | `ModelPickerViewModel`, `UnifiedModelPickerView`, `ModelChoiceWizardView`, `ModelInfoSheet` |
| Android | `SettingsViewModel`, `ChatDefaultsViewModel`, `ChatDefaultsRoute` |
| Convex | `models/queries:listModels`, `models/queries:listModelSummaries`, `preferences/mutations:upsertPreferences` |

### 9.2 Persona Management
Create, edit, delete personas with system prompts, avatars, model bindings, skill bindings.

| Platform | Key Files |
|----------|-----------|
| iOS | `PersonaListView`, `PersonaDetailView`, `PersonaEditorView` (+ Sections, Logic) |
| Android | `PersonasListRoute`, `PersonasListViewModel`, `PersonasRepository` |
| Convex | `personas/mutations:create`, `personas/mutations:update`, `personas/mutations:remove` |

### 9.3 Generation Parameters
Temperature, max tokens, reasoning, per-chat overrides.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatParametersView`, `ChatViewModel+ChatOverrides`, `ChatOverrides` |
| Android | `ChatDetailViewModel` (updateChatParameterOverrides), `ChatParametersDialog`, `ChatParameterOverrides` |
| Convex | `preferences/mutations:upsertPreferences`, `chat/manage:updateChat` |

### 9.4 Memory Management
Enable/disable memory, gating mode, extraction model, manage memories.

| Platform | Key Files |
|----------|-----------|
| iOS | `MemoryListView`, `MemorySettingsView`, `MemoryViewModel` |
| Android | `MemoryListRoute`, `MemorySettingsRoute`, `MemoryListViewModel`, `MemoryRepository` |
| Convex | `memory/operations:list`, `memory/operations:approve`, `memory/operations:reject`, `memory/operations:createManual`, `memory/operations:consolidate` |

### 9.5 Favorites
Quick-access chat presets with model/persona/prompt.

| Platform | Key Files |
|----------|-----------|
| iOS | `ManageFavoritesView`, `FavoriteEditorView`, `FavoritesStripView` |
| Android | `ManageFavoritesRoute`, `ManageFavoritesViewModel`, `FavoritesStrip` |
| Convex | `favorites/mutations:createFavorite`, `favorites/mutations:updateFavorite`, `favorites/mutations:reorderFavorites` |

### 9.6 Knowledge Base
Upload, view, delete knowledge base files for RAG.

| Platform | Key Files |
|----------|-----------|
| iOS | `KnowledgeBaseView`, `KnowledgeBaseViewModel` |
| Android | `KnowledgeBaseRoute`, `KnowledgeBaseViewModel`, `KnowledgeBaseRepository` |
| Convex | `chat/queries:listKnowledgeBaseFiles`, `chat/mutations:deleteKnowledgeBaseFile` |

---

## 10. Integrations

### 10.1 OAuth Connections (Google, Microsoft, Notion, Apple Calendar)
User connects external services via OAuth PKCE. Code exchanged through Convex backend.

| Platform | Key Files |
|----------|-----------|
| iOS | `GoogleConnectionViewModel`, `MicrosoftConnectionViewModel`, `NotionConnectionViewModel`, `AppleCalendarConnectionViewModel`, `SettingsConnectedAccountsSection` |
| Android | `SettingsIntegrationsViewModel`, `SettingsIntegrationsRoute`, `IntegrationAuthRepository` |
| Convex | `oauth/google:exchangeGoogleCode`, `oauth/microsoft:exchangeMicrosoftCode`, `oauth/notion:exchangeNotionCode`, `oauth/apple_calendar:connectAppleCalendar` |

### 10.2 Chat Integration Toggles
Enable/disable specific integrations per chat (which tools model can use).

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatIntegrationsPickerSheet`, `ChatViewModel+ChatOverrides` |
| Android | `ChatDetailViewModel` (toggleIntegration, rebuildIntegrations) |
| Convex | `chat/manage:updateChat`, `integrations/request_gates.ts` |

### 10.3 Tool Execution
During generation, model invokes integration tools (Gmail, Drive, Calendar, Notion, OneDrive, Outlook).

| Platform | Key Files |
|----------|-----------|
| iOS | `ToolCallAccordionView`, `MessageBubble+ToolCalls` (display only) |
| Android | `ChatDetailAdvancedMessageComponents` (display only) |
| Convex | `tools/google/*`, `tools/microsoft/*`, `tools/notion/*`, `tools/apple/*`, `tools/registry.ts` |

---

## 11. Skills

### 11.1 Browse / Create / Edit Skills
Skill catalog browsing, custom skill creation and editing.

| Platform | Key Files |
|----------|-----------|
| iOS | `SkillsListView`, `SkillDetailView`, `SkillEditorView`, `SkillsViewModel` |
| Android | `SkillsListRoute`, `SkillsListViewModel`, `SkillDetailRoute`, `SkillsRepository` |
| Convex | `skills/queries:listDiscoverableSkills`, `skills/mutations:createSkill`, `skills/mutations:updateSkill`, `skills/mutations:archiveSkill` |

### 11.2 Chat Skill Toggles
Enable/disable specific skills per chat.

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatSkillsPickerSheet`, `ChatViewModel+ChatOverrides` |
| Android | `ChatDetailViewModel` (toggleChatSkill, rebuildChatSkillToggles) |
| Convex | `skills/mutations:setChatSkillsPublic` |

---

## 12. Billing

### 12.1 Pro Subscription Purchase
StoreKit 2 (iOS) / Play Billing (Android) purchase flow.

| Platform | Key Files |
|----------|-----------|
| iOS | `StoreService` (purchase, loadProducts, handleVerifiedTransaction), `PaywallView`, `ProGateModifier` |
| Android | `PlayBillingService` (launchPurchaseFlow, onPurchasesUpdated), `BillingRepository` |
| Convex | `preferences/mutations:syncEntitlement` (iOS), `preferences/mutations:syncPlayEntitlement` (Android) |

### 12.2 Paywall Gate
Pro-only features display paywall for free-tier users.

| Platform | Key Files |
|----------|-----------|
| iOS | `PaywallView`, `ProGateModifier`, `ProBadge` |
| Android | `ChatDetailViewModel` (lockedFeatureName), `ProPaywallDialog` |
| Convex | `preferences/queries:getProStatus`, `lib/auth.ts` (requirePro) |

### 12.3 Credit Balance Monitoring
Monitors OpenRouter credit balance, shows low-balance banners/notifications.

| Platform | Key Files |
|----------|-----------|
| iOS | `CreditBalanceCheck`, `LowBalanceBanner`, `NotificationService` (scheduleCreditAlert) |
| Android | `SettingsProvidersViewModel` |
| Convex | (client-side OpenRouter API) |

---

## 13. Scheduled Jobs

### 13.1 Create / Edit / Delete Job
Recurring AI task with prompt, model, schedule, optional KB files.

| Platform | Key Files |
|----------|-----------|
| iOS | `ScheduledJobEditorView` (+ Sections, Logic, Persistence), `ScheduledJobsViewModel` |
| Android | `ScheduledJobsEditorScreen`, `ScheduledJobsListViewModel`, `ScheduledJobsRepository` |
| Convex | `scheduledJobs/mutations:createJob`, `scheduledJobs/mutations:updateJob`, `scheduledJobs/mutations:deleteJob` |

### 13.2 Pause / Resume / Run Now
Lifecycle controls and manual trigger.

| Platform | Key Files |
|----------|-----------|
| iOS | `ScheduledJobsListView`, `ScheduledJobDetailView`, `ScheduledJobsViewModel` |
| Android | `ScheduledJobsListRoute`, `ScheduledJobsListViewModel` |
| Convex | `scheduledJobs/mutations:pauseJob`, `scheduledJobs/mutations:resumeJob`, `scheduledJobs/mutations:runJobNow` |

### 13.3 Job Execution (Backend)
Backend executes jobs on schedule, creates chat + messages, runs generation.

| Platform | Key Files |
|----------|-----------|
| Convex | `scheduledJobs/actions:executeScheduledJob`, `scheduledJobs/actions_execution.ts`, `scheduledJobs/actions_lifecycle.ts`, `scheduledJobs/recurrence.ts` |

### 13.4 Push Notifications
Notifications sent when scheduled jobs complete.

| Platform | Key Files |
|----------|-----------|
| iOS | `NotificationService` (registerToken, syncTokenIfNeeded), `AppDelegate` |
| Android | `NotificationLifecycleRepository` (registerFcmToken) |
| Convex | `push/actions:sendPushNotification`, `push/mutations:registerDeviceToken`, `push/apns_jwt.ts` |

---

## 14. Subagents

### 14.1 Enable / Configure
Enable subagent system for a chat (off, auto, always).

| Platform | Key Files |
|----------|-----------|
| iOS | `ChatSubagentsSheet`, `ChatViewModel+Subagents` |
| Android | `ChatDetailViewModel` (setSubagentsMode) |
| Convex | `chat/manage:updateChat` |

### 14.2 Batch Execution & Monitoring
Model spawns parallel sub-tasks. Real-time subscription to batch progress.

| Platform | Key Files |
|----------|-----------|
| iOS | `SubagentBatchPanel`, `ChatViewModel+Subscriptions` |
| Android | `ChatDetailViewModel`, `ChatDetailInlineComponents`, `ChatRepository` (watchSubagentBatch) |
| Convex | `subagents/mutations:createBatch`, `subagents/actions:runSubagentRun`, `subagents/queries:getBatchView`, `tools/spawn_subagents.ts` |

---

## 15. Cron Jobs & Backend Maintenance

| Job | Schedule | Convex Function |
|-----|----------|-----------------|
| Model catalog sync | Every 1h | `models/sync:syncFromOpenRouter` |
| Benchmark sync | Daily 2:00 UTC | `models/artificial_analysis_sync:syncBenchmarks` |
| Use-case ranking sync | Every 6h | `models/openrouter_usecase_sync:syncUseCases` |
| Stale job cleanup | Every 15min | `jobs/cleanup:cleanStale` |
| Memory consolidation | Daily 3:00 UTC | `memory/operations:consolidate` |
| Stale search cleanup | Daily 4:00 UTC | `search/mutations_internal:cleanStaleSearchPhases` |
| Old job run cleanup | Daily 5:00 UTC | `scheduledJobs/mutations:cleanOldJobRuns` |
| Runtime sandbox cleanup | Daily 6:00 UTC | `runtime/actions:cleanupMarkedSessions` |
| Skill catalog seeding | On deploy | `skills/actions:seedSystemCatalog` |

---

## 16. Runtime / Code Execution

Model executes Python/code in E2B sandboxes (tool calls), producing artifacts (files, charts).

| Platform | Key Files |
|----------|-----------|
| iOS | `GeneratedFileCardView`, `GeneratedChartCardView`, `ToolCallAccordionView` (display) |
| Android | `GeneratedFileComponents`, `GeneratedChartComponents` (display) |
| Convex | `runtime/mutations:createSession`, `runtime/actions:executeCode`, `tools/code_workspace.ts`, `tools/file_generation.ts` |

---

## Cross-Cutting Concerns

### Real-Time Subscriptions
All data flows through Convex subscriptions. Changes to any document are pushed to connected clients in real-time. Key subscription patterns:
- **Messages:** `chat/queries:listMessages` — windowed (most recent N) with lazy older-message loading
- **Chat detail:** `chat/manage:getChat` — title, branch leaf, overrides
- **Participants:** `participants/queries:listByChat`
- **Settings:** `preferences/queries:getPreferences`, `preferences/queries:getModelSettings`
- **Autonomous sessions:** `autonomous/queries:watchSession`
- **Node positions:** `nodePositions/queries:listByChat`
- **Search sessions:** `search/queries:watchSearchSession`

### Error Handling Pattern
- **Backend:** `ConvexError` for user-facing errors with structured data
- **iOS:** Services `throw` specific error enums; ViewModels `catch` and set `errorMessage` state
- **Android:** Services throw; ViewModels catch and update `uiState.errorMessage`
- **UI:** Both platforms display error via animated error banner in chat, or snackbar for transient messages

### Data Flow
```
User Input → ViewModel → ConvexService/ChatRepository → Convex Mutation
Convex Mutation → Scheduled Action → OpenRouter API → Stream Writer
Stream Writer → Convex Document Update → Subscription → ViewModel → UI
```

---

## M26: Lyria Music Generation Flow

### User Flow

```
1. User selects a Lyria model (Lyria Clip or Lyria Pro) in the model picker
2. User types a music prompt (e.g., "Write an upbeat pop song about summer")
3. User taps Send
4. Assistant message appears with text content (timestamped lyrics + caption)
5. Audio player appears inline above/below the lyrics when audioStorageId is patched
6. User can: play/pause, seek, adjust speed (0.5x–2x), download MP3
7. Generated audio file appears in Knowledge Base
```

### Technical Flow

```
User sends prompt
  → sendMessage mutation → schedules runGeneration action
  → Convex action streams from OpenRouter
  → SSE parser detects delta.content (lyrics) → patches message.content
  → SSE parser detects delta.audio.data (base64 MP3)
  → Stream completes:
    → Decode base64 → parseMp3DurationMs (frame-walk)
    → ctx.storage.store(Blob) → audioStorageId
    → finalizeGeneration: patch message + insert generatedFiles
  → Client subscription fires with updated message
  → isLyriaMusic check (audioStorageId + modelId) → show AudioPlayerView
  → getMessageAudioUrl query → signed storage URL → AVPlayer/MediaPlayer/Audio
```

### Platform Components

| Platform | Detection | Player | Download |
|----------|-----------|--------|----------|
| iOS | `ConvexMessage.isLyriaMusic` | `AudioPlayerView.swift` (AVPlayer) | Share sheet via UIActivityViewController |
| Android | `ChatMessage.isLyriaMusic` | `LyriaAudioPlayer.kt` (MediaPlayer) | Intent.ACTION_VIEW to /download endpoint |
| Web | `isLyria` computed in AudioMessageBubble | `AudioMessageBubble.tsx` (HTML5 Audio) | Programmatic `<a>` download click |

---

*Last updated: 2026-04-07 — M26 Lyria music generation user/technical flow.*
