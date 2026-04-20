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
  // server_tool_use
  webSearchRequests: v.optional(v.number()),
});

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
  webSearchEnabled: v.optional(v.boolean()),
  searchMode: v.optional(scheduledJobSearchMode),
  searchComplexity: v.optional(v.number()),
  knowledgeBaseFileIds: v.optional(v.array(v.id("_storage"))),
  includeReasoning: v.optional(v.boolean()),
  reasoningEffort: v.optional(v.string()),
});
