import { v } from "convex/values";

/** Message processing status. */
export const messageStatus = v.union(
  v.literal("pending"),
  v.literal("streaming"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

/** Message role (OpenAI-compatible). */
export const messageRole = v.union(
  v.literal("user"),
  v.literal("assistant"),
  v.literal("system"),
);

export const documentSource = v.union(
  v.literal("upload"),
  v.literal("generated"),
  v.literal("drive"),
);

export const documentStatus = v.union(
  v.literal("ready"),
  v.literal("extracting"),
  v.literal("error"),
);

export const documentVersionSource = v.union(
  v.literal("upload"),
  v.literal("generated"),
  v.literal("drive_import"),
  v.literal("drive_refresh"),
  v.literal("user_upload"),
  v.literal("assistant_edit"),
);

export const documentExtractionStatus = v.union(
  v.literal("pending"),
  v.literal("extracting"),
  v.literal("ready"),
  v.literal("error"),
  v.literal("unsupported"),
);

export const documentSyncState = v.union(
  v.literal("current"),
  v.literal("updated_from_drive"),
  v.literal("external_update_available"),
  v.literal("local_ahead"),
  v.literal("conflict"),
);

export const documentCitation = v.object({
  ref: v.number(),
  documentId: v.id("documents"),
  versionId: v.optional(v.id("documentVersions")),
  filename: v.string(),
  quote: v.string(),
  page: v.optional(v.union(v.number(), v.string())),
  locator: v.optional(v.string()),
});

export const documentEvent = v.object({
  type: v.union(v.literal("document_created"), v.literal("document_updated")),
  documentId: v.id("documents"),
  versionId: v.id("documentVersions"),
  storageId: v.id("_storage"),
  generatedFileId: v.optional(v.id("generatedFiles")),
  filename: v.string(),
  mimeType: v.string(),
  title: v.optional(v.string()),
  summary: v.optional(v.string()),
});

/** Chat mode. */
export const chatMode = v.union(v.literal("chat"), v.literal("ideascape"));

/** Per-chat subagent override. */
export const subagentOverride = v.union(
  v.literal("enabled"),
  v.literal("disabled"),
);

/** Autonomous session status. */
export const autonomousStatus = v.union(
  v.literal("running"),
  v.literal("paused"),
  v.literal("stopped"),
  v.literal("completed_consensus"),
  v.literal("completed_max_cycles"),
  v.literal("stopped_user_intervened"),
  v.literal("failed"),
);

/** Generation job status (full lifecycle). */
export const generationJobStatus = v.union(
  v.literal("queued"),
  v.literal("streaming"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("timedOut"),
);

/** Normalized terminal failure / cancellation classification. */
export const terminalErrorCode = v.union(
  v.literal("stream_timeout"),
  v.literal("provider_error"),
  v.literal("cancelled_by_retry"),
  v.literal("cancelled_by_user"),
  v.literal("unknown_error"),
);

/** Durable per-job continuation lifecycle for multi-action tool loops. */
export const generationContinuationStatus = v.union(
  v.literal("waiting"),
  v.literal("running"),
);

/** Parent subagent batch lifecycle. */
export const subagentBatchStatus = v.union(
  v.literal("running_children"),
  v.literal("waiting_to_resume"),
  v.literal("resuming"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

/**
 * Drive picker batch lifecycle.
 * - `awaiting_pick`: assistant deferred; user picker UI is open.
 * - `resuming`: picker callback fired; ingest + resume action running.
 * - `completed` / `failed` / `cancelled`: terminal.
 */
export const drivePickerBatchStatus = v.union(
  v.literal("awaiting_pick"),
  v.literal("resuming"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

/** Child subagent run lifecycle. */
export const subagentRunStatus = v.union(
  v.literal("queued"),
  v.literal("streaming"),
  v.literal("waiting_continuation"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("timedOut"),
);

/** Token usage stats. */
export const usageObject = v.object({
  promptTokens: v.number(),
  completionTokens: v.number(),
  totalTokens: v.number(),
  cost: v.optional(v.number()),
  isByok: v.optional(v.boolean()),
  // prompt_tokens_details
  cachedTokens: v.optional(v.number()),
  cacheWriteTokens: v.optional(v.number()),
  audioPromptTokens: v.optional(v.number()),
  videoTokens: v.optional(v.number()),
  // completion_tokens_details
  reasoningTokens: v.optional(v.number()),
  imageCompletionTokens: v.optional(v.number()),
  audioCompletionTokens: v.optional(v.number()),
  // cost_details
  upstreamInferenceCost: v.optional(v.number()),
  upstreamInferencePromptCost: v.optional(v.number()),
  upstreamInferenceCompletionsCost: v.optional(v.number()),
  cacheDiscount: v.optional(v.number()),
  // server_tool_use
  webSearchRequests: v.optional(v.number()),
});

export const loadedSkillState = v.object({
  skill: v.string(),
  name: v.optional(v.string()),
  runtimeMode: v.optional(v.string()),
  instructions: v.string(),
  requiredToolProfiles: v.array(v.string()),
  requiredToolIds: v.array(v.string()),
  requiredIntegrationIds: v.array(v.string()),
  requiredCapabilities: v.array(v.string()),
});

export const loadedSkillStates = v.array(loadedSkillState);

/** Search session status (M9 — Internet Search). */
export const searchSessionStatus = v.union(
  v.literal("planning"),
  v.literal("searching"),
  v.literal("analyzing"),
  v.literal("deepening"),
  v.literal("synthesizing"),
  v.literal("writing"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

/** Search phase type (M9 — Internet Search). */
export const searchPhaseType = v.union(
  v.literal("planning"),
  v.literal("initial_search"),
  v.literal("analysis"),
  v.literal("depth_iteration"),
  v.literal("synthesis"),
  v.literal("paper_architecture"),
  v.literal("paper"),
);

/** Search phase status (M9 — Internet Search). */
export const searchPhaseStatus = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("completed"),
  v.literal("failed"),
);

/** Memory type classification. */
export const memoryType = v.union(
  v.literal("profile"),
  v.literal("responsePreference"),
  v.literal("workContext"),
  v.literal("transient"),
);

export const memoryCategory = v.union(
  v.literal("identity"),
  v.literal("writingStyle"),
  v.literal("work"),
  v.literal("goals"),
  v.literal("background"),
  v.literal("relationships"),
  v.literal("preferences"),
  v.literal("tools"),
  v.literal("skills"),
  v.literal("logistics"),
);

export const memoryRetrievalMode = v.union(
  v.literal("alwaysOn"),
  v.literal("contextual"),
  v.literal("disabled"),
);

export const memoryScopeType = v.union(
  v.literal("allPersonas"),
  v.literal("selectedPersonas"),
);

export const memorySourceType = v.union(
  v.literal("chat"),
  v.literal("import"),
  v.literal("manual"),
);

// ── M16: Entitlements ────────────────────────────────────────────────

/** Purchase entitlement platform. */
export const purchasePlatform = v.union(
  v.literal("ios"),
  v.literal("android"),
  v.literal("web"),
);

/** Purchase entitlement source. */
export const purchaseSource = v.union(
  v.literal("app_store"),
  v.literal("play_store"),
  v.literal("stripe"),
  v.literal("manual"),
);

/** Purchase entitlement lifecycle status. */
export const purchaseEntitlementStatus = v.union(
  v.literal("active"),
  v.literal("revoked"),
  v.literal("refunded"),
  v.literal("expired"),
);

/** Internal capability grant name. */
export const userCapability = v.union(
  v.literal("pro"),
  v.literal("mcpRuntime"),
);

/** Internal capability grant source. */
export const userCapabilitySource = v.union(
  v.literal("manual_override"),
  v.literal("future_subscription"),
  v.literal("internal_grant"),
);

/** Internal capability lifecycle. */
export const userCapabilityStatus = v.union(
  v.literal("active"),
  v.literal("revoked"),
);

/** Video generation job lifecycle status. */
export const videoJobStatus = v.union(
  v.literal("pending"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("failed"),
);

/** Generated media type. */
export const generatedMediaType = v.union(
  v.literal("image"),
  v.literal("video"),
);

/** Runtime sandbox lifecycle status. */
export const sandboxSessionStatus = v.union(
  v.literal("pendingCreate"),
  v.literal("running"),
  v.literal("failed"),
  v.literal("deleted"),
);

/** Runtime sandbox environment. */
export const sandboxSessionEnvironment = v.union(
  v.literal("python"),
  v.literal("node"),
);

// ── M13: Scheduled Jobs ──────────────────────────────────────────────


/** Push platform. */
export const pushPlatform = v.union(
  v.literal("ios"),
  v.literal("android"),
  v.literal("web"),
);

/** Push provider. */
export const pushProvider = v.union(
  v.literal("apns"),
  v.literal("fcm"),
  v.literal("webpush"),
);

/** Scheduled job status. */
export const scheduledJobStatus = v.union(
  v.literal("active"),
  v.literal("paused"),
  v.literal("error"),
);

/** Scheduled job recurrence type. */
export const scheduledJobRecurrence = v.union(
  v.object({ type: v.literal("interval"), minutes: v.number() }),
  v.object({
    type: v.literal("daily"),
    hourUTC: v.number(),
    minuteUTC: v.number(),
  }),
  v.object({
    type: v.literal("weekly"),
    dayOfWeek: v.number(),
    hourUTC: v.number(),
    minuteUTC: v.number(),
  }),
  v.object({ type: v.literal("cron"), expression: v.string() }),
  v.object({ type: v.literal("manual") }),
);

/** Job run outcome. */
export const jobRunStatus = v.union(
  v.literal("success"),
  v.literal("failed"),
);

/** Chat source — who initiated the chat. */
export const chatSource = v.union(
  v.literal("user"),
  v.literal("scheduled_job"),
);

/** Message source — distinguishes synthetic scheduled-step prompts from real user input. */
export const messageSource = v.union(
  v.literal("user"),
  v.literal("scheduled_step"),
);

/** Scheduled job search mode. */
export const scheduledJobSearchMode = v.union(
  v.literal("none"),
  v.literal("basic"),
  v.literal("web"),
  v.literal("research"),
);

// ── M18: AI Skills ───────────────────────────────────────────────────

/** Skill compilation status. */
export const skillCompilationStatus = v.union(
  v.literal("pending"),
  v.literal("compiled"),
  v.literal("failed"),
);

/** Skill scope — system (curated) vs user-authored. */
export const skillScope = v.union(
  v.literal("system"),
  v.literal("user"),
);

/** Skill origin — who authored it. */
export const skillOrigin = v.union(
  v.literal("anthropicCurated"),
  v.literal("nanthaiBuiltin"),
  v.literal("userAuthored"),
  v.literal("assistantAuthored"),
);

/** Skill visibility in the catalog UI. */
export const skillVisibility = v.union(
  v.literal("visible"),
  v.literal("hidden"),
  v.literal("integration_managed"),
);

// ── M30: Skill & Integration Override Validators ──────────────────────

/** Tri-state skill resolution: always inject, available in catalog, or never. */
export const skillOverrideState = v.union(
  v.literal("always"),
  v.literal("available"),
  v.literal("never"),
);

/** A single skill override entry (used in userPreferences, personas, chats). */
export const skillOverrideEntry = v.object({
  skillId: v.id("skills"),
  state: skillOverrideState,
});

/** A single integration override entry (used in userPreferences, personas, chats). */
export const integrationOverrideEntry = v.object({
  integrationId: v.string(),
  enabled: v.boolean(),
});

/** Retry contract participant snapshot persisted on assistant messages. */
export const retryParticipantSnapshot = v.object({
  modelId: v.string(),
  personaId: v.optional(v.union(v.id("personas"), v.null())),
  personaName: v.optional(v.union(v.string(), v.null())),
  personaEmoji: v.optional(v.union(v.string(), v.null())),
  personaAvatarImageUrl: v.optional(v.union(v.string(), v.null())),
  systemPrompt: v.optional(v.union(v.string(), v.null())),
  temperature: v.optional(v.number()),
  maxTokens: v.optional(v.number()),
  includeReasoning: v.optional(v.boolean()),
  reasoningEffort: v.optional(v.union(v.string(), v.null())),
});

/** Retry contract search mode persisted on assistant messages. */
export const retrySearchMode = v.union(
  v.literal("none"),
  v.literal("normal"),
  v.literal("web"),
);

/** Retry contract video settings persisted on assistant messages. */
export const retryVideoConfig = v.object({
  resolution: v.optional(v.string()),
  aspectRatio: v.optional(v.string()),
  duration: v.optional(v.number()),
  generateAudio: v.optional(v.boolean()),
});

/** Canonical retry snapshot persisted on assistant messages. */
export const retryContract = v.object({
  participants: v.array(retryParticipantSnapshot),
  searchMode: retrySearchMode,
  searchComplexity: v.optional(v.number()),
  enabledIntegrations: v.optional(v.array(v.string())),
  subagentsEnabled: v.optional(v.boolean()),
  turnSkillOverrides: v.optional(v.array(skillOverrideEntry)),
  turnIntegrationOverrides: v.optional(v.array(integrationOverrideEntry)),
  videoConfig: v.optional(retryVideoConfig),
});

// M38 — Durable tool artifacts and context assembly v2.
export const runtimeVisibilityScope = v.union(
  v.literal("participant"),
  v.literal("shared_participants"),
  v.literal("branch"),
  v.literal("conversation"),
  v.literal("audit_only"),
);

export const runtimeIsolationPolicy = v.union(
  v.literal("isolated"),
  v.literal("shared_readonly"),
  v.literal("shared_mutable"),
  v.literal("audit_only"),
);

export const contextClass = v.union(
  v.literal("conversational"),
  v.literal("operational"),
  v.literal("epistemic"),
  v.literal("provenance"),
  v.literal("policy"),
  v.literal("recovery"),
  v.literal("planning"),
);

export const privacyClassification = v.union(
  v.literal("normal"),
  v.literal("oauth_data"),
  v.literal("google_data"),
  v.literal("document_data"),
  v.literal("runtime_file_data"),
  v.literal("secret_adjacent"),
);

export const toolArtifactStatus = v.union(
  v.literal("pending"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("deferred"),
  v.literal("cancelled"),
);

export const deferredToolKind = v.union(
  v.literal("spawn_subagents"),
  v.literal("drive_picker"),
);

export const toolMemoryBranchScope = v.union(
  v.literal("chat"),
  v.literal("branch"),
  v.literal("message"),
);

export const toolMemoryKind = v.union(
  v.literal("retrieval"),
  v.literal("file_generated"),
  v.literal("document_read"),
  v.literal("workspace_state"),
  v.literal("connected_app_state"),
  v.literal("decision"),
  v.literal("error_summary"),
);

export const promotionPolicy = v.union(
  v.literal("transient"),
  v.literal("candidate"),
  v.literal("durable"),
  v.literal("audit_only"),
);

export const confidenceSource = v.union(
  v.literal("tool"),
  v.literal("model"),
  v.literal("deterministic"),
  v.literal("inferred"),
  v.literal("user_asserted"),
  v.literal("composite"),
);

export const freshnessClass = v.union(
  v.literal("volatile"),
  v.literal("session"),
  v.literal("bounded"),
  v.literal("durable"),
  v.literal("permanent"),
);

export const confidenceDecayCurve = v.union(
  v.literal("none"),
  v.literal("linear"),
  v.literal("step"),
  v.literal("exponential"),
);

export const provenanceResolutionStatus = v.union(
  v.literal("valid"),
  v.literal("missing"),
  v.literal("repaired"),
  v.literal("unavailable"),
  v.literal("forbidden"),
);

export const contextAssemblyMode = v.union(
  v.literal("shadow"),
  v.literal("read_path"),
  v.literal("autonomous_discussion"),
  v.literal("subagent_child"),
  v.literal("subagent_parent_resume"),
);

export const runtimeKind = v.union(
  v.literal("chat_generation"),
  v.literal("autonomous_discussion"),
  v.literal("subagent_child"),
  v.literal("subagent_parent_resume"),
  v.literal("scheduled_job"),
);

export const promotionDecision = v.union(
  v.literal("child_private"),
  v.literal("parent_resume"),
  v.literal("parent_visible"),
  v.literal("audit_only"),
);

export const lineageEdge = v.object({
  edgeType: v.union(
    v.literal("causedBy"),
    v.literal("influencedBy"),
    v.literal("mergedFrom"),
    v.literal("validatedBy"),
  ),
  targetKind: v.union(
    v.literal("toolArtifact"),
    v.literal("toolMemory"),
    v.literal("modelRun"),
    v.literal("branch"),
    v.literal("message"),
    v.literal("documentVersion"),
    v.literal("contextAssembly"),
  ),
  targetId: v.string(),
  weight: v.optional(v.number()),
  rationale: v.optional(v.string()),
});

export const assemblyPriority = v.union(
  v.literal("critical"),
  v.literal("high"),
  v.literal("normal"),
  v.literal("low"),
  v.literal("audit"),
);

export const assemblyCostPolicy = v.object({
  costWeight: v.optional(v.number()),
  compressionBudget: v.optional(v.number()),
  rehydrationCost: v.optional(v.number()),
});

/** Skill lock state — locked (system) vs editable (user). */
export const skillLockState = v.union(
  v.literal("locked"),
  v.literal("editable"),
);

/** Skill lifecycle status. */
export const skillStatus = v.union(
  v.literal("active"),
  v.literal("archived"),
);

/** Skill runtime mode — text-only or tool-augmented. */
export const skillRuntimeMode = v.union(
  v.literal("textOnly"),
  v.literal("toolAugmented"),
  v.literal("sandboxAugmented"),
);

/** Skill tool profile — used for progressive tool exposure. */
export const skillToolProfile = v.union(
  v.literal("docs"),
  v.literal("analytics"),
  v.literal("workspace"),
  v.literal("persistentRuntime"),
  v.literal("subagents"),
  v.literal("google"),
  v.literal("microsoft"),
  v.literal("notion"),
  v.literal("appleCalendar"),
  v.literal("cloze"),
  v.literal("slack"),
  v.literal("scheduledJobs"),
  v.literal("skillsManagement"),
  v.literal("personas"),
);

/** Scheduled job step definition. */
export const scheduledJobStep = v.object({
  title: v.optional(v.string()),
  prompt: v.string(),
  modelId: v.string(),
  personaId: v.optional(v.id("personas")),
  enabledIntegrations: v.optional(v.array(v.string())),
  turnSkillOverrides: v.optional(v.array(skillOverrideEntry)),
  turnIntegrationOverrides: v.optional(v.array(integrationOverrideEntry)),
  webSearchEnabled: v.optional(v.boolean()),
  searchMode: v.optional(scheduledJobSearchMode),
  searchComplexity: v.optional(v.number()),
  knowledgeBaseFileIds: v.optional(v.array(v.id("_storage"))),
  includeReasoning: v.optional(v.boolean()),
  reasoningEffort: v.optional(v.string()),
});
