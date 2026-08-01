import { ConvexError } from "convex/values";
import { HTTP_REFERER, X_TITLE } from "./openrouter_constants";
import { extractErrorMessage, openRouterErrorDetails } from "./openrouter_error";
import { buildPersonaAdvisorTool } from "./openrouter_advisor";
import { processAdvisorSSEBody, processAdvisorSSEText } from "./openrouter_responses_sse";
import type {
  AdvisorResponsesCallbacks,
  AdvisorResponsesOptions,
  AdvisorResponsesResult,
} from "./openrouter_responses_types";
import {
  cancellationWasRequested,
  OpenRouterTransportCancelledError,
  watchForCancellation,
} from "./openrouter_cancellation";
import { mergeTestDeps, type DeepPartial } from "./test_deps";

const OPENROUTER_RESPONSES_URL = "https://openrouter.ai/api/v1/responses";

const defaultResponsesDeps = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  processBody: processAdvisorSSEBody,
  processText: processAdvisorSSEText,
  now: () => Date.now(),
};

export type OpenRouterResponsesDeps = typeof defaultResponsesDeps;

export function createOpenRouterResponsesDepsForTest(
  overrides: DeepPartial<OpenRouterResponsesDeps> = {},
): OpenRouterResponsesDeps {
  return mergeTestDeps(defaultResponsesDeps, overrides);
}

export function buildAdvisorResponsesBody(options: AdvisorResponsesOptions): Record<string, unknown> {
  return {
    model: options.dispatcherModel,
    instructions:
      "Invoke the provided Advisor exactly once. Do not answer independently. " +
      "After the Advisor returns, emit no additional substantive prose.",
    input: options.input,
    tools: [buildPersonaAdvisorTool({
      instanceName: options.instanceName,
      model: options.advisorModel,
      instructions: options.advisorInstructions,
      maxCompletionTokens: options.maxCompletionTokens,
      temperature: options.temperature,
      reasoningEffort: options.reasoningEffort,
      allowWebSearch: options.allowWebSearch,
    })],
    tool_choice: "required",
    max_tool_calls: 1,
    stream: true,
  };
}

export async function callOpenRouterAdvisorResponses(
  apiKey: string,
  options: AdvisorResponsesOptions,
  callbacks: AdvisorResponsesCallbacks = {},
  deps: OpenRouterResponsesDeps = defaultResponsesDeps,
): Promise<AdvisorResponsesResult> {
  if (await cancellationWasRequested(options.isCancelled)) {
    throw new OpenRouterTransportCancelledError();
  }
  const controller = new AbortController();
  const startedAt = deps.now();
  let timeoutReason: "idle" | "absolute" | undefined;
  let cancellationTriggered = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timeoutReason = "idle";
      controller.abort();
    }, options.idleTimeoutMs);
    callbacks.onActivity?.();
  };
  resetIdle();
  const absoluteTimer = setTimeout(() => {
    timeoutReason = "absolute";
    controller.abort();
  }, options.absoluteTimeoutMs);
  const stopCancellationWatch = watchForCancellation({
    isCancelled: options.isCancelled,
    pollIntervalMs: options.cancellationPollIntervalMs,
    onCancelled: () => {
      if (controller.signal.aborted) return;
      cancellationTriggered = true;
      controller.abort();
    },
  });

  try {
    const response = await deps.fetch(OPENROUTER_RESPONSES_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "HTTP-Referer": HTTP_REFERER,
        "X-Title": X_TITLE,
      },
      body: JSON.stringify(buildAdvisorResponsesBody(options)),
      signal: controller.signal,
    });
    resetIdle();
    if (!response.ok) {
      const raw = await response.text();
      throw new ConvexError(openRouterErrorDetails(response.status, extractErrorMessage(raw)));
    }

    const streamState = response.body
      ? await deps.processBody(response.body, {
          ...callbacks,
          onActivity: resetIdle,
        })
      : await deps.processText(await response.text(), callbacks);

    if (streamState.error) {
      throw new ConvexError({
        code: "INTERNAL_ERROR",
        message: "OpenRouter response streaming failed. Please try again.",
      });
    }
    const item = streamState.completedItem;
    const advice = (item?.advice ?? streamState.advice).trim();
    if (!item || !advice) {
      throw new ConvexError({
        code: "INTERNAL_ERROR",
        message: "OpenRouter Advisor completed without an advice item.",
      });
    }

    return {
      advice,
      actualModelId: item.model,
      responseId: streamState.responseId,
      outputItemId: item.id,
      replayItems: [item],
      usage: streamState.usage,
    };
  } catch (error) {
    if (cancellationTriggered) {
      throw new OpenRouterTransportCancelledError();
    }
    const shape = error as { name?: unknown };
    if (shape?.name === "AbortError" || timeoutReason) {
      throw new ConvexError({
        code: "ADVISOR_TIMEOUT",
        message: `Advisor consultation ${timeoutReason ?? "request"} timed out after ${deps.now() - startedAt}ms.`,
      });
    }
    throw error;
  } finally {
    stopCancellationWatch();
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(absoluteTimer);
  }
}
