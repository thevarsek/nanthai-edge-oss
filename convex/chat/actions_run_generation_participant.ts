import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  ChatRequestParameters,
  gateParameters,
  OnDelta,
  OnReasoningDelta,
  OpenRouterUsage,
  resolvePerplexityCitations,
} from "../lib/openrouter";
import { ttftLog } from "../lib/generation_log";
import { buildRequestMessages } from "./helpers";
import { promoteLatestUserVideoUrls } from "./helpers_video_url_utils";
import {
  GenerationCancelledError,
  isGenerationCancelledError,
} from "./generation_helpers";
import {
  clampMessageContent,
  dedupeImageCandidates,
  detectStandaloneBase64Image,
  extractInlineImagePayloads,
  persistGeneratedImageUrlsWithTracking,
} from "./action_image_helpers";
import { resolveMemoryContextForGeneration } from "./action_memory_helpers";
import {
  ModelCapabilities,
  ParticipantConfig,
  RunGenerationArgs,
} from "./actions_run_generation_types";
import { appendCurrentTurnAudioInput } from "./audio_input_request";
import { CITATION_SYSTEM_PROMPT_SUFFIX } from "../search/helpers";
import {
  buildNanthAIPrelude,
  buildRuntimeGuard,
  buildSkillCatalogFromResolved,
  formatAlwaysSkillInstructions,
  formatSkillCatalogXml,
  SKILL_DISCOVERY_INSTRUCTION,
} from "../skills/helpers";
import { resolveEffectiveSkills } from "../skills/resolver";
import { StreamWriter } from "./stream_writer";
import { ToolRegistry } from "../tools/registry";
import { hasGoogleIntegrations, isGoogleDataAllowedProvider } from "../models/google_data_providers";
import { RecordedToolCall, RecordedToolResult } from "../tools/execute_loop";
import { runGenerationWithCompaction } from "./actions_run_generation_loop";
import { extractGeneratedCharts, extractGeneratedFiles } from "./generated_file_helpers";
import { GenerationContinuationCheckpoint } from "./generation_continuation_shared";
import {
  availableProgressiveProfiles,
  buildRegistryParams,
  extractProfilesFromConversation,
  extractProfilesFromLoadSkillResults,
} from "../tools/progressive_registry_shared";
import type { SkillToolProfileId } from "../skills/tool_profiles";

export function shouldPersistParticipantReasoning(totalReasoning: string): boolean {
  return totalReasoning.length > 0;
}

export function shouldForceParticipantReasoningPatch(
  delta: string,
  hasSeenContentDelta: boolean,
): boolean {
  if (hasSeenContentDelta) {
    return true;
  }

  return /(?:\n\s*\n|[.!?]["')\]]?\s*$)$/.test(delta);
}

export interface GenerateForParticipantParams {
  ctx: ActionCtx;
  args: RunGenerationArgs;
  participant: ParticipantConfig;
  allMessages: Array<any>;
  memoryContext: string | undefined;
  modelCapabilities: Map<string, ModelCapabilities>;
  /** Optional tool registry. When provided and non-empty, tool definitions
   *  are sent to the model and a tool-call loop executes any requested tools. */
  toolRegistry?: ToolRegistry;
  progressiveTools?: {
    enabledIntegrations: string[];
    allowSubagents: boolean;
    directToolNames?: string[];
  };
  /** Whether the user has a Pro subscription. Used to gate Pro-only tools
   *  in progressive tool registry rebuilds. AUDIT-7: replaces hardcoded `true`. */
  isPro: boolean;
  runtimeProfile: "mobileBasic";
  apiKey: string;
  /** Optional prebuilt OpenRouter request messages for resumed flows. */
  requestMessagesOverride?: Array<any>;
  initialTotalUsage?: OpenRouterUsage | null;
  initialToolCalls?: RecordedToolCall[];
  initialToolResults?: RecordedToolResult[];
  initialCompactionCount?: number;
  /** Timestamp (ms) captured at the very start of the action, before context
   *  preparation. Used by the compaction layer to detect approaching timeout. */
  actionStartTime: number;
  /** Optional active profiles restored from a durable continuation checkpoint. */
  restoredActiveProfiles?: SkillToolProfileId[];
  /** Optional override to disable new tool calls while preserving tool-aware prompts. */
  forceToolChoiceNone?: boolean;
  /** Optional cross-action continuation handoff callback. */
  continuationHandoff?: {
    maxToolRoundsPerInvocation: number;
    onHandoff: (checkpoint: GenerationContinuationCheckpoint) => Promise<void>;
    continuationCount: number;
  };
  streamingMessageId?: Id<"streamingMessages">;
  onProfilesExpanded?: (
    toolCalls: Array<{ function: { name: string } }>,
    results: Array<{ toolCallId: string; result: import("../tools/registry").ToolResult }>,
    activeProfiles: SkillToolProfileId[],
    currentRegistry: ToolRegistry,
    currentParams: ChatRequestParameters,
    caps: ModelCapabilities | undefined,
  ) => Promise<{
    registry?: ToolRegistry;
    params?: ChatRequestParameters;
  } | void>;
  persistInlineAudio?: (
    audioBase64: string,
  ) => Promise<{
    audioStorageId: Id<"_storage">;
    audioDurationMs?: number;
    audioGeneratedAt: number;
  }>;
  /** Pre-resolved overrides from coordinator to eliminate duplicate queries. */
  preResolvedOverrides?: {
    resolved: true;
    chatSkillOverrides?: Array<{ skillId: string; state: string }>;
    personaSkillOverrides?: Array<{ skillId: string; state: string }>;
    skillDefaults?: Array<{ skillId: string; state: string }>;
  };
}

async function resolveSystemPrompt(
  ctx: ActionCtx,
  participant: ParticipantConfig,
  userId: string,
  /**
   * Optional pre-fetched persona doc from the preflight parallel batch.
   * When provided, skips the duplicate `getPersona` query — the preflight
   * already fetched the persona for skill-override resolution and we can
   * reuse it here. Pass `undefined` to fall back to the legacy fetch path.
   */
  prefetchedPersona?: { systemPrompt?: string | null } | null,
): Promise<string | null | undefined> {
  let systemPrompt = participant.systemPrompt;
  if (!systemPrompt && participant.personaId) {
    const persona = prefetchedPersona !== undefined
      ? prefetchedPersona
      : await ctx.runQuery(internal.chat.queries.getPersona, {
          personaId: participant.personaId,
          userId,
        });
    if (persona) {
      systemPrompt = persona.systemPrompt ?? undefined;
    }
  }
  return systemPrompt;
}

export async function generateForParticipant(
  params: GenerateForParticipantParams,
): Promise<{
  deferredForSubagents: boolean;
  cancelled: boolean;
  failed: boolean;
  continued: boolean;
}> {
  const {
    ctx,
    args,
    participant,
    allMessages,
    memoryContext,
    modelCapabilities,
    toolRegistry,
    requestMessagesOverride,
    runtimeProfile,
    progressiveTools,
    isPro,
    apiKey,
    forceToolChoiceNone,
    continuationHandoff,
    streamingMessageId,
    onProfilesExpanded,
    persistInlineAudio,
    preResolvedOverrides,
  } =
    params;

  // Preflight parallelization: issue every independent read (cancel check,
  // user prefs, persona, chat, skills, skill-integration defaults) plus the
  // "streaming" status write in a single Promise.all. Before Phase-3.5 this
  // used to waterfall as:
  //   isJobCancelled → updateJobStatus → resolveSystemPrompt (may fetch persona)
  //   → skill-catalog Promise.all(5) → ... → getUserPreferences
  // which cost ~150–230ms of sequential round-trips. The only data that
  // actually depends on another is the system-prompt building the
  // skill-augmented prompt, which is pure CPU once persona is fetched.
  const preflightStartedAt = Date.now();
  const hasPreResolved = preResolvedOverrides?.resolved === true;
  const needsPersonaForSkills = !hasPreResolved && participant.personaId != null;
  const needsPersonaForSystemPrompt =
    !participant.systemPrompt && participant.personaId != null;
  const shouldFetchPersona = needsPersonaForSkills || needsPersonaForSystemPrompt;
  const shouldBuildSkillCatalog =
    !requestMessagesOverride && toolRegistry && !toolRegistry.isEmpty;
  // modelSupportsTools is read below after caps resolves (synchronous Map lookup).
  const caps = modelCapabilities.get(participant.modelId);
  const modelSupportsTools = caps?.supportedParameters?.includes("tools") ?? false;

  const [
    alreadyCancelled,
    _statusUpdated,
    userPrefs,
    personaDocForPreflight,
    chatDocForPreflight,
    systemSkillsForPreflight,
    userSkillsForPreflight,
    userDefaultsForPreflight,
  ] = await Promise.all([
    ctx.runQuery(internal.chat.queries.isJobCancelled, {
      jobId: participant.jobId,
    }),
    ctx.runMutation(internal.chat.mutations.updateJobStatus, {
      jobId: participant.jobId,
      status: "streaming",
      startedAt: Date.now(),
    }),
    ctx.runQuery(internal.chat.queries.getUserPreferences, {
      userId: args.userId,
    }),
    shouldFetchPersona
      ? ctx.runQuery(internal.chat.queries.getPersona, {
          personaId: participant.personaId!,
          userId: args.userId,
        })
      : Promise.resolve(null),
    // Chat doc is only needed for skill override resolution when not
    // pre-resolved. Skip otherwise.
    shouldBuildSkillCatalog && modelSupportsTools && !hasPreResolved
      ? ctx.runQuery(internal.chat.queries.getChatInternal, {
          chatId: args.chatId,
        })
      : Promise.resolve(null),
    shouldBuildSkillCatalog && modelSupportsTools
      ? ctx.runQuery(internal.skills.queries.listActiveSystemSkills, {})
      : Promise.resolve([] as any[]),
    shouldBuildSkillCatalog && modelSupportsTools
      ? ctx.runQuery(internal.skills.queries.listUserSkillsInternal, {
          userId: args.userId,
        })
      : Promise.resolve([] as any[]),
    shouldBuildSkillCatalog && modelSupportsTools && !hasPreResolved
      ? ctx.runQuery(internal.preferences.queries.getSkillIntegrationDefaults, {
          userId: args.userId,
        })
      : Promise.resolve(null),
  ]);
  ttftLog("[generation] preflight completed", {
    chatId: args.chatId,
    messageId: participant.messageId,
    jobId: participant.jobId,
    modelId: participant.modelId,
    durationMs: Date.now() - preflightStartedAt,
    fetchedPersona: shouldFetchPersona,
    builtSkillCatalog: shouldBuildSkillCatalog && modelSupportsTools,
    hasPreResolved,
  });

  // Pre-start cancellation check: if the job was cancelled (e.g. by the user
  // while the scheduler.runAfter was pending), bail out immediately. We still
  // issued the other preflight queries in parallel — they're cheap reads and
  // the cancel path is rare, so this trades a few wasted queries for ~100ms
  // of TTFT on the common path.
  if (alreadyCancelled) {
    return {
      deferredForSubagents: false,
      cancelled: true,
      failed: false,
      continued: false,
    };
  }

  // Shared tool execution context — workspace sandbox is lazily created on
  // first workspace tool call and persists across all tool calls within this
  // generation run. Cleanup is handled in the finally block.
  const sharedToolCtx: import("../tools/registry").ToolExecutionContext = {
    ctx,
    userId: args.userId,
    chatId: String(args.chatId),
  };

  try {
    const requestAssemblyStartedAt = Date.now();
    const systemPrompt = await resolveSystemPrompt(
      ctx,
      participant,
      args.userId,
      // Reuse the persona we already fetched in preflight. Pass `null` if the
      // preflight decided not to fetch (no persona needed) — `resolveSystemPrompt`
      // will fall through. Pass `undefined` only in the pre-resolved case where
      // we don't have persona data but also don't need a system-prompt fetch,
      // which is handled because participant.systemPrompt is the expected path.
      shouldFetchPersona ? personaDocForPreflight : null,
    );
    ttftLog("[generation] system prompt resolved", {
      chatId: args.chatId,
      messageId: participant.messageId,
      jobId: participant.jobId,
      modelId: participant.modelId,
      durationMs: Date.now() - requestAssemblyStartedAt,
    });

    // M9: Append citation formatting instructions for Normal Search (Path B)
    const effectiveSystemPrompt = args.webSearchEnabled && systemPrompt
      ? systemPrompt + CITATION_SYSTEM_PROMPT_SUFFIX
      : args.webSearchEnabled
        ? CITATION_SYSTEM_PROMPT_SUFFIX.trim()
        : systemPrompt ?? undefined;

    // M18/M30: Build skill catalog using layered resolver and append to system prompt.
    // Progressive disclosure: model sees lightweight catalog XML for `available` skills,
    // calls load_skill on demand. `always` skills get full instructions injected.
    let skillAugmentedPrompt = effectiveSystemPrompt;
    if (shouldBuildSkillCatalog && modelSupportsTools) {
      const skillCatalogStartedAt = Date.now();
      try {
        const systemSkills = systemSkillsForPreflight;
        const userSkills = userSkillsForPreflight;
        const chatAny = chatDocForPreflight as Record<string, unknown> | null;
        const personaAny = personaDocForPreflight as Record<string, unknown> | null;
        const userDefaults = userDefaultsForPreflight;

        // M30: Use unified resolver when new override fields are present,
        // fall back to legacy fields transparently.
        // Use pre-resolved overrides from coordinator when available.
        const resolved = resolveEffectiveSkills({
          allSkills: [...systemSkills, ...userSkills] as any,
          settingsDefaults: (hasPreResolved ? preResolvedOverrides.skillDefaults : userDefaults?.skillDefaults) as any,
          personaOverrides: (hasPreResolved ? preResolvedOverrides.personaSkillOverrides : personaAny?.skillOverrides) as any,
          chatOverrides: (hasPreResolved ? preResolvedOverrides.chatSkillOverrides : chatAny?.skillOverrides) as any,
          turnOverrides: args.turnSkillOverrides as any,
        });

        const { catalog, alwaysSkills } = buildSkillCatalogFromResolved(
          resolved,
          {
            availableCapabilities: [],
            availableIntegrationIds: progressiveTools?.enabledIntegrations ?? [],
            availableProfiles: progressiveTools
              ? availableProgressiveProfiles({
                  enabledIntegrations: progressiveTools.enabledIntegrations,
                  isPro,
                  allowSubagents: progressiveTools.allowSubagents,
                })
              : undefined,
          },
        );

        const hasCatalog = catalog.length > 0;
        const hasAlways = alwaysSkills.length > 0;

        if (hasCatalog || hasAlways) {
          const promptParts = [
            buildNanthAIPrelude(runtimeProfile),
            skillAugmentedPrompt,
            buildRuntimeGuard(runtimeProfile),
          ];

          // Inject always-on skill instructions
          if (hasAlways) {
            promptParts.push(formatAlwaysSkillInstructions(alwaysSkills));
          }

          // Inject discoverable skill catalog
          if (hasCatalog) {
            promptParts.push(formatSkillCatalogXml(catalog));
            promptParts.push(SKILL_DISCOVERY_INSTRUCTION);
          }

          skillAugmentedPrompt = promptParts
            .filter((part): part is string => Boolean(part && part.trim().length > 0))
            .join("\n\n");
        }
        ttftLog("[generation] skill catalog built", {
          chatId: args.chatId,
          messageId: participant.messageId,
          jobId: participant.jobId,
          modelId: participant.modelId,
          durationMs: Date.now() - skillCatalogStartedAt,
          hasCatalog,
          hasAlways,
        });
      } catch (e) {
        // Non-fatal: if skill catalog fails, continue without it
        console.warn("[skills] Failed to build skill catalog:", e instanceof Error ? e.message : String(e));
      }
    }

    const memoryContextStartedAt = Date.now();
    const resolvedMemoryContext = requestMessagesOverride
      ? undefined
      : await resolveMemoryContextForGeneration(ctx, {
        messages: allMessages.map((message) => ({
          _id: message._id,
          role: message.role,
          content: message.content,
        })),
        userMessageId: args.userMessageId,
        userId: args.userId,
        personaId: participant.personaId ?? null,
        chatId: args.chatId,
        assistantMessageId: participant.messageId,
      });
    ttftLog("[generation] memory context resolved", {
      chatId: args.chatId,
      messageId: participant.messageId,
      jobId: participant.jobId,
      modelId: participant.modelId,
      durationMs: Date.now() - memoryContextStartedAt,
      usedOverrideMessages: requestMessagesOverride != null,
    });

    const requestMessagesStartedAt = Date.now();
    const baseRequestMessages = requestMessagesOverride ?? buildRequestMessages({
      messages: allMessages,
      excludeMessageId: participant.messageId,
      systemPrompt: skillAugmentedPrompt ?? undefined,
      memoryContext: resolvedMemoryContext || memoryContext,
      expandMultiModelGroups: args.expandMultiModelGroups,
      maxContextTokens:
        modelCapabilities.get(participant.modelId)?.contextLength ?? 75_000,
    });

    const promotedRequest = promoteLatestUserVideoUrls(baseRequestMessages, {
      modelId: participant.modelId,
      provider: caps?.provider,
      hasVideoInput: caps?.hasVideoInput,
    });
    const requestMessages = await appendCurrentTurnAudioInput(
      promotedRequest.messages,
      allMessages.find((message) => message._id === args.userMessageId) as any,
      caps?.hasAudioInput,
    );
    const restoredProfiles = progressiveTools
      ? Array.from(new Set([
          ...extractProfilesFromConversation(requestMessages),
          ...(params.restoredActiveProfiles ?? []),
        ]))
      : (params.restoredActiveProfiles ?? []);
    let effectiveToolRegistry = toolRegistry;
    ttftLog("[generation] request messages built", {
      chatId: args.chatId,
      messageId: participant.messageId,
      jobId: participant.jobId,
      modelId: participant.modelId,
      durationMs: Date.now() - requestMessagesStartedAt,
      requestMessageCount: requestMessages.length,
      restoredProfileCount: restoredProfiles.length,
    });

    if (requestMessages.length === 0) {
      throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: "No request messages to send" });
    }

    if (promotedRequest.events.length > 0) {
      const promotedCount = promotedRequest.events.filter(
        (event) => event.status === "promoted",
      ).length;
      const skipped = promotedRequest.events.filter(
        (event) => event.status === "skipped",
      );
      if (promotedCount > 0) {
        console.info("[video_url] promoted YouTube URLs", {
          modelId: participant.modelId,
          provider: caps?.provider,
          count: promotedCount,
        });
      }
      for (const event of skipped) {
        console.info("[video_url] YouTube URL detected but not promoted", {
          modelId: participant.modelId,
          provider: caps?.provider,
          url: event.url,
          reason: event.reason,
        });
      }
    }

    const providerConstraintsStartedAt = Date.now();
    const rawParams: ChatRequestParameters = {
      temperature: participant.temperature ?? 0.7,
      maxTokens: participant.maxTokens ?? null,
      includeReasoning: participant.includeReasoning ?? null,
      reasoningEffort: participant.reasoningEffort ?? null,
      webSearchEnabled: args.webSearchEnabled,
    };

    // M10: Inject tool definitions when a registry is available.
    if (effectiveToolRegistry && !effectiveToolRegistry.isEmpty && modelSupportsTools) {
      rawParams.tools = effectiveToolRegistry.getDefinitions();
      rawParams.toolChoice = forceToolChoiceNone ? "none" : "auto";
    }

    let effectiveParams = gateParameters(
      rawParams,
      caps?.supportedParameters,
      caps?.hasImageGeneration,
      caps?.hasReasoning,
    );

    // ZDR + Google data protection enforcement.
    // userPrefs was fetched in the preflight parallel batch above.
    const userWantsZdr = userPrefs?.zdrEnabled === true;
    const googleActive = hasGoogleIntegrations(
      progressiveTools?.enabledIntegrations,
    );
    const requireZdr = userWantsZdr || googleActive;

    if (requireZdr) {
      if (!(caps?.hasZdrEndpoint)) {
        throw new ConvexError(
          googleActive
            ? "This model isn't available for conversations using Google Workspace data. Please select a compatible model."
            : "This model doesn't support Zero Data Retention. Please select a compatible model.",
        );
      }
      effectiveParams.provider = { zdr: true };
    }
    if (googleActive && !isGoogleDataAllowedProvider(caps?.provider)) {
      throw new ConvexError(
        "This model isn't available for conversations using Google Workspace data. Please select a compatible model.",
      );
    }
    ttftLog("[generation] provider constraints resolved", {
      chatId: args.chatId,
      messageId: participant.messageId,
      jobId: participant.jobId,
      modelId: participant.modelId,
      durationMs: Date.now() - providerConstraintsStartedAt,
      requireZdr,
      googleActive,
      hasTools: effectiveToolRegistry != null && !effectiveToolRegistry.isEmpty,
    });

    let hasLoggedFirstDelta = false;
    let hasLoggedFirstReasoningDelta = false;
    let hasLoggedFirstPatch = false;
    const openRouterRequestStartedAt = Date.now();
    const writer = new StreamWriter({
      ctx,
      messageId: participant.messageId,
      streamingMessageId,
      beforePatch: async () => {
        if (hasLoggedFirstPatch) return;
        hasLoggedFirstPatch = true;
        ttftLog("[generation] first streaming patch written", {
          chatId: args.chatId,
          messageId: participant.messageId,
          jobId: participant.jobId,
          modelId: participant.modelId,
          durationMs: Date.now() - openRouterRequestStartedAt,
        });
      },
      transformContent: clampMessageContent,
      shouldPersistReasoning: shouldPersistParticipantReasoning,
    });
    let deltaEventsSinceCancelCheck = 0;
    const streamedImagePayloads: string[] = [];

    // Build stream callbacks (reused across tool-call rounds).
    const streamCallbacks: { onDelta: OnDelta; onReasoningDelta: OnReasoningDelta; onToolCallStart: (toolCall: { index: number; id: string; name: string }) => Promise<void> } = {
      onDelta: async (delta) => {
        if (!hasLoggedFirstDelta && delta.length > 0) {
          hasLoggedFirstDelta = true;
          ttftLog("[generation] first delta received", {
            chatId: args.chatId,
            messageId: participant.messageId,
            jobId: participant.jobId,
            modelId: participant.modelId,
            durationMs: Date.now() - openRouterRequestStartedAt,
          });
        }
        await writer.handleContentDeltaBoundary(delta.length);

        const extracted = extractInlineImagePayloads(delta);
        let textDelta = extracted.text;
        if (extracted.imagePayloads.length > 0) {
          streamedImagePayloads.push(...extracted.imagePayloads);
        }

        if (textDelta.trim().length > 0) {
          const maybeInlineImage = detectStandaloneBase64Image(textDelta);
          if (maybeInlineImage) {
            streamedImagePayloads.push(maybeInlineImage);
            textDelta = "";
          }
        }

        if (textDelta.length > 0) {
          await writer.appendContent(textDelta);
        }

        await writer.patchContentIfNeeded();

        deltaEventsSinceCancelCheck += 1;
        if (deltaEventsSinceCancelCheck % 10 === 0) {
          const cancelled = await ctx.runQuery(
            internal.chat.queries.isJobCancelled,
            { jobId: participant.jobId },
          );
          if (cancelled) {
            throw new GenerationCancelledError();
          }
        }
      },
      onReasoningDelta: async (delta) => {
        if (!hasLoggedFirstReasoningDelta && delta.length > 0) {
          hasLoggedFirstReasoningDelta = true;
          ttftLog("[generation] first reasoning delta received", {
            chatId: args.chatId,
            messageId: participant.messageId,
            jobId: participant.jobId,
            modelId: participant.modelId,
            durationMs: Date.now() - openRouterRequestStartedAt,
          });
        }
        await writer.appendReasoning(delta);
        await writer.patchReasoningIfNeeded(
          shouldForceParticipantReasoningPatch(delta, writer.hasSeenContentDelta),
        );
      },
      onToolCallStart: async (toolCall) => {
        // Write in-progress tool call to DB so clients can show it immediately
        // (before the full stream finishes and onToolRoundStart fires).
        const inProgressToolCalls = [
          ...progressiveToolCalls,
          {
            id: toolCall.id,
            name: toolCall.name,
            arguments: "",
          },
        ];
        await ctx.runMutation(
          internal.chat.mutations.updateMessageToolCalls,
          {
            messageId: participant.messageId,
            streamingMessageId,
            toolCalls: inProgressToolCalls,
          },
        );
      },
    };

    const retryConfig = {
      emptyStreamRetries: 2,
      emptyStreamBackoffs: [500, 1500],
      fallbackModel: undefined,
    };
    ttftLog("[generation] OpenRouter request started", {
      chatId: args.chatId,
      messageId: participant.messageId,
      jobId: participant.jobId,
      modelId: participant.modelId,
    });

    // M13: Compaction-aware generation wrapper. Handles initial streaming,
    // tool-call loop, and automatic context compaction when the context
    // window or action timeout is approaching limits.
    const progressiveToolCalls: RecordedToolCall[] = [];
    const activeProfiles = new Set<SkillToolProfileId>(
      restoredProfiles,
    );

    const genResult = await runGenerationWithCompaction({
      apiKey,
      model: participant.modelId,
      messages: requestMessages,
      params: effectiveParams,
      callbacks: streamCallbacks,
      retryConfig,
      toolRegistry: effectiveToolRegistry,
      toolCtx: sharedToolCtx,
      onToolRoundStart: async (_round, toolCalls) => {
        for (const tc of toolCalls) {
          progressiveToolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: tc.function.arguments,
          });
        }
        await ctx.runMutation(
          internal.chat.mutations.updateMessageToolCalls,
          {
            messageId: participant.messageId,
            streamingMessageId,
            toolCalls: progressiveToolCalls,
          },
        );
      },
      onPrepareNextTurn: async (_round, toolCalls, results) => {
        if (!progressiveTools) return;

        const newProfiles = extractProfilesFromLoadSkillResults(toolCalls, results);
        let changed = false;
        for (const profile of newProfiles) {
          if (!activeProfiles.has(profile)) {
            activeProfiles.add(profile);
            changed = true;
          }
        }
        if (!changed) return;
        const expanded = await onProfilesExpanded?.(
          toolCalls,
          results,
          Array.from(activeProfiles),
          effectiveToolRegistry ?? new ToolRegistry(),
          effectiveParams,
          caps,
        );
        if (expanded?.registry) {
          effectiveToolRegistry = expanded.registry;
        }
        if (expanded?.params) {
          effectiveParams = expanded.params;
        }
        return expanded;
      },
      modelContextLimit: caps?.contextLength ?? 128_000,
      writer,
      actionStartTime: params.actionStartTime,
      allowContinuationHandoff: continuationHandoff != null,
      initialTotalUsage: params.initialTotalUsage ?? null,
      initialToolCalls: params.initialToolCalls ?? [],
      initialToolResults: params.initialToolResults ?? [],
      initialCompactionCount: params.initialCompactionCount ?? 0,
      maxToolRoundsPerInvocation: continuationHandoff?.maxToolRoundsPerInvocation,
    });

    const result = genResult.streamResult;
    const collectedToolCalls = genResult.allToolCalls;
    const collectedToolResults = genResult.allToolResults;

    // M23: Store ancillary compaction costs against this message.
    for (const cu of genResult.compactionUsages) {
      await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
        messageId: participant.messageId,
        chatId: args.chatId,
        userId: args.userId,
        modelId: cu.modelId,
        promptTokens: cu.usage.promptTokens,
        completionTokens: cu.usage.completionTokens,
        totalTokens: cu.usage.totalTokens,
        cost: cu.usage.cost ?? undefined,
        source: "compaction",
        generationId: cu.generationId ?? undefined,
      });
    }

    await writer.flush();

    if (genResult.deferredToolRound) {
      const deferred = genResult.deferredToolRound.deferredResults.find(
        (entry) => entry.payload.kind === "spawn_subagents",
      );
      const tasks = (deferred?.payload.data as { tasks?: Array<{ title: string; prompt: string }> } | undefined)?.tasks ?? [];
      const deferredToolCall = genResult.deferredToolRound.toolCalls.find(
        (entry) => entry.id === deferred?.toolCallId,
      );
      const currentRoundToolCallIds = new Set(
        genResult.deferredToolRound.toolCalls.map((entry) => entry.id),
      );
      if (tasks.length === 0) {
        throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: "Subagent tool paused without valid tasks." });
      }

      const batchResult = await ctx.runMutation(internal.subagents.mutations.createBatch, {
        parentMessageId: participant.messageId,
        sourceUserMessageId: args.userMessageId,
        parentJobId: participant.jobId,
        chatId: args.chatId,
        userId: args.userId,
        toolCallId: deferred?.toolCallId ?? genResult.deferredToolRound.toolCalls[0]?.id ?? crypto.randomUUID(),
        toolCallArguments: deferredToolCall?.function.arguments ?? "{}",
        toolRoundCalls: genResult.deferredToolRound.toolCalls,
        toolRoundResults: genResult.deferredToolRound.recordedToolResults.filter((entry) =>
          currentRoundToolCallIds.has(entry.toolCallId)
        ),
        childConversationSeed: genResult.deferredToolRound.baseConversationMessages,
        resumeConversationSeed: genResult.deferredToolRound.resumeConversationMessages,
        paramsSnapshot: {
          enabledIntegrations: args.enabledIntegrations,
          requestParams: effectiveParams,
        },
        participantSnapshot: {
          chatId: args.chatId,
          userId: args.userId,
          participant,
        },
        tasks,
      });

      for (const runId of batchResult.runIds) {
        await ctx.scheduler.runAfter(0, internal.subagents.actions.runSubagentRun, {
          runId,
        });
      }
      return {
        deferredForSubagents: true,
        cancelled: false,
        failed: false,
        continued: false,
      };
    }

    if (genResult.continuation && continuationHandoff) {
      await continuationHandoff.onHandoff({
        participant,
        group: {
          assistantMessageIds: args.assistantMessageIds,
          generationJobIds: args.generationJobIds,
          userMessageId: args.userMessageId,
          userId: args.userId,
          expandMultiModelGroups: args.expandMultiModelGroups,
          webSearchEnabled: args.webSearchEnabled,
          effectiveIntegrations: progressiveTools?.enabledIntegrations ?? [],
          directToolNames: progressiveTools?.directToolNames ?? [],
          isPro,
          allowSubagents: progressiveTools?.allowSubagents ?? false,
          searchSessionId: args.searchSessionId,
          subagentBatchId: (args as { subagentBatchId?: any }).subagentBatchId,
          chatSkillOverrides: preResolvedOverrides?.chatSkillOverrides as any,
          chatIntegrationOverrides: args.chatIntegrationOverrides as any,
          personaSkillOverrides: preResolvedOverrides?.personaSkillOverrides as any,
          skillDefaults: preResolvedOverrides?.skillDefaults as any,
          integrationDefaults: args.integrationDefaults as any,
        },
        messages: genResult.continuation.messages,
        usage: genResult.totalUsage ?? undefined,
        toolCalls: collectedToolCalls,
        toolResults: collectedToolResults,
        activeProfiles: Array.from(activeProfiles),
        compactionCount: genResult.compactionCount,
        continuationCount: continuationHandoff.continuationCount + 1,
        partialContent: writer.totalContent || undefined,
        partialReasoning: writer.totalReasoning || undefined,
      });
      return {
        deferredForSubagents: false,
        cancelled: false,
        failed: false,
        continued: true,
      };
    }

    const extractedFromResult = extractInlineImagePayloads(result.content);
    if (extractedFromResult.imagePayloads.length > 0) {
      streamedImagePayloads.push(...extractedFromResult.imagePayloads);
    }
    const normalizedImageCandidates = dedupeImageCandidates([
      ...result.imageUrls,
      ...streamedImagePayloads,
    ]);

    let totalContent = writer.totalContent;
    if (
      totalContent.trim().length === 0 &&
      extractedFromResult.text.trim().length > 0
    ) {
      totalContent = extractedFromResult.text.trim();
    }

    let finalContent = totalContent.trim();
    if (!finalContent && (result.reasoning || writer.totalReasoning)) {
      finalContent = "Model returned reasoning only.";
    } else if (!finalContent && normalizedImageCandidates.length > 0) {
      finalContent = "[Generated image]";
    } else if (!finalContent) {
      finalContent = "[No response received from model]";
    }

    // Resolve Perplexity citation annotations: replace [N] markers with
    // markdown links so the stored content is self-contained and readable.
    const annotations = result.annotations;
    let citationsForStorage: Array<{ url: string; title: string }> | undefined;
    if (annotations.length > 0) {
      finalContent = resolvePerplexityCitations(finalContent, annotations);
      citationsForStorage = annotations
        .filter((a) => a.url_citation?.url)
        .map((a) => ({
          url: a.url_citation.url,
          title: a.url_citation.title ?? a.url_citation.url,
        }));
    }

    finalContent = clampMessageContent(finalContent);

    const imageResult = await persistGeneratedImageUrlsWithTracking(
      ctx,
      normalizedImageCandidates,
    );
    const persistedImageUrls = imageResult.urls;

    // M29: Insert generatedMedia rows for each stored image (KB visibility).
    for (const img of imageResult.stored) {
      await ctx.runMutation(internal.chat.mutations.insertGeneratedMedia, {
        userId: args.userId,
        chatId: args.chatId,
        messageId: participant.messageId,
        storageId: img.storageId,
        type: "image" as const,
        mimeType: img.mimeType,
        sizeBytes: img.sizeBytes,
      });
    }

    // M10: Extract generated file metadata from tool results.
    const generatedFilesMeta = extractGeneratedFiles(genResult.allToolResults);
    const generatedChartsMeta = extractGeneratedCharts(genResult.allToolResults);

    // M26: Lyria music generation — persist inline audio from the stream result.
    let audioStorageId: undefined | Id<"_storage">;
    let audioDurationMs: number | undefined;
    let audioGeneratedAt: number | undefined;
    if (result.audioBase64) {
      if (!persistInlineAudio) {
        throw new ConvexError({
          code: "INTERNAL_ERROR" as const,
          message: "Inline audio output requires Node-backed persistence.",
        });
      }
      const persistedAudio = await persistInlineAudio(result.audioBase64);
      audioStorageId = persistedAudio.audioStorageId;
      audioDurationMs = persistedAudio.audioDurationMs;
      audioGeneratedAt = persistedAudio.audioGeneratedAt;
    }

    const usageToStore = genResult.totalUsage ?? result.usage ?? undefined;

    await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
      messageId: participant.messageId,
      jobId: participant.jobId,
      chatId: args.chatId,
      content: finalContent,
      status: "completed",
      usage: usageToStore,
      reasoning: writer.totalReasoning || result.reasoning || undefined,
      imageUrls: persistedImageUrls.length > 0 ? persistedImageUrls : undefined,
      userId: args.userId,
      // M10: Structured tool data
      toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : undefined,
      toolResults: collectedToolResults.length > 0 ? collectedToolResults : undefined,
      generatedFiles: generatedFilesMeta.length > 0 ? generatedFilesMeta : undefined,
      generatedCharts: generatedChartsMeta.length > 0 ? generatedChartsMeta : undefined,
      // Perplexity citations (structured array for rich UI rendering)
      citations: citationsForStorage,
      // M26: Lyria inline audio
      audioStorageId,
      audioDurationMs,
      audioGeneratedAt,
      triggerUserMessageId: args.userMessageId,
      openrouterGenerationId: result.generationId ?? undefined,
    });
    return {
      deferredForSubagents: false,
      cancelled: false,
      failed: false,
      continued: false,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown generation error";
    const wasCancelled = isGenerationCancelledError(error);

    await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
      messageId: participant.messageId,
      jobId: participant.jobId,
      chatId: args.chatId,
      content: wasCancelled ? "[Generation cancelled]" : `Error: ${errorMessage}`,
      status: wasCancelled ? "cancelled" : "failed",
      error: errorMessage,
      userId: args.userId,
    });
    return {
      deferredForSubagents: false,
      cancelled: wasCancelled,
      failed: !wasCancelled,
      continued: false,
    };
  } finally {
    // Stop the workspace (just-bash) sandbox — it is per-generation, not persistent.
    await sharedToolCtx.workspaceSandboxCleanup?.().catch(() => {});
    // NOTE: The Vercel sandbox is NOT stopped here. It is a per-chat persistent
    // session that must survive across assistant turns so packages/files/state
    // carry over. Idle VMs are reaped by the cleanStaleSandboxSessions cron.
  }
}
