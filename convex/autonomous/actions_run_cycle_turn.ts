import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  callOpenRouterStreaming,
  ChatRequestParameters,
  gateParameters,
} from "../lib/openrouter";
import { buildRequestMessages } from "../chat/helpers";
import { assembleRequestContextForGeneration } from "../chat/actions_context_assembly_integration";
import { promoteLatestUserVideoUrls } from "../chat/helpers_video_url_utils";
import { StreamWriter } from "../chat/stream_writer";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import {
  assertModelSupportsZdr,
  isZdrEnabled,
  withZdrProvider,
} from "../lib/openrouter_zdr";
import {
  generateModeratorDirective,
  ModeratorConfig,
  ParticipantConfig,
} from "./actions_helpers";
import { ModelCapabilities, TurnOutcome } from "./actions_run_cycle_types";
import { loadMemoryContext } from "./actions_run_cycle_context";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";
import {
  captureAssistantResponseCompleted,
  captureAssistantResponseFailure,
  captureAssistantResponseStartedEvent,
} from "../chat/generation_analytics";
import { markGenerationJobAnalyticsStarted } from "../chat/generation_start_guard";
import { normalizeGenerationError } from "../chat/generation_error";
import { isGenerationCancelledError } from "../chat/generation_helpers";
import { runAutonomousImageTurn } from "./actions_run_cycle_image";
import { assertOpenRouterImagePrivacy } from "../lib/openrouter_image";
import { assertModelAvailable } from "../lib/openrouter_modality";
import { imageConfigFromPreferences } from "../preferences/image_defaults";
import { adaptMessagesForImageInput } from "../chat/request_message_capabilities";
import {
  dedicatedImageGenerationAnalytics,
  type DedicatedImageGenerationAnalytics,
} from "../chat/image_generation_analytics";
import {
  autonomousImagePromptText,
  autonomousParticipantPromptName,
  buildAutonomousTranscriptMessages,
} from "./actions_run_cycle_transcript";

const EMPTY_STREAM_RETRY_DELAYS = [500, 1500];
const CANCELLED_TURN_ERROR = "AUTONOMOUS_SESSION_CANCELLED";

const defaultRunParticipantTurnDeps = {
  now: () => Date.now(),
  getRequiredUserOpenRouterApiKey,
  generateModeratorDirective,
  buildRequestMessages,
  assembleRequestContextForGeneration,
  promoteLatestUserVideoUrls,
  createStreamWriter: (options: ConstructorParameters<typeof StreamWriter>[0]) =>
    new StreamWriter(options),
  loadMemoryContext,
  gateParameters,
  callOpenRouterStreaming,
  runAutonomousImageTurn,
};

export type RunParticipantTurnDeps = typeof defaultRunParticipantTurnDeps;

export function createRunParticipantTurnDepsForTest(
  overrides: DeepPartial<RunParticipantTurnDeps> = {},
): RunParticipantTurnDeps {
  return mergeTestDeps({
    ...defaultRunParticipantTurnDeps,
    assembleRequestContextForGeneration: async ({ legacyMessages }) => legacyMessages,
  }, overrides);
}

function isCancelledTurnError(error: unknown): boolean {
  return isGenerationCancelledError(error) ||
    (error instanceof Error && error.message === CANCELLED_TURN_ERROR);
}

async function finalizeTransientTurnFailure(
  ctx: ActionCtx,
  params: {
    messageId: Id<"messages">;
    jobId: Id<"generationJobs">;
    chatId: Id<"chats">;
    userId: string;
    reason: string;
  },
): Promise<void> {
  await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
    messageId: params.messageId,
    jobId: params.jobId,
    chatId: params.chatId,
    content: `Autonomous turn failed: ${params.reason}`,
    status: "failed",
    error: params.reason,
    userId: params.userId,
    skipExecutionTerminalization: true,
  });
}

async function cleanupTransientTurnEntities(
  ctx: ActionCtx,
  messageId: Id<"messages"> | undefined,
  jobId: Id<"generationJobs"> | undefined,
): Promise<void> {
  if (messageId) {
    try {
      await ctx.runMutation(internal.autonomous.mutations_helpers.deleteMessage, {
        messageId,
      });
    } catch {
      // no-op
    }
  }
  if (jobId) {
    try {
      await ctx.runMutation(internal.autonomous.mutations_helpers.deleteGenerationJob, {
        jobId,
      });
    } catch {
      // no-op
    }
  }
}

export interface RunParticipantTurnParams {
  ctx: ActionCtx;
  sessionId: Id<"autonomousSessions">;
  chatId: Id<"chats">;
  participant: ParticipantConfig;
  cycleParentIds: Id<"messages">[];
  modelCapabilities: Map<string, ModelCapabilities>;
  memoryContext: string | undefined;
  moderatorConfig?: ModeratorConfig;
  userId: string;
  webSearchEnabled: boolean;
  executionEpoch?: number;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
  turnCycle?: number;
  turnParticipantIndex?: number;
}

export async function runParticipantTurn(
  params: RunParticipantTurnParams,
  deps: RunParticipantTurnDeps = defaultRunParticipantTurnDeps,
): Promise<TurnOutcome> {
  const {
    ctx,
    sessionId,
    chatId,
    participant,
    cycleParentIds,
    modelCapabilities,
    memoryContext,
    moderatorConfig,
    userId,
    webSearchEnabled,
    executionEpoch,
    executionAttemptId,
    executionFence,
    turnCycle,
    turnParticipantIndex,
  } = params;
  const executionToken = executionAttemptId && executionFence !== undefined
    ? { executionAttemptId, executionFence }
    : {};

  let messageId: Id<"messages"> | undefined;
  let jobId: Id<"generationJobs"> | undefined;
  const initialCapabilities = modelCapabilities.get(participant.modelId);
  let imageTerminalAnalytics: DedicatedImageGenerationAnalytics | undefined =
    initialCapabilities?.hasImageGeneration === true
      ? dedicatedImageGenerationAnalytics({
          supportedParameters: initialCapabilities.imageCapabilities?.supportedParameters,
          originSource: "autonomous_discussion",
        })
      : undefined;

  const markTurnCancelled = async () => {
    if (jobId) {
      try {
        await ctx.runMutation(internal.chat.mutations.updateJobStatus, {
          jobId,
          executionAttemptId,
          executionFence,
          status: "cancelled",
        });
      } catch {
        // no-op
      }
    }
    if (messageId) {
      try {
        await ctx.runMutation(internal.chat.mutations.updateMessageContent, {
          messageId,
          executionAttemptId,
          executionFence,
          content: "",
          status: "cancelled",
        });
      } catch {
        // no-op
      }
    }
  };

  const assertSessionEpochActive = async (): Promise<void> => {
    if (executionEpoch === undefined) return;
    const active = await ctx.runMutation(
      internal.autonomous.mutations.shouldContinue,
      { sessionId, executionEpoch },
    );
    if (!active) throw new Error(CANCELLED_TURN_ERROR);
  };

  try {
    await assertSessionEpochActive();
    const [apiKey, preferences] = await Promise.all([
      deps.getRequiredUserOpenRouterApiKey(ctx, userId),
      ctx.runQuery(internal.chat.queries.getUserPreferences, { userId }),
    ]);
    const requireZdr = isZdrEnabled(preferences);
    let moderatorDirective: string | undefined;
    if (moderatorConfig) {
      moderatorDirective = await deps.generateModeratorDirective(
        ctx,
        moderatorConfig,
        participant,
        chatId,
        userId,
      );
    }
    await assertSessionEpochActive();

    let effectiveSystemPrompt = participant.systemPrompt;
    if (moderatorDirective) {
      const parts = [
        `<moderator_directive>\n${moderatorDirective}\n</moderator_directive>`,
        effectiveSystemPrompt,
      ].filter(Boolean);
      effectiveSystemPrompt = parts.join("\n\n");
    }

    const now = deps.now();
    const createdMessageId = await ctx.runMutation(
      internal.autonomous.mutations_helpers.createAutonomousMessage,
      {
        sessionId,
        executionEpoch,
        chatId,
        userId,
        modelId: participant.modelId,
        personaId: participant.personaId,
        participantId: participant.participantId,
        participantName: participant.displayName,
        parentMessageIds: cycleParentIds,
        moderatorDirective,
        turnCycle,
        turnParticipantIndex,
      },
    );
    if (!createdMessageId) {
      throw new Error(CANCELLED_TURN_ERROR);
    }
    messageId = createdMessageId;

    const createdJobId = await ctx.runMutation(
      internal.autonomous.mutations_helpers.createGenerationJob,
      {
        sessionId,
        executionEpoch,
        executionAttemptId,
        executionFence,
        chatId,
        messageId: createdMessageId,
        modelId: participant.modelId,
        userId,
        turnCycle,
        turnParticipantIndex,
      },
    );
    if (!createdJobId) {
      throw new Error(CANCELLED_TURN_ERROR);
    }
    jobId = createdJobId;

    await ctx.runMutation(internal.chat.mutations.updateJobStatus, {
      jobId,
      executionAttemptId,
      executionFence,
      status: "streaming",
      startedAt: now,
    });

    const currentMessages = await ctx.runQuery(internal.chat.queries.listAllMessages, {
      chatId,
    });
    const resolvedMemoryContext = await deps.loadMemoryContext(
      ctx,
      userId,
      participant.personaId,
      chatId,
    );

    const baseRequestMessages = deps.buildRequestMessages({
      messages: currentMessages,
      excludeMessageId: messageId,
      systemPrompt: effectiveSystemPrompt,
      memoryContext: resolvedMemoryContext || memoryContext,
      expandMultiModelGroups: false,
      maxContextTokens:
        modelCapabilities.get(participant.modelId)?.contextLength ?? 75_000,
    });

    const caps = modelCapabilities.get(participant.modelId);
    const imageConfig = imageConfigFromPreferences(preferences);
    if (caps?.hasImageGeneration) {
      imageTerminalAnalytics = dedicatedImageGenerationAnalytics({
        config: imageConfig,
        supportedParameters: caps.imageCapabilities?.supportedParameters,
        originSource: "autonomous_discussion",
      });
    }
    assertModelAvailable({
      modelId: participant.modelId,
      capabilities: caps,
      feature: "Autonomous discussion",
    });
    if (caps?.hasImageGeneration) {
      assertOpenRouterImagePrivacy(requireZdr);
    }
    if (requireZdr) {
      assertModelSupportsZdr({
        modelId: participant.modelId,
        capabilities: caps,
        feature: "Autonomous discussion",
      });
    }
    const assembledRequestMessages = await deps.assembleRequestContextForGeneration({
      ctx,
      chatId,
      userId,
      assistantMessageId: messageId,
      jobId,
      participantId: participant.participantId,
      legacyMessages: baseRequestMessages,
      allMessages: currentMessages,
      providerContextWindowTokens: modelCapabilities.get(participant.modelId)?.contextLength,
      mode: "autonomous_discussion",
      runtimeKind: "autonomous_discussion",
    });

    const promotedRequest = deps.promoteLatestUserVideoUrls(assembledRequestMessages, {
      modelId: participant.modelId,
      provider: caps?.provider,
      hasVideoInput: caps?.hasVideoInput,
    });

    if (promotedRequest.messages.length === 0) {
      await cleanupTransientTurnEntities(ctx, messageId, jobId);
      return { kind: "skipped" };
    }

    const transcriptMessages = buildAutonomousTranscriptMessages(
      promotedRequest.messages,
      autonomousParticipantPromptName(participant),
    );
    const requestMessages = caps?.hasImageGeneration === true
      ? transcriptMessages
      : adaptMessagesForImageInput(
          transcriptMessages,
          caps?.hasImageInput === true,
        );

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
      webSearchEnabled,
    };
    const gatedParams = withZdrProvider(
      deps.gateParameters(
        rawParams,
        caps?.supportedParameters,
        caps?.hasImageGeneration,
        caps?.hasReasoning,
      ),
      requireZdr,
    );

    let totalReasoning = "";
    let cancellationCheckCounter = 0;

    const assertTurnStillActive = async () => {
      if (!jobId) return;
      await assertSessionEpochActive();
      cancellationCheckCounter += 1;
      if (cancellationCheckCounter % 2 !== 0) return;
      const isCancelled = await ctx.runQuery(
        internal.chat.queries.isJobCancelled,
        { jobId },
      );
      if (!isCancelled) return;
      await markTurnCancelled();
      throw new Error(CANCELLED_TURN_ERROR);
    };

    const writer = deps.createStreamWriter({
      ctx,
      messageId,
      executionAttemptId,
      executionFence,
      beforePatch: assertTurnStillActive,
    });

    const generationStartedAt = deps.now();
    await assertTurnStillActive();
    let shouldCaptureStarted = false;
    try {
      shouldCaptureStarted = await markGenerationJobAnalyticsStarted(ctx, jobId);
    } catch (error) {
      console.warn("[analytics] failed to mark autonomous turn analytics start", {
        jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      shouldCaptureStarted = true;
    }
    if (!shouldCaptureStarted) {
      await markTurnCancelled();
      return { kind: "cancelled" };
    }
    await captureAssistantResponseStartedEvent(ctx, {
      userId,
      chatId: String(chatId),
      messageId: String(messageId),
      jobId: String(jobId),
      modelId: participant.modelId,
      source: imageTerminalAnalytics?.source ?? "autonomous_discussion",
      participantCount: 1,
      webSearchEnabled,
      properties: {
        ...imageTerminalAnalytics?.properties,
        autonomous_session_id: String(sessionId),
        participant_id: String(participant.participantId),
        persona_id: participant.personaId ? String(participant.personaId) : null,
        cycle_parent_count: cycleParentIds.length,
        request_message_count: requestMessages.length,
        base_context_message_count: baseRequestMessages.length,
        assembled_context_message_count: assembledRequestMessages.length,
        promoted_video_url_count: promotedRequest.events.filter((event) => event.status === "promoted").length,
        skipped_video_url_count: promotedRequest.events.filter((event) => event.status === "skipped").length,
        memory_context_loaded: Boolean(resolvedMemoryContext || memoryContext),
        moderator_directive_used: Boolean(moderatorDirective),
        zdr_required: requireZdr,
      },
    });

    if (caps?.hasImageGeneration) {
      const promptMessage = requestMessages[requestMessages.length - 1];
      await deps.runAutonomousImageTurn({
        ctx,
        sessionId,
        userId,
        chatId,
        messageId,
        jobId,
        modelId: participant.modelId,
        participantId: participant.participantId,
        personaId: participant.personaId,
        requestMessages,
        prompt: autonomousImagePromptText(promptMessage?.content ?? ""),
        apiKey,
        maxInputReferences: caps.imageCapabilities?.maxInputReferences,
        imageConfig,
        supportedParameters: caps.imageCapabilities?.supportedParameters,
        requireZdr,
        generationStartedAt,
        now: deps.now,
        executionEpoch,
        executionAttemptId,
        executionFence,
      });
      return { kind: "completed", messageId };
    }

    const result = await deps.callOpenRouterStreaming(
      apiKey,
      participant.modelId,
      requestMessages,
      gatedParams,
      {
        onDelta: async (delta) => {
          await writer.handleContentDeltaBoundary(delta.length);
          await writer.appendContent(delta);
          await writer.patchContentIfNeeded();
        },
        onReasoningDelta: async (delta) => {
          await writer.appendReasoning(delta);
          await writer.patchReasoningIfNeeded(writer.hasSeenContentDelta);
        },
      },
      {
        emptyStreamRetries: 2,
        emptyStreamBackoffs: EMPTY_STREAM_RETRY_DELAYS,
        fallbackModel: undefined,
      },
    );

    await assertTurnStillActive();

    await writer.flush();

    await assertTurnStillActive();
    totalReasoning = writer.totalReasoning;

    const finalContent = result.content.trim();
    if (!finalContent && result.reasoning) {
      await finalizeTransientTurnFailure(ctx, {
        messageId,
        jobId,
        chatId,
        userId,
        reason: "Model returned reasoning only without a visible response.",
      });
      await captureAssistantResponseFailure(ctx, {
        userId,
        chatId: String(chatId),
        messageId: String(messageId),
        jobId: String(jobId),
        modelId: participant.modelId,
        source: "autonomous_discussion",
        error: new Error("Model returned reasoning only without a visible response."),
        properties: {
          autonomous_session_id: String(sessionId),
          participant_id: String(participant.participantId),
          persona_id: participant.personaId ? String(participant.personaId) : null,
          duration_ms: deps.now() - generationStartedAt,
        },
      });
      return {
        kind: "failed",
        reason: "Model returned reasoning only without a visible response.",
      };
    } else if (!finalContent && result.imageUrls.length === 0) {
      await finalizeTransientTurnFailure(ctx, {
        messageId,
        jobId,
        chatId,
        userId,
        reason: "Model returned an empty response after retries.",
      });
      await captureAssistantResponseFailure(ctx, {
        userId,
        chatId: String(chatId),
        messageId: String(messageId),
        jobId: String(jobId),
        modelId: participant.modelId,
        source: "autonomous_discussion",
        error: new Error("Model returned an empty response after retries."),
        properties: {
          autonomous_session_id: String(sessionId),
          participant_id: String(participant.participantId),
          persona_id: participant.personaId ? String(participant.personaId) : null,
          duration_ms: deps.now() - generationStartedAt,
        },
      });
      return {
        kind: "failed",
        reason: "Model returned an empty response after retries.",
      };
    }

    await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
      messageId,
      jobId,
      chatId,
      content: finalContent,
      status: "completed",
      usage: result.usage ?? undefined,
      reasoning: result.reasoning || totalReasoning || undefined,
      imageUrls: result.imageUrls.length > 0 ? result.imageUrls : undefined,
      userId,
      ...executionToken,
      skipExecutionTerminalization: true,
    });

    await captureAssistantResponseCompleted(ctx, {
      userId,
      chatId: String(chatId),
      messageId: String(messageId),
      jobId: String(jobId),
      modelId: participant.modelId,
      source: "autonomous_discussion",
      usage: result.usage,
      durationMs: deps.now() - generationStartedAt,
      participantCount: 1,
      openrouterGenerationId: result.generationId,
      properties: {
        autonomous_session_id: String(sessionId),
        participant_id: String(participant.participantId),
        persona_id: participant.personaId ? String(participant.personaId) : null,
        image_count: result.imageUrls.length,
        reasoning_present: Boolean(result.reasoning || totalReasoning),
        web_search_enabled: webSearchEnabled,
      },
    });

    return { kind: "completed", messageId };
  } catch (error) {
    if (isCancelledTurnError(error)) {
      await markTurnCancelled();
      if (messageId && jobId) {
        await captureAssistantResponseFailure(ctx, {
          userId,
          chatId: String(chatId),
          messageId: String(messageId),
          jobId: String(jobId),
          modelId: participant.modelId,
          source: imageTerminalAnalytics?.source ?? "autonomous_discussion",
          cancelled: true,
          properties: {
            ...imageTerminalAnalytics?.properties,
            autonomous_session_id: String(sessionId),
            participant_id: String(participant.participantId),
            persona_id: participant.personaId ? String(participant.personaId) : null,
          },
        });
      }
      return { kind: "cancelled" };
    }

    if (messageId && jobId) {
      const reason = normalizeGenerationError(error).message;
      await finalizeTransientTurnFailure(ctx, {
        messageId,
        jobId,
        chatId,
        userId,
        reason,
      });
      await captureAssistantResponseFailure(ctx, {
        userId,
        chatId: String(chatId),
        messageId: String(messageId),
        jobId: String(jobId),
        modelId: participant.modelId,
        source: imageTerminalAnalytics?.source ?? "autonomous_discussion",
        error,
        properties: {
          ...imageTerminalAnalytics?.properties,
          autonomous_session_id: String(sessionId),
          participant_id: String(participant.participantId),
          persona_id: participant.personaId ? String(participant.personaId) : null,
        },
      });
    } else {
      await cleanupTransientTurnEntities(ctx, messageId, jobId);
    }

    return {
      kind: "failed",
      reason: normalizeGenerationError(error).message,
    };
  }
}
