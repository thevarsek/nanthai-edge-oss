import type { PostHogProperties } from "../analytics/posthog";
import { OPENROUTER_IMAGE_API_URL } from "../lib/openrouter_image";
import type { ImageGenerationConfig } from "../preferences/image_defaults";
import {
  resolveImageGenerationOptions,
  type ImageSupportedParameters,
} from "./image_generation_defaults";

export type DedicatedImageGenerationAnalytics = {
  source: "image_generation";
  properties: PostHogProperties;
};

const OPENROUTER_IMAGE_ENDPOINT = new URL(OPENROUTER_IMAGE_API_URL).pathname;

function hasConfiguredOption(config: ImageGenerationConfig | undefined): boolean {
  return config !== undefined && Object.values(config).some((value) => value !== undefined);
}

/**
 * Builds the backend-owned analytics contract for requests sent to OpenRouter's
 * dedicated image endpoint. Only effective, capability-gated options are
 * reported, so analytics reflects the request we actually send upstream.
 */
export function dedicatedImageGenerationAnalytics(args: {
  config?: ImageGenerationConfig;
  supportedParameters?: ImageSupportedParameters;
  generatedImageCount?: number;
  requestedImageCount?: number;
  originSource?: string;
}): DedicatedImageGenerationAnalytics {
  const options = resolveImageGenerationOptions(
    args.config,
    args.supportedParameters,
  );
  const requestedImageCount = args.requestedImageCount === undefined
    ? options.n ?? 1
    : Math.max(1, Math.min(10, Math.round(args.requestedImageCount)));
  const failedImageCount = args.generatedImageCount === undefined
    ? null
    : Math.max(0, requestedImageCount - args.generatedImageCount);

  return {
    source: "image_generation",
    properties: {
      modality: "image",
      endpoint: OPENROUTER_IMAGE_ENDPOINT,
      stream: false,
      origin_source: args.originSource,
      requested_image_count: requestedImageCount,
      image_count: args.generatedImageCount ?? null,
      image_failed_count: failedImageCount,
      image_partial_success: failedImageCount === null
        ? null
        : failedImageCount > 0 && (args.generatedImageCount ?? 0) > 0,
      image_config_present: hasConfiguredOption(args.config),
      image_config_applied: Object.keys(options).length > 0,
      image_config_count: options.n ?? null,
      image_config_aspect_ratio: options.aspectRatio ?? null,
      image_config_resolution: options.resolution ?? null,
      image_config_size: options.size ?? null,
      image_config_quality: options.quality ?? null,
      image_config_background: options.background ?? null,
      image_config_output_format: options.outputFormat ?? null,
      image_config_output_compression: options.outputCompression ?? null,
    },
  };
}
