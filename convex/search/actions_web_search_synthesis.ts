import { ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { ActionCtx } from "../_generated/server";
import {
  callOpenRouterStreaming,
  ChatRequestParameters,
  gateParameters,
} from "../lib/openrouter";
import { buildRequestMessages } from "../chat/helpers";
import { GenerationCancelledError } from "../chat/generation_helpers";
import { clampMessageContent } from "../chat/action_image_helpers";
import { StreamWriter } from "../chat/stream_writer";
import {
  buildSearchSynthesisPrompt,
  CITATION_SYSTEM_PROMPT_SUFFIX,
  SEARCH_TRANSFORMS,
  SearchResult,
} from "./helpers";
import { WebSearchActionArgs } from "./actions_web_search_shared";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import {
  assertModelSupportsZdr,
  isZdrEnabled,
  withZdrProvider,
} from "../lib/openrouter_zdr";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";
import {
  captureAssistantResponseCompleted,
  captureAssistantResponseFailure,
  captureAssistantResponseStartedEvent,
} from "../chat/generation_analytics";
import { markGenerationJobAnalyticsStarted } from "../chat/generation_start_guard";

function createStreamWriter(
  args: ConstructorParameters<typeof StreamWriter>[0],
): StreamWriter {
  return new StreamWriter(args);
}

const defaultSearchSynthesisDeps = {
  callOpenRouterStreaming,
  gateParameters,
  buildRequestMessages,
  clampMessageContent,
  getRequiredUserOpenRouterApiKey,
  createStreamWriter,
};

export type SearchSynthesisDeps = typeof defaultSearchSynthesisDeps;

export function createSearchSynthesisDepsForTest(
  overrides: DeepPartial<SearchSynthesisDeps> = {},
): SearchSynthesisDeps {
  return mergeTestDeps(defaultSearchSynthesisDeps, overrides);
}

export async function synthesizeWithStreaming(
  ctx: ActionCtx,
  args: WebSearchActionArgs,
  searchResults: SearchResult[],
  deps: SearchSynthesisDeps = defaultSearchSynthesisDeps,
): Promise<void> {
  const [apiKey, preferences] = await Promise.all([
    deps.getRequiredUserOpenRouterApiKey(ctx, args.userId),
    ctx.runQuery(internal.chat.queries.getUserPreferences, {
      userId: args.userId,
    }),
  ]);
  const requireZdr = isZdrEnabled(preferences);
  const allMessages = await ctx.runQuery(
    internal.chat.queries.listAllMessages,
    { chatId: args.chatId },
  );

  let systemPrompt = args.systemPrompt;
  if (!systemPrompt && args.personaId) {
    const persona = await ctx.runQuery(internal.chat.queries.getPersona, {
      personaId: args.personaId,
      userId: args.userId,
    });
    if (persona) {
      systemPrompt = persona.systemPrompt;
    }
  }

  const searchSynthesis = buildSearchSynthesisPrompt(searchResults);
  const effectiveSystemPrompt = systemPrompt
    ? `${systemPrompt}\n\n${searchSynthesis}${CITATION_SYSTEM_PROMPT_SUFFIX}`
    : `${searchSynthesis}${CITATION_SYSTEM_PROMPT_SUFFIX}`;

  const requestMessages = deps.buildRequestMessages({
    messages: allMessages,
    excludeMessageId: args.assistantMessageId,
    systemPrompt: effectiveSystemPrompt,
    memoryContext: undefined,
    expandMultiModelGroups: args.expandMultiModelGroups,
    maxContextTokens: 75_000,
  });

  if (requestMessages.length === 0) {
    throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: "No request messages for synthesis" });
  }

  const caps = await ctx.runQuery(internal.chat.queries.getModelCapabilities, {
    modelId: args.modelId,
  });
  if (requireZdr) {
    assertModelSupportsZdr({
      modelId: args.modelId,
      capabilities: caps,
      feature: "Search synthesis",
    });
  }

  const rawParams: ChatRequestParameters = {
    temperature: args.temperature ?? 0.7,
    maxTokens: args.maxTokens ?? null,
    includeReasoning: args.includeReasoning ?? null,
    reasoningEffort: args.reasoningEffort ?? null,
    transforms: SEARCH_TRANSFORMS,
    webSearchEnabled: false,
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

  const writer = deps.createStreamWriter({
    ctx,
    messageId: args.assistantMessageId,
    transformContent: deps.clampMessageContent,
  });
  let deltaEventsSinceCancelCheck = 0;
  const generationStartedAt = Date.now();

  let shouldCaptureStarted = false;
  try {
    shouldCaptureStarted = await markGenerationJobAnalyticsStarted(ctx, args.jobId);
  } catch (error) {
    console.warn("[analytics] failed to mark web search synthesis analytics start", {
      jobId: args.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    shouldCaptureStarted = true;
  }
  if (!shouldCaptureStarted) {
    return;
  }
  await captureAssistantResponseStartedEvent(ctx, {
    userId: args.userId,
    chatId: String(args.chatId),
    messageId: String(args.assistantMessageId),
    jobId: String(args.jobId),
    modelId: args.modelId,
    source: args.analyticsSource ?? "web_search",
    participantCount: 1,
    webSearchEnabled: false,
    properties: {
      search_session_id: String(args.sessionId),
      search_result_count: searchResults.length,
      request_message_count: requestMessages.length,
      legacy_streaming_synthesis: true,
      zdr_required: requireZdr,
    },
  });

  try {
    const result = await deps.callOpenRouterStreaming(
      apiKey,
      args.modelId,
      requestMessages,
      gatedParams,
      {
        onDelta: async (delta) => {
          await writer.handleContentDeltaBoundary(delta.length);
          await writer.appendContent(delta);
          await writer.patchContentIfNeeded();

          deltaEventsSinceCancelCheck += 1;
          if (deltaEventsSinceCancelCheck % 10 === 0) {
            const cancelled = await ctx.runQuery(
              internal.chat.queries.isJobCancelled,
              { jobId: args.jobId },
            );
            if (cancelled) throw new GenerationCancelledError();
          }
        },
        onReasoningDelta: async (delta) => {
          await writer.appendReasoning(delta);
          await writer.patchReasoningIfNeeded(writer.hasSeenContentDelta);
        },
      },
      { emptyStreamRetries: 2, emptyStreamBackoffs: [500, 1500] },
    );

    await writer.flush();

    let finalContent = writer.totalContent.trim();
    if (!finalContent && (result.reasoning || writer.totalReasoning)) {
      finalContent = "Model returned reasoning only.";
    } else if (!finalContent) {
      finalContent = "[No response received from model]";
    }
    finalContent = deps.clampMessageContent(finalContent);

    await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
      messageId: args.assistantMessageId,
      jobId: args.jobId,
      chatId: args.chatId,
      content: finalContent,
      status: "completed",
      usage: result.usage ?? undefined,
      reasoning: result.reasoning || writer.totalReasoning || undefined,
      userId: args.userId,
    });

    await captureAssistantResponseCompleted(ctx, {
      userId: args.userId,
      chatId: String(args.chatId),
      messageId: String(args.assistantMessageId),
      jobId: String(args.jobId),
      modelId: args.modelId,
      source: args.analyticsSource ?? "web_search",
      usage: result.usage,
      durationMs: Date.now() - generationStartedAt,
      participantCount: 1,
      openrouterGenerationId: result.generationId,
      properties: {
        search_session_id: String(args.sessionId),
        search_result_count: searchResults.length,
        request_message_count: requestMessages.length,
        legacy_streaming_synthesis: true,
      },
    });
  } catch (error) {
    await captureAssistantResponseFailure(ctx, {
      userId: args.userId,
      chatId: String(args.chatId),
      messageId: String(args.assistantMessageId),
      jobId: String(args.jobId),
      modelId: args.modelId,
      source: args.analyticsSource ?? "web_search",
      error,
      cancelled: error instanceof GenerationCancelledError,
      properties: {
        search_session_id: String(args.sessionId),
        search_result_count: searchResults.length,
        request_message_count: requestMessages.length,
        legacy_streaming_synthesis: true,
      },
    });
    throw error;
  }
}
