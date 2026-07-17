import { ConvexError } from "convex/values";
import { HTTP_REFERER, MAX_RATE_LIMIT_RETRIES, OPENROUTER_API_URL, rateLimitDelayMs, sleep, X_TITLE } from "./openrouter_constants";
import { extractErrorMessage, openRouterErrorDetails } from "./openrouter_error";
import { extractContentFromNonStreamingPayload } from "./openrouter_sse";
import { buildRequestBody } from "./openrouter_request";
import { normalizeUnsupportedParameterName, parseUnsupportedParameter, stripParameter } from "./openrouter_param_retry";
import { ChatRequestParameters, NonStreamResult, OpenRouterMessage, PerplexityAnnotation, RetryConfig } from "./openrouter_types";
import { DeepPartial, mergeTestDeps } from "./test_deps";
import { assertChatCompletionsRequest } from "./openrouter_modality";
import { assertRetryDelayFits, createNonStreamingDeadline, nextAttemptTimeoutMs } from "./openrouter_nonstream_deadline";

const defaultOpenRouterNonStreamingDeps = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  sleep,
  buildRequestBody,
  extractErrorMessage,
  extractContentFromNonStreamingPayload,
  normalizeUnsupportedParameterName,
  parseUnsupportedParameter,
  stripParameter,
  now: () => Date.now(),
};

export type OpenRouterNonStreamingDeps = typeof defaultOpenRouterNonStreamingDeps;

export function createOpenRouterNonStreamingDepsForTest(
  overrides: DeepPartial<OpenRouterNonStreamingDeps> = {},
): OpenRouterNonStreamingDeps {
  return mergeTestDeps(defaultOpenRouterNonStreamingDeps, overrides);
}

function extractAnnotationsFromPayload(
  parsed: Record<string, unknown>,
): PerplexityAnnotation[] {
  const choices = parsed.choices as
    | Array<{ message?: { annotations?: unknown[] } }>
    | undefined;
  const rawAnnotations = choices?.[0]?.message?.annotations;
  if (!Array.isArray(rawAnnotations)) return [];

  return rawAnnotations.filter((ann): ann is PerplexityAnnotation => {
    if (!ann || typeof ann !== "object") return false;
    const data = ann as Record<string, unknown>;
    const citation = data.url_citation as Record<string, unknown> | undefined;
    return data.type === "url_citation" && typeof citation?.url === "string";
  });
}

/**
 * Call OpenRouter without streaming (for title generation, etc.).
 */
export async function callOpenRouterNonStreaming(
  apiKey: string,
  model: string,
  messages: OpenRouterMessage[],
  params: ChatRequestParameters,
  retryConfig: RetryConfig = {},
  deps: OpenRouterNonStreamingDeps = defaultOpenRouterNonStreamingDeps,
): Promise<NonStreamResult> {
  assertChatCompletionsRequest(params);
  const { fallbackModel, retryOnUnsupportedParam = true } = retryConfig;
  const deadline = createNonStreamingDeadline(retryConfig, deps.now());
  const { startedAt: startTime } = deadline;

  let currentParams = { ...params };
  let currentModel = model;
  const strippedParams = new Set<string>();
  const maxUnsupportedParamRetries = 6;
  let rateLimitRetries = 0;
  // 404 "No endpoints found" fallback: retry once with soft provider routing
  // stripped. Hard privacy constraints (provider.zdr) are preserved by
  // buildRequestBody.
  let strippedProviderOnce = false;
  const msgCount = messages.length;

  while (true) {
    const attemptTimeoutMs = nextAttemptTimeoutMs(deadline, deps.now());
    const body = deps.buildRequestBody(
      currentModel,
      messages,
      currentParams,
      false,
      strippedProviderOnce,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);

    try {
      const response = await deps.fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": HTTP_REFERER,
          "X-Title": X_TITLE,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const responseText = await response.text();

      if (!response.ok) {
        const errorMessage = deps.extractErrorMessage(
          responseText,
        );

        if (
          response.status === 429 &&
          rateLimitRetries < MAX_RATE_LIMIT_RETRIES
        ) {
          const delayMs = rateLimitDelayMs(
            response.headers.get("retry-after"),
            rateLimitRetries,
          );
          rateLimitRetries += 1;
          console.warn("[openrouter:nonstream] rate limited, retrying", {
            model: currentModel, retry: rateLimitRetries, delayMs, status: response.status,
          });
          assertRetryDelayFits(deadline, delayMs, deps.now());
          await deps.sleep(delayMs);
          continue;
        }

        // Unsupported parameter retry
        if (response.status === 400 && retryOnUnsupportedParam) {
          const paramName =
            deps.parseUnsupportedParameter(responseText) ??
            deps.parseUnsupportedParameter(errorMessage);
          if (paramName) {
            const stripped = deps.stripParameter(
              paramName,
              currentParams,
            );
            const normalizedName = deps
              .normalizeUnsupportedParameterName(paramName);
            if (
              stripped &&
              !strippedParams.has(normalizedName) &&
              strippedParams.size < maxUnsupportedParamRetries
            ) {
              currentParams = stripped;
              strippedParams.add(normalizedName);
              continue;
            }
          }
        }

        // 404 "No endpoints found" retry — strip soft provider routing hints
        // and try once more. Keep hard privacy constraints such as provider.zdr.
        if (
          response.status === 404 &&
          !strippedProviderOnce &&
          /no endpoints found/i.test(errorMessage + " " + responseText)
        ) {
          console.warn("[openrouter:nonstream] 404 no endpoints — retrying without provider routing", {
            model: currentModel,
            hadCallerProvider: currentParams.provider != null,
          });
          strippedProviderOnce = true;
          continue;
        }

        // Fallback model
        if (fallbackModel && currentModel !== fallbackModel) {
          currentModel = fallbackModel;
          strippedParams.clear();
          rateLimitRetries = 0;
          strippedProviderOnce = false;
          continue;
        }

        console.error("[openrouter:nonstream] HTTP error", {
          model: currentModel, status: response.status, durationMs: deps.now() - startTime,
          msgCount, error: errorMessage,
        });
        throw new ConvexError(openRouterErrorDetails(response.status, errorMessage));
      }

      // Parse response
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(responseText);
      } catch {
        throw new ConvexError({
          code: "INTERNAL_ERROR" as const,
          message: `OpenRouter returned invalid JSON: ${responseText.slice(0, 200)}`,
        });
      }

      // Check for 200-wrapped error
      if (parsed.error) {
        const errorMessage = deps.extractErrorMessage(parsed);
        if (retryOnUnsupportedParam) {
          const paramName =
            deps.parseUnsupportedParameter(parsed) ??
            deps.parseUnsupportedParameter(errorMessage);
          if (paramName) {
            const stripped = deps.stripParameter(
              paramName,
              currentParams,
            );
            const normalizedName = deps
              .normalizeUnsupportedParameterName(paramName);
            if (
              stripped &&
              !strippedParams.has(normalizedName) &&
              strippedParams.size < maxUnsupportedParamRetries
            ) {
              currentParams = stripped;
              strippedParams.add(normalizedName);
              continue;
            }
          }
        }
        if (fallbackModel && currentModel !== fallbackModel) {
          currentModel = fallbackModel;
          strippedParams.clear();
          rateLimitRetries = 0;
          strippedProviderOnce = false;
          continue;
        }
        console.error("[openrouter:nonstream] 200-wrapped error", {
          model: currentModel, durationMs: deps.now() - startTime, msgCount,
          error: errorMessage,
        });
        throw new ConvexError(openRouterErrorDetails(200, errorMessage));
      }

      const extracted = deps.extractContentFromNonStreamingPayload(parsed);
      const result: NonStreamResult = {
        content: extracted.content,
        modelId: currentModel,
        usage: extracted.usage,
        finishReason: extracted.finishReason,
        audioBase64: extracted.audioBase64,
        audioTranscript: extracted.audioTranscript,
        generationId: typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : null,
        annotations: extractAnnotationsFromPayload(parsed),
      };

      const durationMs = deps.now() - startTime;
      console.info("[openrouter:nonstream] success", {
        model: currentModel, durationMs, msgCount,
        contentLen: result.content?.length ?? 0,
        usage: result.usage,
        finishReason: result.finishReason,
        generationId: result.generationId,
      });
      return result;
    } catch (error) {
      // Re-throw ConvexError as-is (don't wrap structured errors)
      if (error instanceof ConvexError) throw error;
      // Structural checks instead of `instanceof Error`: on the Convex Node
      // runtime, aborted fetches can surface as DOMException or other
      // non-Error objects where `instanceof Error` is false. We still need
      // to recognize them as AbortError / fetch failures by their shape.
      const errObj = (error ?? {}) as {
        name?: unknown;
        message?: unknown;
        cause?: unknown;
      };
      const errName = typeof errObj.name === "string" ? errObj.name : undefined;
      const errMessage =
        typeof errObj.message === "string" ? errObj.message : undefined;
      const cause = errObj.cause != null ? String(errObj.cause) : undefined;
      if (errName === "AbortError") {
        console.error("[openrouter:nonstream] timeout", {
          model: currentModel, timeoutMs: attemptTimeoutMs, durationMs: deps.now() - startTime, msgCount,
        });
        // Keep as plain Error so callers with retry loops can inspect and retry
        const abortMsg = `OpenRouter non-stream timeout after ${attemptTimeoutMs}ms for model ${currentModel}${cause ? `: ${cause}` : ""}`;
        throw new Error(abortMsg);
      }
      if (errMessage === "fetch failed") {
        console.error("[openrouter:nonstream] fetch failed", {
          model: currentModel, error: errMessage, ...(cause ? { cause } : {}),
          durationMs: deps.now() - startTime, msgCount,
        });
        // Keep as plain Error so callers with retry loops can inspect and retry
        const fetchMsg = `OpenRouter fetch failed for model ${currentModel}${cause ? `: ${cause}` : ""}`;
        const fetchErr = new Error(fetchMsg);
        (fetchErr as NodeJS.ErrnoException).cause = cause;
        throw fetchErr;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
