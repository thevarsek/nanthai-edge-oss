# Project Structure

> Complete project directory tree for NanthAI Edge (post-M33 document generation — iOS/Android/Convex/Web).
> SwiftData models removed. Convex backend at repo root. `messageChunks` table removed.

```
nanthai-edge/                              # Repository root
├── convex/                                 # Convex backend (TypeScript)
│   ├── schema.ts                           # Database schema (49 app tables, imports 4 table files)
│   ├── schema_tables_core.ts               # Core table definitions (22 tables incl. messages, documents/documentVersions, generated files/media, search state)
│   ├── schema_tables_catalog.ts            # Catalog table definitions (9 tables incl. skills, messageQueryEmbeddings, messageMemoryContexts)
│   ├── schema_tables_user.ts               # User table definitions (14 tables incl. purchaseEntitlements, scheduledJobs, jobRuns, userSecrets, deviceTokens, favorites)
│   ├── schema_tables_runtime.ts            # Runtime/capability tables (4 tables: userCapabilities, sandboxSessions, sandboxArtifacts, sandboxEvents)
│   ├── schema_validators.ts                # Shared validators (scheduledJobStatus, scheduledJobRecurrence, jobRunStatus, chatSource, document citation/event validators, scheduledJobStep, memoryRetrievalMode, memoryScopeType, memorySourceType, subagent statuses, skillScope, skillOrigin, skillVisibility, skillLockState, skillStatus, skillRuntimeMode, skillCompilationStatus, retryContract, retryParticipantSnapshot, retrySearchMode, retryVideoConfig, terminalErrorCode)
│   ├── convex.config.ts                    # Convex project config
│   ├── auth.config.ts                      # Clerk JWT auth config
│   ├── crons.ts                            # Scheduled jobs — 9 crons (model sync 4h, AA daily 2 UTC, use-cases 6h, stale jobs 15m, memory consolidation daily 3 UTC, stale search phases daily 4 UTC, old job runs daily 5 UTC, markRuntimeCleanupCandidates hourly, cleanupRuntimeSandboxes daily 6 UTC)
│   ├── health.ts                           # Health check endpoint
│   ├── http.ts                             # HTTP router — /download endpoint for file storage (M10)
│   ├── capabilities/
│   │   ├── mutations.ts                    # Internal/manual capability grants for Pro/Max-style rollout (M19)
│   │   ├── queries.ts                      # Account capability queries (public + internal) (M19)
│   │   └── shared.ts                       # Capability merge helpers — entitlement + manual grants (M19)
│   ├── chat/
│   │   ├── mutations.ts                    # sendMessage, updateTitle, deleteChat, etc.
│   │   ├── mutations_args.ts               # Mutation argument validators
│   │   ├── mutations_internal_handlers.ts  # Internal mutation handlers
│   │   ├── mutations_public_handlers.ts    # Public mutation handlers
│   │   ├── mutations_retry_handler.ts      # Retry mutation handler
│   │   ├── mutations_memory_lifecycle_handlers.ts # Memory lifecycle handlers
│   │   ├── actions.ts                      # runGeneration (server-side OpenRouter streaming)
│   │   ├── actions_args.ts                 # Action argument validators
│   │   ├── actions_run_generation_handler.ts   # Top-level generation handler — tool registry, preflight batching, TTFT instrumentation
│   │   ├── actions_run_generation_participant.ts # Per-participant stream producer — tool-call loop + parallelized preflight
│   │   ├── actions_run_generation_context.ts   # Generation context builder
│   │   ├── queries_generation_context.ts       # Consolidated internal preflight query for generation startup
│   │   ├── actions_run_generation_loop.ts     # Tool-call generation loop with compaction (M13)
│   │   ├── actions_run_generation_types.ts     # Generation type definitions
│   │   ├── actions_run_generation_failures.ts  # Failure handling
│   │   ├── actions_generate_title_handler.ts   # Title generation — hardened prompt (M10)
│   │   ├── actions_post_process_handler.ts     # Post-processing handler
│   │   ├── actions_extract_memories_handler.ts # Memory extraction handler
│   │   ├── actions_extract_memories_utils.ts   # Memory extraction utilities
│   │   ├── actions_memory_lifecycle.ts         # Memory lifecycle actions
│   │   ├── action_image_helpers.ts             # Image extraction helpers
│   │   ├── action_memory_helpers.ts            # Memory action helpers
│   │   ├── queries.ts                      # listChats, getMessages, getChat, getAttachmentUrl
│   │   ├── queries_args.ts                 # Query argument validators
│   │   ├── queries_handlers.ts             # Query handler dispatch
│   │   ├── queries_handlers_public.ts      # Public query handlers
│   │   ├── queries_handlers_internal.ts    # Internal query handlers
│   │   ├── query_helpers.ts                # Query helper functions
│   │   ├── helpers.ts                      # buildRequestMessages, context building
│   │   ├── helpers_types.ts                # Helper type definitions
│   │   ├── helpers_utils.ts                # Helper utilities
│   │   ├── helpers_attachment_utils.ts     # Attachment handling — document-aware injection (M10)
│   │   ├── generation_helpers.ts           # Generation helpers
│   │   ├── lifecycle_helpers.ts            # Lifecycle management helpers
│   │   ├── title_helpers.ts                # Title generation helpers
│   │   ├── stream_writer.ts                # StreamWriter — shared streaming utility (M9.5)
│   │   ├── stream_patch_throttle.ts        # Patch cadence thresholds + helpers (M9.5)
│   │   ├── manage.ts                       # Chat management (archive, duplicate, fork)
│   │   ├── manage_args.ts                  # Management argument validators
│   │   ├── manage_copy_helpers.ts          # Copy operation helpers
│   │   ├── manage_delete_helpers.ts        # Deletion helpers
│   │   ├── manage_handlers.ts              # Management operation handlers
│   │   ├── manage_helpers.ts               # Management utilities
│   │   ├── mutation_send_helpers.ts        # Send message helpers
│   │   ├── generated_file_helpers.ts       # Shared generated-file extraction helpers
│   │   ├── compaction.ts                   # Context compaction engine — Gemini 3.1 Flash Lite (M13)
│   │   ├── generation_continuation_shared.ts # Durable continuation types — lease constant, terminal statuses, checkpoint interfaces (post-M27)
│   │   ├── actions_run_generation_continuation.ts # Continuation action — claims lease, restores checkpoint, resumes generation (post-M27)
│   │   ├── mutations_generation_continuation_handlers.ts # Continuation CRUD — checkpoint persistence, lease-based claiming, cancel (post-M27)
│   │   ├── helpers_video_url_utils.ts     # Video URL extraction/parsing helpers
│   │   ├── audio_actions.ts               # TTS generation action — gpt-audio-mini via OpenRouter (M20)
│   │   ├── audio_public_handlers.ts       # Public mutation/query handlers for audio (M20)
│   │   ├── audio_shared.ts                # Audio constants, PCM→WAV encoder, voice helpers, Lyria model IDs, MP3 frame parser (M20/M26)
│   │   ├── audio_trigger.ts               # Auto-audio trigger wired into generation completion (M20)
│   │   ├── retry_contract.ts              # RetryContract types + buildRetryContract() / cloneRetryContract() helpers (PR #78)
│   │   └── terminal_error.ts              # TerminalErrorCode type + classifyTerminalErrorCode() (PR #78)
│   ├── tools/                              # Tool infrastructure (M10/M14/M18/M19)
│   │   ├── index.ts                        # buildToolRegistry() — shared builder for all entry points
│   │   ├── registry.ts                     # createTool() factory + ToolRegistry class
│   │   ├── execute_loop.ts                 # runToolCallLoop() — up to 20 rounds, async-deferred tool pause support
│   │   ├── spawn_subagents.ts              # spawn_subagents tool — async parent pause + child batch creation
│   │   ├── generate_docx.ts               # generate_docx tool (docx package)
│   │   ├── read_docx.ts                   # read_docx tool (extracts text/markdown)
│   │   ├── edit_docx.ts                   # edit_docx tool (section-based editing)
│   │   ├── docx_reader.ts                 # JSZip-based .docx XML parser (replaces mammoth)
│   │   ├── generate_pptx.ts               # generate_pptx tool (pptxgenjs package)
│   │   ├── read_pptx.ts                   # read_pptx tool (extracts slides/notes)
│   │   ├── edit_pptx.ts                   # edit_pptx tool (read→regenerate pattern)
│   │   ├── pptx_reader.ts                 # JSZip-based .pptx text/structure extractor
│   │   ├── generate_xlsx.ts               # generate_xlsx tool (JSZip-based OOXML)
│   │   ├── read_xlsx.ts                   # read_xlsx tool (structured data + markdown)
│   │   ├── edit_xlsx.ts                   # edit_xlsx tool (read→regenerate pattern)
│   │   ├── xlsx_writer.ts                 # JSZip-based OOXML SpreadsheetML builder
│   │   ├── xlsx_reader.ts                 # JSZip-based .xlsx parser
│   │   ├── generate_text_file.ts          # generate_text_file tool (.csv/.txt/.md)
│   │   ├── read_text_file.ts              # read_text_file tool (UTF-8 + CSV structured preview)
│   │   ├── generate_eml.ts               # generate_eml tool (RFC 5322 email files)
│   │   ├── read_eml.ts                   # read_eml tool (.eml parser: headers, multipart, QP)
│   │   ├── fetch_image.ts                # fetch_image tool (URL → Convex storage)
│   │   ├── image_resolver.ts              # Shared helper: storageId → base64 data URI
│   │   ├── google/                        # Google tools (M24 narrowed OAuth + Manual Gmail)
│   │   │   ├── auth.ts                    # Google OAuth token refresh + auth helper (identity, drive.file, calendar.events)
│   │   │   ├── gmail.ts                   # 6 Gmail tools backed by gmail_manual IMAP/SMTP credentials
│   │   │   ├── gmail_manual_client.ts     # Manual Gmail IMAP/SMTP app-password client
│   │   │   ├── drive.ts                   # 4 Drive tools scoped to drive.file + explicit Picker/OnePick grants
│   │   │   ├── calendar.ts                # 3 Calendar tools scoped to calendar.events
│   │   │   └── index.ts                   # Barrel export: registerGoogleTools()
│   │   ├── microsoft/                     # Microsoft 365 tools (M10 Phase C) — 14 tools
│   │   │   ├── auth.ts                    # Microsoft OAuth token refresh + auth helper
│   │   │   ├── outlook.ts                 # 6 Outlook tools: search, read, send, reply, delete, move
│   │   │   ├── onedrive.ts                # 4 OneDrive tools: search, upload, download, move
│   │   │   ├── calendar.ts                # 3 MS Calendar tools: list, create, delete
│   │   │   └── index.ts                   # Barrel export: registerMicrosoftTools()
│   │   ├── notion/                        # Notion tools (M10 Phase D) — 7 tools
│   │   │   ├── auth.ts                    # Notion OAuth token refresh + HTTP Basic Auth
│   │   │   ├── pages.ts                   # 7 Notion tools: search, read, create, update, delete, update_database_entry, query_database
│   │   │   └── index.ts                   # Barrel export: registerNotionTools()
│   │   ├── slack/                          # Slack tools (hosted MCP at mcp.slack.com)
│   │   │   ├── auth.ts                    # Slack OAuth token refresh + auth helper
│   │   │   ├── client.ts                  # Slack MCP JSON-RPC client + session handshake
│   │   │   ├── tools.ts                   # Thin barrel re-exporting the four tool modules below
│   │   │   ├── tools_shared.ts            # runSlackTool + extractText + assignOptional helpers
│   │   │   ├── tools_messages.ts          # send/send_draft/schedule/read_channel/read_thread
│   │   │   ├── tools_search.ts            # search_messages (public or public+private), search_channels, search_users
│   │   │   ├── tools_canvas.ts            # create/update/read canvas + read_user_profile
│   │   │   ├── mcp_probe.ts               # fetchLiveMcpTools() — shared tools/list probe
│   │   │   ├── mcp_tools_snapshot.ts      # Committed baseline of Slack MCP tool shapes
│   │   │   ├── drift_check.ts             # Weekly cron: diffs live tools/list vs snapshot, logs drift
│   │   │   ├── diagnose.ts                # Manual tools/list probe for debugging
│   │   │   └── index.ts                   # Barrel export: registerSlackTools()
│   │   ├── cloze/                          # Cloze CRM tools
│   │   │   ├── auth.ts                    # Cloze API key auth helper
│   │   │   ├── client.ts                  # Cloze REST API client
│   │   │   ├── people.ts                  # Cloze people/contact tools
│   │   │   ├── projects.ts               # Cloze project tools
│   │   │   ├── timeline.ts               # Cloze timeline tools
│   │   │   └── index.ts                   # Barrel export: registerClozeTools()
│   │   ├── scheduled_jobs.ts              # 3 scheduled job tools: create, list, delete (M13)
│   │   ├── persona.ts                     # 2 persona tools: create, delete (M13)
│   │   ├── search_chats.ts               # 1 search_chats tool — full-text search (M13)
│   │   ├── load_skill.ts                 # load_skill tool — progressive disclosure entry point (M18)
│   │   ├── skill_management.ts           # 8 skill management tools: list, create, update, delete, enable/disable chat, assign/remove persona (M18)
│   │   ├── workspace_registry.ts         # Registers Max runtime workspace + analytics tools (M19)
│   │   ├── workspace_exec.ts             # Run shell commands inside the per-generation just-bash workspace (M19, rewritten M27)
│   │   ├── workspace_list_files.ts       # List workspace files/folders (M19)
│   │   ├── workspace_read_file.ts        # Read text-like workspace files (M19)
│   │   ├── workspace_write_file.ts       # Write text files into the workspace (M19)
│   │   ├── workspace_make_dirs.ts        # Create workspace directories (M19)
│   │   ├── workspace_import_file.ts      # Import owned Convex storage files into the workspace (M19)
│   │   ├── workspace_export_file.ts      # Export sandbox files back to Convex storage (M19)
│   │   ├── workspace_reset.ts            # Reset the chat sandbox and workspace state (M19)
│   │   ├── data_python_exec.ts           # Notebook-style Python analytics via Pyodide WASM (M19, rewritten M27)
│   │   └── apple/                         # Apple Calendar tools (CalDAV/iCal via tsdav)
│   │       ├── auth.ts                    # Apple-specific CalDAV auth helper
│   │       ├── calendar_read.ts           # Calendar read tools (list events, search)
│   │       ├── calendar_write.ts          # Calendar write tools (create, update, delete events)
│   │       ├── client.ts                  # tsdav CalDAV client factory
│   │       ├── ical.ts                    # iCal format parser/builder
│   │       ├── index.ts                   # Barrel export: registerAppleCalendarTools()
│   │       └── shared.ts                  # Shared Apple Calendar types/helpers
│   ├── subagents/
│   │   ├── actions.ts                      # Child run + parent continuation action entry points
│   │   ├── actions_run_subagent.ts         # Child run execution + continuation checkpointing
│   │   ├── actions_continue_parent.ts      # Parent resume after all children terminal
│   │   ├── mutations.ts                    # Batch/run persistence + continuation checkpoint mutations
│   │   ├── queries.ts                      # Public batch view + internal batch/run lookups
│   │   ├── shared.ts                       # Shared helpers, terminal-state rules, continuation payload builder
│   │   └── stream_writer.ts                # Child streaming persistence helper
│   ├── autonomous/
│   │   ├── actions.ts                      # runAutonomousCycle
│   │   ├── actions_run_cycle_turn.ts       # Per-turn stream producer
│   │   ├── mutations.ts                    # startRun, stopRun, addTurn
│   │   ├── mutations_helpers.ts            # Autonomous mutation helpers
│   │   └── queries.ts                      # getRunStatus, getTurns
│   ├── oauth/                              # External integration OAuth (M10 Phases B/C/D)
│   │   ├── google.ts                       # Google OAuth: exchangeCode, refresh, disconnect, getConnection
│   │   ├── microsoft.ts                    # Microsoft OAuth: exchangeCode, refresh, disconnect, getConnection
│   │   ├── notion.ts                       # Notion OAuth: exchangeCode, disconnect, getConnection (HTTP Basic Auth)
│   │   ├── slack.ts                        # Slack OAuth: exchangeCode, refresh, disconnect, getConnection
│   │   └── cloze.ts                        # Cloze: storeApiKey, disconnect, getConnection
│   ├── scheduledJobs/                      # Scheduled jobs backend (M13, multi-step pipelines post-M14)
│   │   ├── actions.ts                      # executeScheduledJob — fan-out execution entry point
│   │   ├── actions_execution.ts            # Core execution logic — per-step generation runner (post-M14)
│   │   ├── actions_execution_policy.ts     # Execution policy — retry/skip/abort strategies (post-M14)
│   │   ├── actions_handlers.ts             # Handler dispatch — routes steps to execution (post-M14)
│   │   ├── actions_lifecycle.ts            # Lifecycle management — start/stop/reschedule (post-M14)
│   │   ├── actions_types.ts                # ResolvedParticipant interface + shared types (post-M14)
│   │   ├── shared.ts                       # ScheduledJobStepConfig, getScheduledJobSteps() backward-compat shim (post-M14)
│   │   ├── mutations.ts                    # create, update, delete, upsertApiKey — expanded for multi-step CRUD
│   │   ├── queries.ts                      # listScheduledJobs, get, listRuns
│   │   └── recurrence.ts                   # Cron parser — standard cron + OR semantics, 366-day horizon
│   ├── push/                               # Provider-based push backend (`apns` + `fcm`) (M13.5/M16)
│   │   ├── actions.ts                      # sendPushNotification — provider routing (APNs JWT + FCM server-key send)
│   │   ├── mutations.ts                    # registerDeviceToken, removeDeviceToken (public)
│   │   ├── mutations_internal.ts           # deleteStaleToken (internal, for 410 Gone cleanup)
│   │   └── queries.ts                      # getDeviceTokens (internal query)
│   ├── memory/                             # Memory system (M11, overhauled post-M14, prewarmed caches post-2026-04-21)
│   │   ├── operations.ts                   # extract, search, consolidate, vector embeddings
│   │   ├── operations_args.ts              # Memory operation argument validators (post-M14)
│   │   ├── operations_import_handlers.ts   # Document import → memory extraction pipeline (post-M14)
│   │   ├── operations_internal_handlers.ts # Internal memory operation handlers (post-M14)
│   │   ├── operations_public_handlers.ts   # Public memory operation handlers (post-M14)
│   │   ├── embedding_helpers.ts            # Vector embedding utilities (post-M14)
│   │   ├── query_embedding_handlers.ts     # Lease-based per-message query embedding cache handlers
│   │   ├── memory_context_handlers.ts      # Lease-based hydrated memory-context cache handlers
│   │   └── shared.ts                       # Rich memory type definitions — 10 categories, retrieval modes, scope types, source types (post-M14)
│   ├── personas/
│   │   ├── mutations.ts                    # create, update, delete
│   │   └── queries.ts                      # list, get
│   ├── folders/
│   │   ├── mutations.ts                    # create, update, delete, reorder
│   │   └── queries.ts                      # list
│   ├── favorites/
│   │   ├── mutations.ts                    # createFavorite, updateFavorite, deleteFavorite, reorderFavorites
│   │   └── queries.ts                      # listFavorites
│   ├── participants/
│   │   ├── mutations.ts                    # add, remove, update, reorder
│   │   └── queries.ts                      # listForChat
│   ├── preferences/
│   │   ├── entitlements.ts                 # Shared entitlement lookup helpers + legacy fallback bridge
│   │   ├── mutations.ts                    # upsertPreferences, model settings, StoreKit/Play entitlement sync
│   │   └── queries.ts                      # getPreferences, getProStatus, get/list model settings, internal checkProStatus
│   ├── nodePositions/
│   │   ├── mutations.ts                    # upsert, delete
│   │   └── queries.ts                      # listForChat
│   ├── models/
│   │   ├── sync.ts                         # OpenRouter catalog sync + public query re-exports
│   │   ├── queries.ts                      # listModels, listModelSummaries, getModel
│   │   ├── artificial_analysis_sync.ts     # Fetch Artificial Analysis LLM + image benchmark datasets
│   │   ├── artificial_analysis_apply.ts    # Match AA data onto cachedModels, compute ranks/labels
│   │   ├── openrouter_usecase_sync.ts      # Fetch/store OpenRouter weekly category ranks
│   │   ├── guidance_matching.ts            # 5-phase family matcher (OpenRouter ↔ AA)
│   │   ├── guidance_manual_overrides.ts    # Minimal override map for irreducible naming mismatches
│   │   ├── guidance_scoring.ts             # Metric normalization + derived picker scores
│   │   ├── guidance_scoring_labels.ts      # Rank computation + semantic label keys
│   │   └── guidance_scoring_wizard.ts      # Wizard-specific blended recommendation scoring
│   ├── search/
│   │   ├── actions_web_search.ts           # Web search orchestration
│   │   ├── actions_web_search_synthesis.ts # Search synthesis stream producer
│   │   ├── actions_regenerate_paper.ts     # Paper regeneration — with tool support (M10)
│   │   ├── workflow.ts                     # Research paper workflow orchestrator
│   │   ├── workflow_paper_phase.ts         # Paper phase — with tool support (M10)
│   │   └── helpers.ts                      # Complexity presets, cost estimation
│   ├── skills/                             # AI Skills system (M18)
│   │   ├── actions.ts                      # Seed system catalog action
│   │   ├── catalog/
│   │   │   ├── index.ts                    # Barrel export of SYSTEM_SKILL_CATALOG
│   │   │   ├── create_skill.ts             # Create-skill hidden system skill
│   │   │   ├── doc_coauthoring.ts
│   │   │   ├── docx.ts
│   │   │   ├── internal_comms.ts
│   │   │   ├── nanthai_mobile_runtime.ts   # Runtime capability guard
│   │   │   ├── pptx.ts
│   │   │   └── xlsx.ts
│   │   ├── helpers.ts                      # buildSkillCatalogFromDocs, formatSkillCatalogXml
│   │   ├── mutations.ts                    # CRUD + persona/chat assignment (returns { skillId, validationWarnings })
│   │   ├── mutations_seed.ts               # Upsert logic for catalog seeding
│   │   ├── queries.ts                      # listSkills, getSkill
│   │   ├── tool_profiles.ts                # inferToolProfiles, pruneOrphanedIntegrationProfiles
│   │   └── validators.ts                   # validateSkillInstructions, slugify
│   ├── jobs/
│   │   └── cleanup.ts                      # Stale generation job cleanup + orphaned continuation reaping
│   ├── lib/
│   │   ├── openrouter.ts                   # Barrel exports for OpenRouter modules
│   │   ├── openrouter_types.ts             # Core types — including tool types (M10)
│   │   ├── openrouter_request.ts           # Request builder — tools/tool_choice params (M10)
│   │   ├── openrouter_stream.ts            # Stream orchestration
│   │   ├── openrouter_nonstream.ts         # Non-streaming API calls
│   │   ├── openrouter_sse.ts               # SSE connection handler
│   │   ├── openrouter_sse_types.ts         # SSE types — tool_calls delta fields (M10)
│   │   ├── openrouter_sse_event.ts         # SSE event processing — tool-call extraction (M10)
│   │   ├── openrouter_sse_apply.ts         # Delta merging — index-based tool-call accumulation (M10)
│   │   ├── openrouter_sse_stream_handlers.ts # Stream handlers — tool-call accumulator (M10)
│   │   ├── openrouter_constants.ts         # API constants
│   │   ├── openrouter_error.ts             # Error handling
│   │   ├── openrouter_extract.ts           # Response extraction
│   │   ├── openrouter_gate.ts              # Per-model parameter gating
│   │   ├── openrouter_param_retry.ts       # Parameter retry logic
│   │   ├── model_constants.ts              # Model constant definitions
│   │   ├── compaction_constants.ts         # Context compaction thresholds (M13)
│   │   ├── tool_capability.ts              # assertToolCapableModelIds(), assertParticipantsSupportIntegrations() (post-M14)
│   │   └── auth.ts                         # Auth helper (getUserId from ctx) + requirePro (M13/M14)
│   └── _generated/                         # Auto-generated Convex types
│       ├── api.d.ts
│       ├── dataModel.d.ts
│       └── server.d.ts
│
├── android/                                # Native Android app scaffold + parity routes (M16 Phases B–D)
│   ├── build.gradle.kts                    # Root Android build plugins
│   ├── settings.gradle.kts                 # Module include + repositories
│   ├── gradle.properties                   # Android/Kotlin build settings
│   └── app/
│       ├── build.gradle.kts                # Compose app module config
│       └── src/main/
│           ├── AndroidManifest.xml         # Android app manifest + launcher activity
│           ├── java/com/nanthai/edge/
│           │   ├── NanthAiApplication.kt   # Application container bootstrap
│           │   ├── MainActivity.kt         # Compose host activity
│           │   ├── app/                    # App container, root VM, Navigation Compose host
│           │   │   └── navigation/         # AppDestination.kt, AppNavHost.kt, AdaptiveChatPane.kt (M25), SettingsNavHost.kt (M25)
│           │   ├── data/                   # Auth/Convex bridge interfaces + repositories + fake gateway state
│           │   │   ├── SkillsRepository.kt # Skills repository wrapping ConvexGateway skill methods (M18.1)
│           │   │   └── ConvexErrorExtractor.kt # Cross-platform ConvexError message extraction utility
│           │   ├── domain/                 # Reserved for light orchestration (empty scaffold)
│           │   ├── features/               # Auth/chat/settings + advanced parity feature routes
│           │   │   ├── chat/               # Chat list, detail, favorites strip
│           │   │   │   ├── FavoritesStrip.kt  # Horizontal scrollable favorites strip (Compose)
│           │   │   │   ├── LyriaAudioPlayer.kt # Inline Lyria music audio player — play/pause, seek, speed, download (M26)
│           │   │   │   ├── ChatSkillsDialog.kt # Per-chat skill picker dialog (M18.1)
│           │   │   │   └── (ChatDetailComposerComponents, ChatDetailDialogs, ChatDetailRoute, ChatDetailViewModel updated for skills)
│           │   │   ├── favorites/           # Manage favorites feature
│           │   │   │   ├── ManageFavoritesViewModel.kt  # Favorites CRUD + reorder VM
│           │   │   │   └── ManageFavoritesRoute.kt      # Favorites management screen (Compose)
│           │   │   └── skills/              # AI Skills feature (M18.1)
│           │   │       ├── SkillsListViewModel.kt  # Skills list + CRUD + filtering VM
│           │   │       ├── SkillsListRoute.kt      # Full-screen skills list (system/user sections, inline editor)
│           │   │       └── SkillDetailRoute.kt     # Full-screen skill detail (metadata chips, instructions card)
│           │   └── ui/
│           │       ├── shared/             # Shared picker/help/info components incl. model guidance surfaces
│           │       │   ├── SelectionDialogs.kt       # Full-screen participant + model pickers
│           │       │   ├── ModelPickerSort.kt        # Picker sorting/filtering rules incl. guidance sorts
│           │       │   ├── GuidanceComponents.kt     # Guidance labels, trend hints, attribution
│           │       │   ├── ModelChoiceWizardDialog.kt # "Help me choose" 3-step wizard
│           │       │   └── ModelInfoSheet.kt         # Bottom-sheet model details with benchmark/trend sections
│           │       └── theme/              # Compose theme primitives
│           └── res/                        # Minimal resources + launcher vector
│
├── NanthAi-Edge/
│   ├── NanthAi-Edge/
│   │   ├── App/
│   │   │   ├── NanthAi_EdgeApp.swift       # @main, Clerk + Convex setup, @UIApplicationDelegateAdaptor (M13.5)
│   │   │   ├── AppDelegate.swift           # UIApplicationDelegate — APNs token registration (M13.5)
│   │   │   ├── AppDependencies.swift        # DI container: AppState, AuthService, ConvexService, NotificationService
│   │   │   ├── AppState.swift               # Global observable state (auth, connectivity, isUIReady, pendingDeepLinkChatID)
│   │   │   ├── AppIntentsMarker.swift       # App Intents conformance marker
│   │   │   └── UITestMacOverlayHarnessView.swift # iPad-for-Mac UI test harness overlay
│   │   │
│   │   ├── Models/
│   │   │   ├── AutonomousSettings.swift     # Autonomous chat configuration
│   │   │   ├── MessageGroup.swift           # Display grouping enum (.single / .multi)
│   │   │   └── DTOs/
│   │   │       ├── ConvexTypes.swift         # Core Convex DTOs (ConvexChat, ConvexMessage, etc.)
│   │   │       ├── ConvexTypes+Subagents.swift # Subagent batch/run DTOs
│   │   │       ├── ConvexTypes+Preferences.swift # Preferences + model settings DTOs
│   │   │       ├── ConvexTypes+PersonasMemory.swift # Persona + memory DTOs
│   │   │       ├── ConvexTypes+ModelsFolders.swift # Model + folder DTOs, ConvexModelSummary (M9.5)
│   │   │       ├── ConvexTypes+OAuth.swift    # OAuth connection DTOs (M10 Phase B/C)
│   │   │       ├── ConvexTypes+ScheduledJobs.swift # Scheduled job + job run DTOs (M13)
│   │   │       ├── ConvexTypes+Jobs.swift     # Job runner/worker DTOs
│   │   │       ├── ConvexTypes+Search.swift   # Search session / parameters DTOs
│   │   │       ├── ConvexTypes+Skills.swift   # Skill DTOs: ConvexSkill, SkillRequirementState (M18)
│   │   │       ├── OpenRouterTypes.swift     # OpenRouterModel for model picker display
│   │   │       ├── OpenRouterMetadataTypes.swift # Credits response type
│   │   │       ├── Attachment.swift          # File attachment types (+ storageId, .document case M10)
│   │   │
│   │   ├── Services/
│   │   │   ├── ConvexService.swift           # ConvexMobile client wrapper (subscriptions, mutations, actions, one-shot queries)
│   │   │   ├── SharedAppDataStore.swift      # Centralized global subscriptions (M9.5)
│   │   │   ├── PreferenceWriteBuffer.swift   # Debounced preference write batching (M9.5)
│   │   │   ├── NotificationService.swift     # APNs push — token sync, foreground display, deep-link routing (M13.5)
│   │   │   ├── ClerkConvexAuthProvider.swift # Clerk JWT → ConvexMobile auth bridge
│   │   │   ├── ClerkAuthService.swift        # Clerk identity auth
│   │   │   ├── AuthService.swift             # OpenRouter PKCE key exchange
│   │   │   ├── AuthServiceProtocol.swift     # Auth service protocol
│   │   │   ├── AuthProtocols.swift           # Auth protocol definitions
│   │   │   ├── AuthError.swift               # Auth-specific error types
│   │   │   ├── ASWebAuthenticationSessionLauncher.swift # Platform auth session
│   │   │   ├── KeychainService.swift         # Keychain read/write for API key
│   │   │   ├── OpenRouterKeyExchanger.swift  # PKCE code-for-key exchange
│   │   │   └── OpenRouterServiceTypes.swift  # ChatRequestParameters only
│   │   │
│   │   ├── ViewModels/
│   │   │   ├── ChatListViewModel.swift       # Chat list + folder management
│   │   │   ├── ChatListViewModel+Folders.swift # Folder operations
│   │   │   ├── ChatViewModel.swift           # Active chat, message sending, Convex subscriptions
│   │   │   ├── ChatViewModel+Actions.swift   # Message actions (retry, fork, delete)
│   │   │   ├── ChatViewModel+Attachments.swift # File/image attachment handling
│   │   │   ├── ChatViewModel+Autonomous.swift # Autonomous group chat orchestration
│   │   │   ├── ChatViewModel+AutonomousSession.swift # Autonomous session state
│   │   │   ├── ChatViewModel+Branching.swift  # Active-path resolution, sibling detection, two-tier cache (M9.5)
│   │   │   ├── ChatViewModel+Display.swift    # Display helpers, typing indicator, grouped messages
│   │   │   ├── ChatViewModel+Ideascape.swift  # Ideascape-specific state management
│   │   │   ├── ChatViewModel+IdeascapeContext.swift # Extracted ideascape context resolution (post-M14)
│   │   │   ├── ChatViewModel+IdeascapeHelpers.swift # Ideascape layout helpers
│   │   │   ├── ChatViewModel+IdeascapeViewport.swift # Ideascape viewport state
│   │   │   ├── ChatViewModel+Mentions.swift   # Mentions autocomplete state
│   │   │   ├── ChatViewModel+Participants.swift # Participant management
│   │   │   ├── ChatViewModel+Preferences.swift # Parameter cascade (persona → model → global)
│   │   │   ├── ChatViewModel+QueuedFollowUps.swift # Follow-up message queue
│   │   │   ├── ChatViewModel+Sending.swift    # Message sending logic
│   │   │   ├── ChatViewModel+Subagents.swift  # Per-chat subagent override + effective gating
│   │   │   ├── ChatViewModel+Subscriptions.swift # Convex subscriptions, message merging, pagination (M9.5)
│   │   │   ├── ChatViewModel+Types.swift      # Shared types (SubscriptionTasks, etc.)
│   │   │   ├── StreamingRenderEngine.swift    # Content interpolation for smooth streaming display
│   │   │   ├── MemoryViewModel.swift          # Memory list + management
│   │   │   ├── ModelPickerViewModel.swift     # Model selection + search
│   │   │   ├── SettingsViewModel.swift        # User preferences, auth state, credits
│   │   │   ├── SettingsViewModel+Preferences.swift # Preference loading + saving via buffer (M9.5)
│   │   │   ├── SettingsViewModel+Account.swift # Account + credits management
│   │   │   ├── GoogleConnectionViewModel.swift # Google OAuth connect/disconnect (M10 Phase B)
│   │   │   ├── MicrosoftConnectionViewModel.swift # Microsoft OAuth connect/disconnect (M10 Phase C)
│   │   │   ├── NotionConnectionViewModel.swift # Notion OAuth connect/disconnect (M10 Phase D)
│   │   │   ├── SlackConnectionViewModel.swift # Slack OAuth connect/disconnect
│   │   │   ├── ClozeConnectionViewModel.swift # Cloze API key connect/disconnect
│   │   │   ├── KnowledgeBaseViewModel.swift # Knowledge Base file browser VM (M10 Phase KB)
│   │   │   ├── ScheduledJobsViewModel.swift # Scheduled jobs CRUD + run history (M13)
│   │   │   └── SkillsViewModel.swift       # Skills list + CRUD + filtering (M18)
│   │   │
│   │   ├── Views/
│   │   │   ├── Root/
│   │   │   │   ├── RootView.swift            # NavigationSplitView / NavigationStack
│   │   │   │   ├── OnboardingView.swift      # First-launch Clerk sign-in
│   │   │   │   └── OpenRouterConnectionView.swift # OpenRouter API key setup
│   │   │   │
│   │   │   ├── Chat/
│   │   │   │   ├── ChatView.swift            # iMessage-style conversation view — Office file picker (M10)
│   │   │   │   ├── ChatView+Content.swift    # Message list content
│   │   │   │   ├── ChatView+Header.swift     # Chat header bar
│   │   │   │   ├── ChatView+MessageList.swift # Message list rendering (+ "Load older" button, M9.5)
│   │   │   │   ├── ChatView+Attachments.swift # Attachment preview — Office UTType detection (M10)
│   │   │   │   ├── ChatView+SearchPanel.swift # Search panel presentation
│   │   │   │   ├── ChatView+Timestamps.swift  # Day separators + relative timestamp headers (post-M14)
│   │   │   │   ├── MessageBubble.swift       # Chat bubble (user/AI aligned)
│   │   │   │   ├── MessageBubble+Attachments.swift # Attachment rendering — doc.richtext icon (M10)
│   │   │   │   ├── MessageBubble+Sharing.swift # Share sheet integration
│   │   │   │   ├── MessageBubble+ToolCalls.swift # Tool call accordion + generated file cards (M10 Phase E)
│   │   │   │   ├── ToolCallAccordionView.swift # Collapsible tool-call disclosure group (M10)
│   │   │   │   ├── GeneratedFileCardView.swift # File card with download/share (M10)
│   │   │   │   ├── MessageInput.swift        # Text field + send + @-mention + integration toggles (M10)
│   │   │   │   ├── ChatSubagentsSheet.swift  # Per-chat subagent override sheet
│   │   │   │   ├── SubagentBatchPanel.swift  # Inline child-run panel in parent assistant bubble
│   │   │   │   ├── MessageActionBar.swift     # Inline action bar replacing context menus (post-M14)
│   │   │   │   ├── AudioPlayerView.swift      # Inline music audio player — play/pause, seek, speed, download (M26)
│   │   │   │   ├── MessageContextMenu.swift  # Long-press actions (retained for fallback)
│   │   │   │   ├── MultiModelResponseView.swift # Side-by-side model responses
│   │   │   │   ├── MentionAutocompleteView.swift # @-mention autocomplete
│   │   │   │   ├── TypingIndicator.swift     # Animated typing dots
│   │   │   │   ├── ReasoningView.swift       # Collapsible reasoning display
│   │   │   │   ├── ChatParametersView.swift  # Per-chat parameter adjustments
│   │   │   │   ├── ModelDetailSheet.swift    # Model info detail
│   │   │   │   ├── ModelDetailSheet+Persistence.swift
│   │   │   │   ├── StagedAttachmentStrip.swift # Pre-send attachment strip — doc.richtext icon (M10)
│   │   │   │   ├── CameraView.swift          # Camera capture
│   │   │   │   ├── ImageGeneratingPlaceholder.swift
│   │   │   │   ├── BranchIndicatorView.swift  # Branch sibling pill
│   │   │   │   ├── AutonomousSettingsSheet.swift # Autonomous chat config
│   │   │   │   ├── AutonomousToolbar.swift   # Autonomous chat controls
│   │   │   │   ├── SearchPanelView.swift     # 3-tab search panel: Basic / Web / Research Paper (M9, M13.5)
│   │   │   │   ├── ChatSkillsPickerSheet.swift # Per-chat skill picker — add/remove/disable skills (M18)
│   │   │   │   └── PendingFollowUpQueueView.swift # Follow-up queue card + interrupt-on-send (M13.5)
│   │   │   │
│   │   │   ├── Ideascape/
│   │   │   │   ├── IdeascapeCanvasView.swift  # Zoomable/pannable canvas
│   │   │   │   ├── IdeascapeCanvasView+Gestures.swift # Canvas gesture handlers
│   │   │   │   ├── IdeascapeNodeView.swift   # Single node (wraps message)
│   │   │   │   ├── IdeascapeContextBreakdownView.swift # Context token breakdown per selected node (post-M14)
│   │   │   │   ├── IdeascapeContextSummaryView.swift   # Compact context summary bar (post-M14)
│   │   │   │   ├── IdeascapeHelpDeckView.swift # In-canvas help deck with gesture/feature guide (post-M14)
│   │   │   │   ├── ConnectorView.swift       # Orthogonal line connectors
│   │   │   │   └── IdeascapeToolbar.swift    # Canvas controls
│   │   │   │
│   │   │   ├── ChatList/
│   │   │   │   ├── ChatListView.swift        # iMessage-style list
│   │   │   │   ├── ChatListView+Rows.swift   # Chat row rendering
│   │   │   │   ├── ChatListView+Toolbar.swift # List toolbar
│   │   │   │   ├── FavoritesStripView.swift   # Horizontal scrollable favorites strip
│   │   │   │   └── FolderManagerView.swift   # Folder management sheet
│   │   │   ├── Shared/
│   │   │   │   ├── UnifiedModelPickerView.swift          # Model-only picker shell
│   │   │   │   ├── UnifiedModelPickerView+Controls.swift # Search, sort, help controls
│   │   │   │   ├── UnifiedParticipantPickerView*.swift   # Unified model/persona picker split by concern
│   │   │   │   ├── UnifiedModelRow.swift                 # Shared model row with guidance badges
│   │   │   │   ├── ModelCatalogQuery.swift               # Search/filter/sort rules incl. guidance sorts
│   │   │   │   ├── ModelChoiceWizardView*.swift          # "Help me choose" wizard
│   │   │   │   ├── GuidanceComponents.swift              # Guidance tags, trend badges, attribution
│   │   │   │   ├── ModelInfoSheet.swift                  # Benchmark/trend-aware model detail sheet
│   │   │   │   ├── PickerPersistence.swift               # Persisted picker sort/filter preferences
│   │   │   │   └── PickerSharedComponents.swift          # Shared picker subviews/helpers
│   │   │   │
│   │   │   ├── Persona/
│   │   │   │   ├── PersonaListView.swift
│   │   │   │   ├── PersonaEditorView.swift
│   │   │   │   ├── PersonaEditorView+Logic.swift
│   │   │   │   ├── PersonaDetailView.swift
│   │   │   │   ├── PersonaDetailView+Sections.swift
│   │   │   │   ├── PersonaIdentitySection.swift
│   │   │   │   ├── PersonaModelSection.swift
│   │   │   │   ├── PersonaEditorParameterOverridesSection.swift
│   │   │   │   ├── PersonaIntegrationsSection.swift  # Per-persona integration toggles (M10)
│   │   │   │   ├── PersonaAvatarPicker.swift
│   │   │   │   ├── PersonaAvatarView.swift
│   │   │   │   ├── PersonaAvatarSection.swift
│   │   │   │   ├── PersonaAvatarEmojiPickerContent.swift
│   │   │   │   ├── PersonaAvatarSymbolPickerContent.swift
│   │   │   │   ├── AvatarPickerData.swift
│   │   │   │   └── PersonaSkillsSection.swift   # Per-persona skills assignment section (M18)
│   │   │   │
│   │   │   ├── Settings/
│   │   │   │   ├── SettingsView.swift
│   │   │   │   ├── SettingsAccountSection.swift
│   │   │   │   ├── SettingsPersonasAndAppearanceSections.swift
│   │   │   │   ├── SettingsRequestParametersSection.swift
│   │   │   │   ├── SettingsProvidersSection.swift     # Provider connection section (post-M14)
│   │   │   │   ├── SettingsChatDefaultsSection.swift # Consolidated chat defaults (M13.5)
│   │   │   │   ├── ChatDefaultsView.swift         # Chat defaults detail page (M13.5)
│   │   │   │   ├── SettingsIntegrationsView.swift    # External integrations settings (M10 Phase B/C)
│   │   │   │   ├── SettingsConnectedAccountsSection.swift # Google/Microsoft/Notion/Slack/Cloze connection UI (M10)
│   │   │   ├── SettingsConnectedAccountsSection+Slack.swift # Slack connection section
│   │   │   ├── SettingsConnectedAccountsSection+Cloze.swift # Cloze connection section
│   │   │   ├── ClozeConnectSheet.swift     # Cloze API key entry sheet
│   │   │   │   ├── ScheduledJobsListView.swift # Scheduled jobs list (M13)
│   │   │   │   ├── ScheduledJobEditorView.swift # Job create/edit form (M13, refactored post-M14)
│   │   │   │   ├── ScheduledJobEditorView+Logic.swift # Editor validation + save logic (M13)
│   │   │   │   ├── ScheduledJobEditorView+Persistence.swift # Multi-step draft persistence (post-M14)
│   │   │   │   ├── ScheduledJobEditorView+Sections.swift    # Editor form sections (post-M14)
│   │   │   │   ├── ScheduledJobDraftStep.swift  # Draft step model for multi-step editor (post-M14)
│   │   │   │   ├── ScheduledJobDetailView.swift # Job detail + run history (M13)
│   │   │   │   ├── RecurrencePickerView.swift  # Cron expression builder UI (M13)
│   │   │   │   ├── ManageFavoritesView.swift   # Favorites list with reorder/delete
│   │   │   │   ├── FavoriteEditorView.swift     # Create/edit favorite (unified participant picker)
│   │   │   │   ├── KnowledgeBaseView.swift   # Knowledge Base file browser (M10 Phase KB)
│   │   │   │   ├── KBFileRowView.swift        # KB individual file row component (M10 Phase KB)
│   │   │   │   ├── MemoryListView.swift      # Memory browsing
│   │   │   │   ├── MemoryDetailView.swift    # Memory detail/edit
│   │   │   │   ├── MemoryEditorComponents.swift # Reusable memory editor form components (post-M14)
│   │   │   │   ├── MemorySettingsView.swift  # Memory config
│   │   │   │   ├── PendingMemoriesView.swift # Memory approval queue
│   │   │   │   ├── SkillsListView.swift     # Skills settings list — Built-in / Your Skills (M18)
│   │   │   │   ├── SkillDetailView.swift    # Skill detail — read-only for system, "Duplicate" (M18)
│   │   │   │   └── SkillEditorView.swift    # Skill create/edit form with live compat report (M18)
│   │   │   │
│   │   │   └── Shared/
│   │   │       ├── UnifiedModelPickerView.swift # Model selection (refactored post-M14)
│   │   │       ├── UnifiedModelPickerView+Controls.swift # Model picker filter/sort controls (post-M14)
│   │   │       ├── UnifiedParticipantPickerView.swift # Participant selection (refactored post-M14)
│   │   │       ├── UnifiedParticipantPickerView+Content.swift
│   │   │       ├── UnifiedParticipantPickerView+Controls.swift       # Participant picker controls (post-M14)
│   │   │       ├── UnifiedParticipantPickerView+SelectedSections.swift # Selected participant sections (post-M14)
│   │   │       ├── UnifiedParticipantPickerView+SelectionRows.swift   # Individual selection row views (post-M14)
│   │   │       ├── PickerSelectionHelpers.swift
│   │   │       ├── PickerSharedComponents.swift
│   │   │       ├── PickerCapabilityHelpSheet.swift # Capability explanation sheet (post-M14)
│   │   │       ├── PickerRecoveryActionsView.swift # Recovery actions for incompatible models (post-M14)
│   │   │       ├── ModelCatalogQuery.swift    # Model catalog query/filter utilities (post-M14)
│   │   │       ├── ModelCapabilityGlossaryView.swift   # Glossary of model capabilities (post-M14)
│   │   │       ├── ModelCompatibilitySummaryView.swift  # Model compatibility summary (post-M14)
│   │   │       ├── CapabilityFilter.swift    # Model capability filtering
│   │   │       ├── ModelInfoSheet.swift      # Model info display
│   │   │       ├── SelectableText.swift       # UITextView-backed text selection with drag handles (post-M14)
│   │   │       ├── MarkdownText.swift        # Markdown renderer (+ messageId param, M9.5)
│   │   │       ├── MarkdownCodeBlock.swift   # Code block rendering
│   │   │       ├── MarkdownInlineText.swift  # Inline markdown
│   │   │       ├── PerformanceOverlay.swift  # Dev-only performance metrics overlay (M9.5)
│   │   │       └── EmptyStateView.swift      # Reusable empty state
│   │   │
│   │   ├── Utilities/
│   │   │   ├── Constants.swift               # API URLs, Convex function names, config
│   │   │   ├── TaskHandle.swift              # Non-@Observable Task wrapper for deinit safety
│   │   │   ├── ReasoningTextFormatter.swift  # Normalizes compacted reasoning markdown for display
│   │   │   ├── PerformanceTracer.swift       # Performance instrumentation service (M9.5)
│   │   │   ├── IdeascapeLayoutEngine.swift   # Node auto-layout for canvas
│   │   │   ├── IdeascapeCanvasGeometry.swift  # Canvas geometry calculations — extracted from canvas view (post-M14)
│   │   │   ├── IdeascapeContextResolver.swift # Unified ideascape context resolution logic (post-M14)
│   │   │   ├── IdeascapeNodePositionSync.swift # Node position sync utilities (post-M14)
│   │   │   ├── ModelToolRequirement.swift     # Model tool capability requirement checks (post-M14)
│   │   │   ├── ChatTimestampFormatter.swift   # Relative timestamp + day separator formatting (post-M14)
│   │   │   ├── DocumentImportTextExtractor.swift # Document text extraction for memory import (post-M14)
│   │   │   ├── PKCEGenerator.swift           # PKCE verifier + challenge generation
│   │   │   ├── HapticEngine.swift            # Structured haptic feedback
│   │   │   ├── Theme.swift                   # App theme constants
│   │   │   ├── ConvexNull.swift              # Convex null/undefined interop helper
│   │   │   ├── ConvexErrorExtractor.swift   # Cross-platform ConvexError message extraction utility
│   │   │   ├── RuntimePlatform.swift         # iPad-for-Mac / device class detection
│   │   │   ├── StartupLoadFailure.swift      # Startup load failure enum
│   │   │   ├── AsyncTimeout.swift            # Async timeout utility
│   │   │   ├── AppIconResolver.swift         # Dynamic app icon resolution
│   │   │   └── Markdown/
│   │   │       ├── MarkdownParser.swift      # Markdown-to-node parser
│   │   │       ├── MarkdownParser+Inline.swift # Inline element parsing
│   │   │       ├── MarkdownParseCache.swift  # Parse cache keyed by messageId+contentHash (M9.5)
│   │   │       └── MarkdownNode.swift        # AST node types
│   │   │
│   │   ├── Resources/
│   │   │   ├── Assets.xcassets/
│   │   │   ├── PrivacyInfo.xcprivacy
│   │   │   └── Info.plist                  # UIBackgroundModes: remote-notification (M13.5)
│   │   │
│   │   └── NanthAi_Edge.entitlements       # aps-environment: development (M13.5)
│   │
│   ├── NanthAi-EdgeTests/
│   │   ├── NanthAi_EdgeTests.swift
│   │   ├── Services/
│   │   │   ├── AuthServiceTests.swift
│   │   │   ├── ClerkAuthServiceTests.swift
│   │   │   └── PKCEGeneratorTests.swift
│   │   ├── Utilities/
│   │   │   ├── MarkdownParserTests.swift
│   │   │   ├── IdeascapeCanvasGeometryTests.swift   # Canvas geometry unit tests (post-M14)
│   │   │   ├── IdeascapeContextResolverTests.swift  # Context resolver unit tests (post-M14)
│   │   │   ├── IdeascapeNodePositionSyncTests.swift # Position sync unit tests (post-M14)
│   │   │   └── ChatTimestampFormatterTests.swift    # Timestamp formatter unit tests (post-M14)
│   │   ├── Views/
│   │   │   ├── ModelCatalogQueryTests.swift          # Model catalog query tests (post-M14)
│   │   │   └── ModelToolRequirementTests.swift       # Tool requirement tests (post-M14)
│   │   ├── Models/
│   │   │   ├── ConvexScheduledJobDTOTests.swift # ScheduledJob DTO decode tests (M13)
│   │   │   └── ConvexSkillDTOTests.swift        # Skill DTO decode tests (M18)
│   │   ├── ViewModels/
│   │   │   ├── ChatViewModelSkillOverrideTests.swift  # Per-chat skill override tests (M18)
│   │   │   └── SkillsViewModelFilteringTests.swift    # Skills VM filtering + search tests (M18)
│   │   ├── ChatListPinAndFavoritesTests.swift   # Pin/unpin + favorites strip + CRUD tests (22 tests)
│   │
│   └── NanthAi-EdgeUITests/
│       ├── NanthAi_EdgeUITests.swift
│       └── NanthAi_EdgeUITestsLaunchTests.swift
│
├── convex/tests/                            # Convex backend tests (138 test files, subset listed below)
│   ├── chat_stream_patch_throttle.test.ts   # Stream patch cadence unit tests (M9.5)
│   ├── chat_stream_writer.test.ts           # StreamWriter unit tests
│   ├── chat_title_helpers.test.ts           # Title helper tests
│   ├── chat_helpers_image_context.test.ts   # Image context tests
│   ├── chat_helpers_ideascape_selection_image_context.test.ts # Ideascape image context tests
│   ├── chat_manage_helpers.test.ts          # Chat management helper tests
│   ├── chat_mutation_send_helpers.test.ts   # Send helper tests
│   ├── chat_generation_lifecycle_helpers.test.ts # Generation lifecycle tests
│   ├── chat_participant_reasoning_patch_guard.test.ts # Reasoning patch guard tests
│   ├── chat_actions_extract_memories_handler.test.ts # Memory extraction tests
│   ├── chat_actions_memory_lifecycle.test.ts # Memory lifecycle tests
│   ├── compaction.test.ts                   # Context compaction tests (M13)
│   ├── scheduled_jobs_recurrence.test.ts    # Cron parser + recurrence tests (M13)
│   ├── scheduled_jobs_execution_handler.test.ts    # Multi-step execution handler tests (post-M14)
│   ├── scheduled_jobs_lifecycle_regressions.test.ts # Lifecycle regression tests (post-M14)
│   ├── scheduled_jobs_update_timezone.test.ts      # Timezone update tests (post-M14)
│   ├── scheduled_jobs_actions_execution_policy.test.ts # Execution policy tests (post-M14)
│   ├── tool_capability_gating.test.ts       # Tool capability validation tests (post-M14)
│   ├── search_context_store_usage.test.ts   # Search context store usage tests (post-M14)
│   ├── search_cancel_research_paper.test.ts # Research paper cancellation tests
│   ├── search_regenerate_cancel_checks.test.ts # Regeneration cancel checks
│   ├── search_regeneration_and_send_validation.test.ts # Search validation tests
│   ├── memory_shared.test.ts                # Memory shared type tests (post-M14)
│   ├── autonomous_cycle_context.test.ts     # Autonomous cycle context tests
│   ├── autonomous_mutations.test.ts         # Autonomous mutation tests
│   ├── autonomous_streaming_leaf.test.ts    # Autonomous streaming tests
│   ├── openrouter_rate_limit.test.ts        # Rate limit handling tests
│   ├── pro_gating_persona.test.ts           # Pro gating persona tests
│   └── push_actions_fcm_parsing.test.ts     # FCM response parse regression tests (M16)
│   ├── favorites_and_pin_helpers.test.ts    # Favorites CRUD + isPinOnlyUpdate helper tests (11 tests)
│   ├── skills_catalog_seed.test.ts          # Skill catalog seed idempotency tests (M18)
│   ├── skills_helpers.test.ts               # buildSkillCatalog + formatSkillCatalogXml tests (M18)
│   ├── skills_validators.test.ts            # Skill validation + slugify tests (M18)
│   # Additional files currently in this directory include:
│   # integration_request_gates.test.ts, preferences_entitlements.test.ts,
│   # preferences_purchase_transitions.test.ts, push_mutations.test.ts,
│   # push_payloads.test.ts, subagents_claims.test.ts, subagents_regressions.test.ts,
│   # lyria_audio.test.ts (M26), prompt_caching.test.ts, model_sync_noop_patch.test.ts,
│   # model_filters.test.ts (isFree tests)
│
├── package.json                             # npm deps (convex, just-bash, docx, jszip, zod, etc.) — note: e2b-template/ was deleted in M27
├── package.json                             # npm deps (convex, just-bash, docx, jszip, zod, etc.)
├── plan.md                                  # Architecture hub index
├── AGENTS.md                                # Agent instructions
├── milestones/                              # Milestone specs
└── docs/                                    # Architecture documentation
```

## M19 Additions Not Fully Expanded In The Tree Above

- iOS DTOs:
  - `Models/DTOs/ConvexGeneratedChart.swift`
  - `Models/DTOs/ConvexTypes+Preferences.swift` gained account-capability payloads
- iOS chat rendering:
  - `Views/Chat/GeneratedChartCardsContainer.swift`
  - `Views/Chat/GeneratedChartCardView.swift`
  - `Views/Chat/GeneratedFileCardView.swift` now supports inline image preview fallback for exported charts
- Android data/runtime surfaces:
  - `android/app/src/main/java/com/nanthai/edge/data/CapabilityModels.kt`
  - `android/app/src/main/java/com/nanthai/edge/data/GeneratedArtifactModels.kt`
  - `android/app/src/main/java/com/nanthai/edge/data/GeneratedChartParsing.kt`
- Android chat rendering:
  - `android/app/src/main/java/com/nanthai/edge/features/chat/GeneratedChartComponents.kt`
  - `android/app/src/main/java/com/nanthai/edge/features/chat/GeneratedFileComponents.kt`
  - `android/app/src/main/java/com/nanthai/edge/features/chat/ChatDetailAdvancedMessageComponents.kt` gained runtime tool labels/icons
- Android skill metadata parity:
  - `android/app/src/main/java/com/nanthai/edge/features/skills/SkillMetadataSelection.kt`
  - `android/app/src/main/java/com/nanthai/edge/features/skills/SkillMetadataEditorSection.kt`
- tests:
  - `convex/tests/runtime_service.test.ts`
  - `convex/tests/runtime_analytics_charts.test.ts`
  - `convex/tests/tool_registry_runtime_serialization.test.ts`
  - `NanthAi-EdgeTests/Models/ConvexGeneratedChartTests.swift`
  - `android/app/src/test/java/com/nanthai/edge/data/GeneratedChartParsingTest.kt`
  - `android/app/src/test/java/com/nanthai/edge/features/skills/SkillMetadataSelectionTests.kt`

## M25 Additions Not Fully Expanded In The Tree Above

- Android navigation:
  - `android/app/src/main/java/com/nanthai/edge/app/navigation/AdaptiveChatPane.kt` — `ListDetailPaneScaffold` wrapper (list pane, detail pane, Settings overlay, deep link sync, deleted-chat handling)
  - `android/app/src/main/java/com/nanthai/edge/app/navigation/SettingsNavHost.kt` — Self-contained NavHost for 12 settings sub-routes in tablet detail pane
- Android auth/bootstrap (modified):
  - `android/app/src/main/java/com/nanthai/edge/app/NanthAiRootViewModel.kt` — Added `DeepLinkRequest`, `isConnectingConvex`, auth state machine rewrite
  - `android/app/src/main/java/com/nanthai/edge/app/NanthAiAndroidRoot.kt` — `DeepLinkRequest` threading, `isConnectingConvex` loading guard
  - `android/app/src/main/java/com/nanthai/edge/data/RealClerkAuthBridge.kt` — Background token retry with backoff
  - `android/app/src/main/java/com/nanthai/edge/data/RealConvexGateway.kt` — `connect()` now throws on failure
  - `android/app/src/main/java/com/nanthai/edge/data/AppBootstrapRepository.kt` — `isConvexConnected` in BootstrapSnapshot
- Android chat (modified):
  - `android/app/src/main/java/com/nanthai/edge/features/chat/ChatDetailRoute.kt` — `onChatDeleted` callback + `hasReceivedChat` guard
- tests:
  - `android/app/src/test/java/com/nanthai/edge/features/chat/AdaptiveChatPaneContractTests.kt` — 5 scaffold contract tests

## M24 Phase 6 Additions Not Fully Expanded In The Tree Above

- Convex backend (KB module relocation + Drive ingest):
  - `convex/knowledge_base/queries.ts` — `listKnowledgeBaseFiles`, `getKnowledgeBaseFilesByStorageIds`, `getFileAttachmentInternal`, `getFileAttachmentByStorageInternal`
  - `convex/knowledge_base/mutations.ts` — `addUploadToKnowledgeBase`, `deleteKnowledgeBaseFile`, `insertDriveImport`, `updateDriveAttachmentStorage`
  - `convex/knowledge_base/mutations_args.ts` — Zod arg validators
  - `convex/knowledge_base/actions.ts` — `importDriveFileToKnowledgeBase`, `refreshDriveStorageIfStale`
  - `convex/lib/file_attachments.ts` — single chokepoint: `insertFileAttachment`, `deleteDriveGrantCacheForStorage`
  - `convex/drive_picker/ingest.ts` — shared Drive metadata + bytes fetch (used by both chat-flow picker and KB import)
  - `convex/drive_picker/actions.ts`, `convex/drive_picker/mutations.ts` — chat-side picker entry points
  - `convex/oauth/gmail_manual.ts` — IMAP/SMTP credential path; rows stored in `oauthConnections` (no separate table)
- Convex schema (modified):
  - `convex/schema_tables_core.ts` — `googleDriveFileGrants` (lines ~361-382), `drivePickerBatches` (lines ~572-593); `fileAttachments` extended with `driveFileId?` + `lastRefreshedAt?` + new `by_storage` and `by_user_drive_file` indexes
- Convex tests:
  - `convex/tests/kb_source_parity_contract.test.ts`
  - `convex/tests/shared_queries_contract.test.ts` — Drive refresh routing + per-id error isolation
- iOS (KB Drive import + chat-side KB picker):
  - `NanthAi-Edge/NanthAi-Edge/Views/Settings/KnowledgeBaseView.swift` — KB list with `source` discriminator and Drive Import action
  - `NanthAi-Edge/NanthAi-Edge/Views/Settings/KBDriveImportSheet.swift` — Drive picker bridge for KB Settings flow
  - `NanthAi-Edge/NanthAi-Edge/Views/Settings/KBDocumentPicker.swift` — `UIDocumentPickerViewController` wrapper for native upload path
  - `NanthAi-Edge/NanthAi-Edge/Views/Settings/KBFileRowView.swift` — single row UI shared by upload/Drive/generated sources
  - `NanthAi-Edge/NanthAi-Edge/Views/Chat/KBFilePickerView.swift` — chat composer KB picker (with "Import from Drive" that writes to KB but does NOT auto-attach to the message)
- Android (Drive picker bus + KB Drive import):
  - `android/app/src/main/java/com/nanthai/edge/app/DrivePickerCallbackBus.kt` — app-wide `SharedFlow` singleton (`replay=0`, `extraBufferCapacity=1`) for routing `nanthai-edge://drive-picker?fileIds=...` deeplinks back to whichever surface launched the picker
  - `android/app/src/main/java/com/nanthai/edge/app/DrivePickerOnePick.kt` — shared OnePick browser-deeplink invocation helper
  - `android/app/src/main/java/com/nanthai/edge/features/chat/ChatKBDriveImportDialog.kt` — chat-side composer dialog
  - `android/app/src/main/java/com/nanthai/edge/features/knowledgebase/KBDriveImportDialog.kt` — Settings KB Drive Import dialog
  - `android/app/src/main/java/com/nanthai/edge/data/ConvexGateway.kt` — added KB + Drive picker entry points
  - `android/app/src/main/java/com/nanthai/edge/data/KnowledgeBaseRepository.kt` — KB DTOs + repository, source discriminator, `Double`/`Long` for Convex numbers
  - `android/app/src/main/res/values{,-de,-es,-fr,-it,-ja,-zh-rCN}/strings.xml` — KB + Drive import localized strings

## Files Removed in M8

The following files were deleted as part of the Convex migration:

### SwiftData Models (18 files)
- `Models/Chat.swift`, `Message.swift`, `Folder.swift`, `Persona.swift`
- `Models/ChatParticipant.swift`, `NodePosition.swift`, `CachedModel.swift`
- `Models/ModelSettings.swift`, `UserPreferences.swift`, `SchemaV1.swift`
- Plus memory-related and KB-related SwiftData models

### Removed Services
- `Services/OpenRouterService.swift`, `OpenRouterService+Metadata.swift`
- `Services/ChatService.swift` + 4 extension files
- `Services/StreamCoordinator.swift`, `ModelCacheService.swift`
- `Services/ContextManager.swift`, `PersonaService.swift`

### Removed Utilities & Types
- `Utilities/TokenCounter.swift`, `Utilities/SSEParser.swift`
- `Models/DTOs/StreamEvent.swift`, `OpenRouterStreamTypes.swift`, `OpenRouterResponsesEventTypes.swift`

### Removed Tests
- `NanthAi-EdgeTests/Services/SSEParserTests.swift`
- `NanthAi-EdgeTests/Models/OpenRouterTypesTests.swift`
- Plus tests for removed services (ChatService, ContextManager, ModelCache, etc.)

---

*Last updated: 2026-04-07 — M26 Lyria music generation: AudioPlayerView.swift (iOS), LyriaAudioPlayer.kt (Android), audio_shared.ts Lyria constants + MP3 parser. Prompt caching + model sync test files. M25 Android tablet adaptive.*
