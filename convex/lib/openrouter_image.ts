import { ConvexError } from "convex/values";
import {
  HTTP_REFERER,
  MAX_RATE_LIMIT_RETRIES,
  REQUEST_TIMEOUT_MS,
  rateLimitDelayMs,
  X_TITLE,
} from "./openrouter_constants";
import { extractErrorMessage, openRouterErrorDetails } from "./openrouter_error";
import { usageFromUnknown } from "./openrouter_extract";
import type { OpenRouterUsage } from "./openrouter_types";
import {
  cancellationWasRequested,
  OpenRouterTransportCancelledError,
  sleepWithAbortSignal,
  watchForCancellation,
} from "./openrouter_cancellation";
import {
  parseOpenRouterImageResponse,
  type OpenRouterImagePayload,
} from "./openrouter_image_response";

export const OPENROUTER_IMAGE_API_URL =
  "https://openrouter.ai/api/v1/images";

export interface OpenRouterImageReference {
  type: "image_url";
  image_url: { url: string };
}

export interface OpenRouterImageRequest {
  model: string;
  prompt: string;
  inputReferences?: OpenRouterImageReference[];
  n?: number;
  aspectRatio?: string;
  resolution?: string;
  size?: string;
  quality?: string;
  background?: string;
  outputFormat?: string;
  outputCompression?: number;
}

export interface OpenRouterImageResult {
  imageDataUrls: string[];
  imageCount: number;
  usage: OpenRouterUsage | null;
  generationId: string | null;
}

export interface CallOpenRouterImageOptions {
  onImage?: (image: OpenRouterImagePayload) => Promise<void>;
  onMetadata?: (metadata: {
    generationId: string | null;
    usage: OpenRouterUsage | null;
  }) => void;
  isCancelled?: () => Promise<boolean>;
  cancellationPollIntervalMs?: number;
}

export function assertOpenRouterImagePrivacy(requireZdr: boolean): void {
  if (!requireZdr) return;
  throw new ConvexError({
    code: "IMAGE_GENERATION_ZDR_UNAVAILABLE" as const,
    message:
      "Image generation is unavailable when Zero Data Retention or protected Google routing is required. Choose a text model or turn off the protected mode.",
  });
}

export async function callOpenRouterImage(
  apiKey: string,
  request: OpenRouterImageRequest,
  options: CallOpenRouterImageOptions = {},
): Promise<OpenRouterImageResult> {
  let rateLimitRetries = 0;

  while (true) {
    if (await cancellationWasRequested(options.isCancelled)) {
      throw new OpenRouterTransportCancelledError();
    }
    const controller = new AbortController();
    let abortReason: "cancelled" | "timeout" | undefined;
    const abort = (reason: "cancelled" | "timeout") => {
      if (controller.signal.aborted) return;
      abortReason = reason;
      controller.abort();
    };
    const stopCancellationWatch = watchForCancellation({
      isCancelled: options.isCancelled,
      pollIntervalMs: options.cancellationPollIntervalMs,
      onCancelled: () => abort("cancelled"),
    });
    const timeout = setTimeout(() => abort("timeout"), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(OPENROUTER_IMAGE_API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": HTTP_REFERER,
          "X-Title": X_TITLE,
        },
        body: JSON.stringify({
          model: request.model,
          prompt: request.prompt,
          ...(request.inputReferences?.length
            ? { input_references: request.inputReferences }
            : {}),
          ...(request.n !== undefined ? { n: request.n } : {}),
          ...(request.aspectRatio ? { aspect_ratio: request.aspectRatio } : {}),
          ...(request.resolution ? { resolution: request.resolution } : {}),
          ...(request.size && !request.resolution ? { size: request.size } : {}),
          ...(request.quality ? { quality: request.quality } : {}),
          ...(request.background ? { background: request.background } : {}),
          ...(request.outputFormat ? { output_format: request.outputFormat } : {}),
          ...(request.outputCompression !== undefined
            ? { output_compression: request.outputCompression }
            : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const responseText = await response.text();
        let payload: unknown = responseText;
        try {
          payload = JSON.parse(responseText) as unknown;
        } catch {
          // Preserve the raw upstream body when it is not JSON.
        }
        if (
          (response.status === 429 || response.status === 503) &&
          rateLimitRetries < MAX_RATE_LIMIT_RETRIES
        ) {
          const retryAfter = response.headers?.get("retry-after") ?? null;
          const delayMs = rateLimitDelayMs(retryAfter, rateLimitRetries);
          rateLimitRetries += 1;
          await sleepWithAbortSignal(delayMs, controller.signal);
          continue;
        }
        const message = extractErrorMessage(payload);
        throw new ConvexError(openRouterErrorDetails(response.status, message));
      }

      const generationId = response.headers?.get("x-generation-id") ?? null;
      options.onMetadata?.({ generationId, usage: null });
      const imageDataUrls: string[] = [];
      const parsed = await parseOpenRouterImageResponse(
        response,
        options.onImage ?? (async (image) => {
          imageDataUrls.push(
            `data:${image.mediaType};base64,${image.base64}`,
          );
        }),
      );
      const usage = usageFromUnknown(parsed.usage) ?? null;
      options.onMetadata?.({ generationId, usage });

      if (parsed.error) {
        throw new ConvexError({
          code: "INTERNAL_ERROR" as const,
          message: extractErrorMessage({ error: parsed.error }),
        });
      }

      if (parsed.imageCount === 0) {
        throw new ConvexError({
          code: "INTERNAL_ERROR" as const,
          message: "OpenRouter image generation returned no image payload.",
        });
      }

      return {
        imageDataUrls,
        imageCount: parsed.imageCount,
        usage,
        generationId,
      };
    } catch (error) {
      if (abortReason === "cancelled") {
        throw new OpenRouterTransportCancelledError();
      }
      if (error instanceof ConvexError) throw error;
      const name = (error as { name?: unknown })?.name;
      if (name === "AbortError") {
        throw new ConvexError({
          code: "TIMEOUT" as const,
          message: "Image generation took too long. Please try again.",
        });
      }
      throw error;
    } finally {
      stopCancellationWatch();
      clearTimeout(timeout);
    }
  }
}
