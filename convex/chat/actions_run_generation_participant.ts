"use node";

import { ConvexError } from "convex/values";
import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  ChatRequestParameters,
  gateParameters,
  OnDelta,
  OnReasoningDelta,
  resolvePerplexityCitations,
} from "../lib/openrouter";
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
  persistGeneratedImageUrls,
} from "./action_image_helpers";
import { resolveMemoryContextForGeneration } from "./action_memory_helpers";
import {
  ModelCapabilities,
  ParticipantConfig,
  RunGenerationArgs,
} from "./actions_run_generation_types";
import { appendCurrentTurnAudioInput } from "./audio_input_request";
import { LYRIA_MP3_MIME_TYPE, parseMp3DurationMs } from "./audio_shared";
import { CITATION_SYSTEM_PROMPT_SUFFIX } from "../search/helpers";
import {
  buildNanthAIPrelude,
  buildRuntimeGuard,
  buildSkillCatalogFromDocs,
  formatSkillCatalogXml,
  SKILL_DISCOVERY_INSTRUCTION,
} from "../skills/helpers";
import { StreamWriter } from "./stream_writer";
import { ToolRegistry } from "../tools/registry";
import { RecordedToolCall } from "../tools/execute_loop";
import { runGenerationWithCompaction } from "./actions_run_generation_loop";
import { extractGeneratedCharts, extractGeneratedFiles } from "./generated_file_helpers";
import {
  availableProgressiveProfiles,
  buildProgressiveToolRegistry,
  buildRegistryParams,
  extractProfilesFromConversation,
  extractProfilesFromLoadSkillResults,
  patchSameRoundProgressiveToolErrors,
  retrySameRoundProgressiveToolCalls,
} from "../tools/progressive_registry";
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
  /** Timestamp (ms) captured at the very start of the action, before context
   *  preparation. Used by the compaction layer to detect approaching timeout. */
  actionStartTime: number;
}

async function resolveSystemPrompt(
  ctx: ActionCtx,
  participant: ParticipantConfig,
  userId: string,
): Promise<string | null | undefined> {
  let systemPrompt = participant.systemPrompt;
  if (!systemPrompt && participant.personaId) {
    const persona = await ctx.runQuery(internal.chat.queries.getPersona, {
      personaId: participant.personaId,
      userId,
    });
    if (persona) {
      systemPrompt = persona.systemPrompt;
    }
  }
  return systemPrompt;
}

export async function generateForParticipant(
  params: GenerateForParticipantParams,
): Promise<{ deferredForSubagents: boolean; cancelled: boolean; failed: boolean }> {
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
  } =
    params;

  // Pre-start cancellation check: if the job was cancelled (e.g. by the user
  // while the scheduler.runAfter was pending), bail out immediately.
  const alreadyCancelled: boolean = await ctx.runMutation(
    internal.chat.mutations.isJobCancelled,
    { jobId: participant.jobId },
  );
  if (alreadyCancelled) {
    return { deferredForSubagents: false, cancelled: true, failed: false };
  }

  await ctx.runMutation(internal.chat.mutations.updateJobStatus, {
    jobId: participant.jobId,
    status: "streaming",
    startedAt: Date.now(),
  });

  // Shared tool execution context — workspace sandbox is lazily created on
  // first workspace tool call and persists across all tool calls within this
  // generation run. Cleanup is handled in the finally block.
  const sharedToolCtx: import("../tools/registry").ToolExecutionContext = {
    ctx,
    userId: args.userId,
    chatId: String(args.chatId),
  };

  try {
    const caps = modelCapabilities.get(participant.modelId);
    const modelSupportsTools = caps?.supportedParameters?.includes("tools") ?? false;
    const systemPrompt = await resolveSystemPrompt(
      ctx,
      participant,
      args.userId,
    );

    // M9: Append citation formatting instructions for Normal Search (Path B)
    const effectiveSystemPrompt = args.webSearchEnabled && systemPrompt
      ? systemPrompt + CITATION_SYSTEM_PROMPT_SUFFIX
      : args.webSearchEnabled
        ? CITATION_SYSTEM_PROMPT_SUFFIX.trim()
        : systemPrompt ?? undefined;

    // M18: Build skill catalog and append to system prompt.
    // Progressive disclosure: model sees lightweight catalog XML, calls
    // load_skill to get full instructions on demand.
    let skillAugmentedPrompt = effectiveSystemPrompt;
    if (!requestMessagesOverride && toolRegistry && !toolRegistry.isEmpty && modelSupportsTools) {
      try {
        // Fetch system skills, chat doc, and persona in parallel
        const [systemSkills, chatDoc, personaDoc] = await Promise.all([
          ctx.runQuery(internal.skills.queries.listActiveSystemSkills, {}),
          ctx.runQuery(internal.chat.queries.getChatInternal, { chatId: args.chatId }),
          participant.personaId
            ? ctx.runQuery(internal.chat.queries.getPersona, {
                personaId: participant.personaId,
                userId: args.userId,
              })
            : Promise.resolve(null),
        ]);

        const chatDiscoverableIds = (chatDoc as Record<string, unknown>)?.discoverableSkillIds as string[] | undefined;
        const chatDisabledIds = (chatDoc as Record<string, unknown>)?.disabledSkillIds as string[] | undefined;
        const personaDiscoverableIds = (personaDoc as Record<string, unknown>)?.discoverableSkillIds as string[] | undefined;

        // Fetch persona/chat discoverable skills by ID (if any)
        const [personaSkills, chatSkills] = await Promise.all([
          personaDiscoverableIds && personaDiscoverableIds.length > 0
            ? ctx.runQuery(internal.skills.queries.getSkillsByIds, {
                skillIds: personaDiscoverableIds as any,
              })
            : Promise.resolve([]),
          chatDiscoverableIds && chatDiscoverableIds.length > 0
            ? ctx.runQuery(internal.skills.queries.getSkillsByIds, {
                skillIds: chatDiscoverableIds as any,
              })
            : Promise.resolve([]),
        ]);

        const catalog = buildSkillCatalogFromDocs(
          systemSkills as any,
          personaSkills as any,
          chatSkills as any,
          (chatDisabledIds ?? []) as any,
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

        if (catalog.length > 0) {
          const catalogXml = formatSkillCatalogXml(catalog);
          const promptParts = [
            buildNanthAIPrelude(runtimeProfile),
            skillAugmentedPrompt,
            buildRuntimeGuard(runtimeProfile),
            catalogXml,
            SKILL_DISCOVERY_INSTRUCTION,
          ].filter((part): part is string => Boolean(part && part.trim().length > 0));

          skillAugmentedPrompt = promptParts.join("\n\n");
        }
      } catch (e) {
        // Non-fatal: if skill catalog fails, continue without it
        console.warn("[skills] Failed to build skill catalog:", e instanceof Error ? e.message : String(e));
      }
    }

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
      ? extractProfilesFromConversation(requestMessages)
      : [];
    const effectiveToolRegistry =
      progressiveTools &&
      modelSupportsTools &&
      toolRegistry &&
      !toolRegistry.isEmpty &&
      restoredProfiles.length > 0
        ? buildProgressiveToolRegistry({
            enabledIntegrations: progressiveTools.enabledIntegrations,
            isPro,
            allowSubagents: progressiveTools.allowSubagents,
            activeProfiles: restoredProfiles,
            directToolNames: progressiveTools.directToolNames ?? [],
          })
        : toolRegistry;

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
      rawParams.toolChoice = "auto";
    }

    const gatedParams = gateParameters(
      rawParams,
      caps?.supportedParameters,
      caps?.hasImageGeneration,
      caps?.hasReasoning,
    );

    const writer = new StreamWriter({
      ctx,
      messageId: participant.messageId,
      transformContent: clampMessageContent,
      shouldPersistReasoning: shouldPersistParticipantReasoning,
    });
    let deltaEventsSinceCancelCheck = 0;
    const streamedImagePayloads: string[] = [];

    // Build stream callbacks (reused across tool-call rounds).
    const streamCallbacks: { onDelta: OnDelta; onReasoningDelta: OnReasoningDelta } = {
      onDelta: async (delta) => {
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
          const cancelled = await ctx.runMutation(
            internal.chat.mutations.isJobCancelled,
            { jobId: participant.jobId },
          );
          if (cancelled) {
            throw new GenerationCancelledError();
          }
        }
      },
      onReasoningDelta: async (delta) => {
        await writer.appendReasoning(delta);
        await writer.patchReasoningIfNeeded(
          shouldForceParticipantReasoningPatch(delta, writer.hasSeenContentDelta),
        );
      },
    };

    const retryConfig = {
      emptyStreamRetries: 2,
      emptyStreamBackoffs: [500, 1500],
      fallbackModel: undefined,
    };

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
      params: gatedParams,
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

        const registry = buildProgressiveToolRegistry({
          enabledIntegrations: progressiveTools.enabledIntegrations,
          isPro,
          allowSubagents: progressiveTools.allowSubagents,
          activeProfiles: Array.from(activeProfiles),
          directToolNames: progressiveTools.directToolNames ?? [],
        });
        await retrySameRoundProgressiveToolCalls(
          toolCalls,
          results,
          registry,
          sharedToolCtx,
        );
        patchSameRoundProgressiveToolErrors(toolCalls, results, registry);

        return {
          registry,
          params: gateParameters(
            {
              ...gatedParams,
              ...buildRegistryParams(registry),
            },
            caps?.supportedParameters,
            caps?.hasImageGeneration,
            caps?.hasReasoning,
          ),
        };
      },
      modelContextLimit: caps?.contextLength ?? 128_000,
      writer,
      actionStartTime: params.actionStartTime,
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
          requestParams: gatedParams,
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
      return { deferredForSubagents: true, cancelled: false, failed: false };
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

    const persistedImageUrls = await persistGeneratedImageUrls(
      ctx,
      normalizedImageCandidates,
    );

    // M10: Extract generated file metadata from tool results.
    const generatedFilesMeta = extractGeneratedFiles(genResult.allToolResults);
    const generatedChartsMeta = extractGeneratedCharts(genResult.allToolResults);

    // M26: Lyria music generation — persist inline audio from the stream result.
    let audioStorageId: undefined | Awaited<ReturnType<typeof ctx.storage.store>>;
    let audioDurationMs: number | undefined;
    let audioGeneratedAt: number | undefined;
    if (result.audioBase64) {
      const audioBuffer = Buffer.from(result.audioBase64, "base64");
      audioDurationMs = parseMp3DurationMs(audioBuffer);
      // Fall back to a conservative estimate if frame parsing yields 0
      // (shouldn't happen for valid Lyria MP3, but be defensive).
      if (audioDurationMs === 0) {
        // Rough estimate: MP3 ~128kbps → bytes * 8 / 128000 * 1000
        audioDurationMs = Math.round((audioBuffer.length * 8) / 128000 * 1000);
      }
      audioStorageId = await ctx.storage.store(
        new Blob([new Uint8Array(audioBuffer)], { type: LYRIA_MP3_MIME_TYPE }),
      );
      audioGeneratedAt = Date.now();
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
    return { deferredForSubagents: false, cancelled: false, failed: false };
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
    return { deferredForSubagents: false, cancelled: wasCancelled, failed: !wasCancelled };
  } finally {
    // Stop the workspace (just-bash) sandbox — it is per-generation, not persistent.
    await sharedToolCtx.workspaceSandboxCleanup?.().catch(() => {});
    // NOTE: The Vercel sandbox is NOT stopped here. It is a per-chat persistent
    // session that must survive across assistant turns so packages/files/state
    // carry over. Idle VMs are reaped by the cleanStaleSandboxSessions cron.
  }
}
