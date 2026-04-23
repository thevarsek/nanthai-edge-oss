import { ConvexError } from "convex/values";
import {
  HTTP_REFERER,
  MAX_RATE_LIMIT_RETRIES,
  OPENROUTER_API_URL,
  STREAM_REQUEST_TIMEOUT_MS,
  rateLimitDelayMs,
  sleep,
  X_TITLE,
} from "./openrouter_constants";
import { extractErrorMessage } from "./openrouter_error";
import { buildRequestBody } from "./openrouter_request";
import {
  normalizeUnsupportedParameterName,
  parseUnsupportedParameter,
  stripParameter,
} from "./openrouter_param_retry";
import { processSSEBodyStream, processSSETextStream } from "./openrouter_sse";
import {
  ChatRequestParameters,
  OnDelta,
  OnReasoningDelta,
  OpenRouterMessage,
  RetryConfig,
  StreamResult,
} from "./openrouter_types";
import { DeepPartial, mergeTestDeps } from "./test_deps";

const defaultOpenRouterStreamingDeps = {
  fetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  sleep,
  buildRequestBody,
  extractErrorMessage,
  normalizeUnsupportedParameterName,
  parseUnsupportedParameter,
  processSSEBodyStream,
  processSSETextStream,
  stripParameter,
};

export type OpenRouterStreamingDeps = typeof defaultOpenRouterStreamingDeps;

export function createOpenRouterStreamingDepsForTest(
  overrides: DeepPartial<OpenRouterStreamingDeps> = {},
): OpenRouterStreamingDeps {
  return mergeTestDeps(defaultOpenRouterStreamingDeps, overrides);
}

/**
 * Call OpenRouter with streaming. Processes SSE events and invokes callbacks.
 *
 * This is the single entry point for all streaming LLM calls.
 * Handles unsupported parameter retry and returns accumulated result.
 */
export async function callOpenRouterStreaming(
  apiKey: string,
  model: string,
  messages: OpenRouterMessage[],
  params: ChatRequestParameters,
  callbacks: {
    onDelta?: OnDelta;
    onReasoningDelta?: OnReasoningDelta;
    onToolCallStart?: (toolCall: { index: number; id: string; name: string }) => Promise<void>;
    onGenerationId?: (generationId: string) => Promise<void>;
  },
  retryConfig: RetryConfig = {},
  deps: OpenRouterStreamingDeps = defaultOpenRouterStreamingDeps,
): Promise<StreamResult> {
  const {
    emptyStreamRetries = 2,
    emptyStreamBackoffs = [500, 1500],
    fallbackModel,
    retryOnUnsupportedParam = true,
    networkRetries = 1,
    networkRetryDelayMs = 2000,
  } = retryConfig;

  let currentParams = { ...params };
  let currentModel = model;
  let attempt = 0;
  let networkAttempt = 0;
  const startTime = Date.now();
  const msgCount = messages.length;

  while (attempt <= emptyStreamRetries) {
    try {
      const result = await streamOnce(
        apiKey,
        currentModel,
        messages,
        currentParams,
        callbacks,
        retryOnUnsupportedParam && attempt === 0,
        deps,
      );

      // Check for empty response
      if (
        !result.content &&
        !result.reasoning &&
        !result.audioBase64 &&
        !result.audioTranscript &&
        result.imageUrls.length === 0 &&
        result.toolCalls.length === 0
      ) {
        if (attempt < emptyStreamRetries) {
          const delay = emptyStreamBackoffs[attempt] ?? 1500;
          console.warn("[openrouter:stream] empty response, retrying", {
            model: currentModel, attempt: attempt + 1, delayMs: delay, msgCount,
          });
          await deps.sleep(delay);
          attempt++;
          continue;
        }

        // All retries exhausted — try fallback model if configured
        if (fallbackModel && currentModel !== fallbackModel) {
          currentModel = fallbackModel;
          attempt = 0;
          continue;
        }

        console.error("[openrouter:stream] all retries exhausted, returning empty", {
          model: currentModel, attempts: attempt + 1, durationMs: Date.now() - startTime, msgCount,
        });
        return result;
      }

      const durationMs = Date.now() - startTime;
      console.info("[openrouter:stream] success", {
        model: currentModel, durationMs, msgCount,
        contentLen: result.content?.length ?? 0,
        reasoningLen: result.reasoning?.length ?? 0,
        usage: result.usage,
        finishReason: result.finishReason,
        generationId: result.generationId,
      });
      return result;
    } catch (error) {
      // Re-throw ConvexError as-is (don't wrap structured errors)
      if (error instanceof ConvexError) throw error;
      const durationMs = Date.now() - startTime;
      // Structural shape-reading so we classify non-Error thrown values
      // (DOMException, Convex-wrapped aborts, etc.) the same as Error.
      const errObj = (error ?? {}) as {
        name?: unknown;
        message?: unknown;
        cause?: unknown;
      };
      const errName = typeof errObj.name === "string" ? errObj.name : undefined;
      const errMessage =
        typeof errObj.message === "string" ? errObj.message : undefined;
      const errMsg = errMessage ?? errName ?? String(error);
      const cause = errObj.cause != null ? String(errObj.cause) : undefined;
      const isTimeout =
        errName === "AbortError" || errMsg.toLowerCase().includes("timeout");
      const isTransientNetwork = isTransientNetworkError(errMsg, cause);
      console.error("[openrouter:stream] error", {
        model: currentModel, attempt: attempt + 1, durationMs, msgCount,
        error: errMsg,
        ...(cause ? { cause } : {}),
        ...(isTimeout ? { isTimeout: true } : {}),
        ...(isTransientNetwork ? { isTransientNetwork: true } : {}),
      });

      // Retry transient network errors (socket closed, connection reset, etc.)
      if (isTransientNetwork && networkAttempt < networkRetries) {
        networkAttempt++;
        console.warn("[openrouter:stream] transient network error, retrying", {
          model: currentModel, networkAttempt, maxNetworkRetries: networkRetries,
          delayMs: networkRetryDelayMs,
        });
        await deps.sleep(networkRetryDelayMs);
        continue;
      }

      // On final attempt or non-retryable error, try fallback model
      if (
        fallbackModel &&
        currentModel !== fallbackModel &&
        attempt >= emptyStreamRetries
      ) {
        currentModel = fallbackModel;
        attempt = 0;
        networkAttempt = 0;
        continue;
      }
      throw error;
    }
  }

  // Should not reach here, but return empty result as safety
  console.error("[openrouter:stream] reached safety return (should not happen)", {
    model: currentModel, durationMs: Date.now() - startTime, msgCount,
  });
  return {
    content: "",
    reasoning: "",
    usage: null,
    finishReason: null,
    imageUrls: [],
    audioBase64: "",
    audioTranscript: "",
    toolCalls: [],
    generationId: null,
    annotations: [],
  };
}

/**
 * Single streaming attempt. Handles SSE parsing and unsupported param retry.
 */
async function streamOnce(
  apiKey: string,
  model: string,
  messages: OpenRouterMessage[],
  params: ChatRequestParameters,
  callbacks: {
    onDelta?: OnDelta;
    onReasoningDelta?: OnReasoningDelta;
    onToolCallStart?: (toolCall: { index: number; id: string; name: string }) => Promise<void>;
    onGenerationId?: (generationId: string) => Promise<void>;
  },
  retryOnUnsupportedParam: boolean,
  deps: OpenRouterStreamingDeps,
): Promise<StreamResult> {
  let currentParams = { ...params };
  const strippedParams = new Set<string>();
  const maxUnsupportedParamRetries = 6;
  let rateLimitRetries = 0;
  // 404 "No endpoints found" fallback: retry once with all provider routing
  // stripped. See the 404 handler below for rationale.
  let strippedProviderOnce = false;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const body = deps.buildRequestBody(
      model,
      messages,
      currentParams,
      true,
      strippedProviderOnce,
    );

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const resetTimeout = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(
        () => controller.abort(),
        STREAM_REQUEST_TIMEOUT_MS,
      );
    };
    resetTimeout();

    try {
      // Phase 1 instrumentation: OpenRouter TTFB sub-timings to split the
      // ~10s black box into (a) time-to-headers and (b) time-to-first-SSE-delta.
      const fetchStartedAt = Date.now();
      const response = await deps.fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": HTTP_REFERER,
          "X-Title": X_TITLE,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const headersReceivedAt = Date.now();
      const openrouterHeadersMs = headersReceivedAt - fetchStartedAt;

      // Handle non-2xx responses
      if (!response.ok) {
        const errorText = await response.text();
        const errorMessage = deps.extractErrorMessage(errorText);

        // Phase 1 instrumentation: surface header timing on the error path too
        // so slow provider errors are visible alongside successful requests.
        console.warn("[openrouter:stream] non-2xx response", {
          model,
          status: response.status,
          openrouterHeadersMs,
        });

        if (
          response.status === 429 &&
          rateLimitRetries < MAX_RATE_LIMIT_RETRIES
        ) {
          const delayMs = rateLimitDelayMs(
            response.headers.get("retry-after"),
            rateLimitRetries,
          );
          rateLimitRetries += 1;
          console.warn("[openrouter:stream] rate limited, retrying", {
            model, retry: rateLimitRetries, delayMs, status: response.status,
          });
          await deps.sleep(delayMs);
          continue;
        }

        // Unsupported parameter retry
        if (response.status === 400 && retryOnUnsupportedParam) {
          const paramName =
            deps.parseUnsupportedParameter(errorText) ??
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
              continue; // Retry with stripped parameter
            }
          }
        }

        // 404 "No endpoints found" retry — strip all provider routing hints
        // and try once more. OpenRouter returns this when the combination of
        // top-level `cache_control`, provider-sort defaults, caller-supplied
        // `provider` fields (ZDR, order, etc.), and current provider health
        // leaves zero viable endpoints. Stripping the `provider` block and
        // letting OpenRouter auto-route is the safest recovery that still
        // preserves `cache_control` (which lives outside the provider block).
        if (
          response.status === 404 &&
          !strippedProviderOnce &&
          /no endpoints found/i.test(errorMessage + " " + errorText)
        ) {
          console.warn("[openrouter:stream] 404 no endpoints — retrying without provider routing", {
            model,
            hadCallerProvider: currentParams.provider != null,
          });
          strippedProviderOnce = true;
          continue;
        }

        throw new ConvexError({
          code: "INTERNAL_ERROR" as const,
          message: `OpenRouter API error (${response.status}): ${errorMessage}`,
        });
      }

      // Process SSE stream and stop as soon as [DONE] arrives instead of
      // waiting for the transport socket to close.
      if (response.body) {
        // Phase 1 instrumentation: log the first SSE activity so we can split
        // OpenRouter TTFB into (headers) vs (first delta after headers).
        let firstActivityAt: number | null = null;
        const logFirstActivityOnce = () => {
          if (firstActivityAt !== null) return;
          firstActivityAt = Date.now();
          console.info("[openrouter:stream] first SSE chunk", {
            model,
            openrouterHeadersMs,
            openrouterFirstSseMs: firstActivityAt - headersReceivedAt,
            openrouterTotalToFirstChunkMs: firstActivityAt - fetchStartedAt,
          });
        };
        const refreshOnStreamActivity = {
          onDelta: callbacks.onDelta
            ? async (delta: string) => {
              logFirstActivityOnce();
              resetTimeout();
              await callbacks.onDelta?.(delta);
            }
            : undefined,
          onReasoningDelta: callbacks.onReasoningDelta
            ? async (delta: string) => {
              logFirstActivityOnce();
              resetTimeout();
              await callbacks.onReasoningDelta?.(delta);
            }
            : undefined,
          onToolCallStart: callbacks.onToolCallStart
            ? async (toolCall: { index: number; id: string; name: string }) => {
              logFirstActivityOnce();
              resetTimeout();
              await callbacks.onToolCallStart?.(toolCall);
            }
            : undefined,
          onGenerationId: callbacks.onGenerationId
            ? async (generationId: string) => {
              logFirstActivityOnce();
              resetTimeout();
              await callbacks.onGenerationId?.(generationId);
            }
            : undefined,
        };
        return await deps.processSSEBodyStream(
          response.body,
          refreshOnStreamActivity,
          () => {
            logFirstActivityOnce();
            resetTimeout();
          },
        );
      }

      // Fallback for environments without a readable body stream.
      const text = await response.text();
      return deps.processSSETextStream(text, callbacks);
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
        console.error("[openrouter:stream:once] timeout", {
          model, timeoutMs: STREAM_REQUEST_TIMEOUT_MS, rateLimitRetries,
        });
        // Re-throw as a regular Error so the caller's retry logic can inspect it
        const abortMsg = `OpenRouter stream timeout after ${STREAM_REQUEST_TIMEOUT_MS}ms for model ${model}${cause ? `: ${cause}` : ""}`;
        throw new Error(abortMsg);
      }
      if (errMessage === "fetch failed") {
        console.error("[openrouter:stream:once] fetch failed", {
          model, error: errMessage, ...(cause ? { cause } : {}), rateLimitRetries,
        });
        // Re-throw as a regular Error so the caller's retry logic can inspect it
        const fetchMsg = `OpenRouter fetch failed for model ${model}${cause ? `: ${cause}` : ""}`;
        const fetchErr = new Error(fetchMsg);
        (fetchErr as NodeJS.ErrnoException).cause = cause;
        throw fetchErr;
      }
      throw error;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detect transient network errors that are safe to retry — the remote side
 * closed the connection, the socket was reset, or the fetch failed due to a
 * network-level issue (not an HTTP error).
 *
 * Includes OpenRouter edge-proxy error strings: OpenRouter's gateway is
 * built on Rust/reqwest+hyper, and when an upstream provider connection
 * dies mid-response the gateway forwards a 200 OK whose body then errors
 * out partway through with one of the strings below. These are virtually
 * always safe to retry against the same provider.
 */
function isTransientNetworkError(
  message: string,
  cause: string | undefined,
): boolean {
  const patterns = [
    "other side closed",
    "terminated",
    "ECONNRESET",
    "EPIPE",
    "socket hang up",
    "network socket disconnected",
    "fetch failed",
    // OpenRouter edge (reqwest/hyper) — upstream stream cut mid-body
    "error decoding response body",
    "unexpected eof",
    "connection closed before message completed",
  ];
  const haystack = `${message} ${cause ?? ""}`.toLowerCase();
  return patterns.some((p) => haystack.includes(p.toLowerCase()));
}
