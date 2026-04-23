import { ConvexError } from "convex/values";
import {
  HTTP_REFERER,
  MAX_RATE_LIMIT_RETRIES,
  OPENROUTER_API_URL,
  REQUEST_TIMEOUT_MS,
  rateLimitDelayMs,
  sleep,
  X_TITLE,
} from "./openrouter_constants";
import { extractErrorMessage } from "./openrouter_error";
import {
  extractContentFromNonStreamingPayload,
} from "./openrouter_sse";
import { buildRequestBody } from "./openrouter_request";
import {
  normalizeUnsupportedParameterName,
  parseUnsupportedParameter,
  stripParameter,
} from "./openrouter_param_retry";
import {
  ChatRequestParameters,
  NonStreamResult,
  OpenRouterMessage,
  RetryConfig,
} from "./openrouter_types";
import { DeepPartial, mergeTestDeps } from "./test_deps";

const defaultOpenRouterNonStreamingDeps = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  sleep,
  buildRequestBody,
  extractErrorMessage,
  extractContentFromNonStreamingPayload,
  normalizeUnsupportedParameterName,
  parseUnsupportedParameter,
  stripParameter,
};

export type OpenRouterNonStreamingDeps = typeof defaultOpenRouterNonStreamingDeps;

export function createOpenRouterNonStreamingDepsForTest(
  overrides: DeepPartial<OpenRouterNonStreamingDeps> = {},
): OpenRouterNonStreamingDeps {
  return mergeTestDeps(defaultOpenRouterNonStreamingDeps, overrides);
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
  const { fallbackModel, retryOnUnsupportedParam = true } = retryConfig;

  let currentParams = { ...params };
  let currentModel = model;
  const strippedParams = new Set<string>();
  const maxUnsupportedParamRetries = 6;
  let rateLimitRetries = 0;
  const startTime = Date.now();
  const msgCount = messages.length;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const body = deps.buildRequestBody(
      currentModel,
      messages,
      currentParams,
      false,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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

        // Fallback model
        if (fallbackModel && currentModel !== fallbackModel) {
          currentModel = fallbackModel;
          strippedParams.clear();
          rateLimitRetries = 0;
          continue;
        }

        console.error("[openrouter:nonstream] HTTP error", {
          model: currentModel, status: response.status, durationMs: Date.now() - startTime,
          msgCount, error: errorMessage,
        });
        throw new ConvexError({
          code: "INTERNAL_ERROR" as const,
          message: `OpenRouter API error (${response.status}): ${errorMessage}`,
        });
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
          continue;
        }
        console.error("[openrouter:nonstream] 200-wrapped error", {
          model: currentModel, durationMs: Date.now() - startTime, msgCount,
          error: errorMessage,
        });
        throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: `OpenRouter API error (200-wrapped): ${errorMessage}` });
      }

      const extracted = deps.extractContentFromNonStreamingPayload(parsed);
      const result: NonStreamResult = {
        content: extracted.content,
        usage: extracted.usage,
        finishReason: extracted.finishReason,
        audioBase64: extracted.audioBase64,
        audioTranscript: extracted.audioTranscript,
        generationId: typeof parsed.id === "string" && parsed.id.length > 0 ? parsed.id : null,
      };

      const durationMs = Date.now() - startTime;
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
          model: currentModel, timeoutMs: REQUEST_TIMEOUT_MS, durationMs: Date.now() - startTime, msgCount,
        });
        // Keep as plain Error so callers with retry loops can inspect and retry
        const abortMsg = `OpenRouter non-stream timeout after ${REQUEST_TIMEOUT_MS}ms for model ${currentModel}${cause ? `: ${cause}` : ""}`;
        throw new Error(abortMsg);
      }
      if (errMessage === "fetch failed") {
        console.error("[openrouter:nonstream] fetch failed", {
          model: currentModel, error: errMessage, ...(cause ? { cause } : {}),
          durationMs: Date.now() - startTime, msgCount,
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
