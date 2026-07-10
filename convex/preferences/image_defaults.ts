import { ConvexError } from "convex/values";

export const IMAGE_QUALITY_VALUES = ["auto", "low", "medium", "high"] as const;
export const IMAGE_BACKGROUND_VALUES = ["auto", "opaque", "transparent"] as const;
export const IMAGE_OUTPUT_FORMAT_VALUES = ["auto", "png", "jpeg", "webp"] as const;

export interface ImageGenerationConfig {
  count?: number;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  background?: string;
  outputFormat?: string;
  outputCompression?: number;
}

export interface ImagePreferenceValues {
  defaultImageCount?: number | null;
  defaultImageAspectRatio?: string | null;
  defaultImageResolution?: string | null;
  defaultImageQuality?: string | null;
  defaultImageBackground?: string | null;
  defaultImageOutputFormat?: string | null;
  defaultImageOutputCompression?: number | null;
}

function validationError(field: string, message: string): never {
  throw new ConvexError({
    code: "VALIDATION_ERROR" as const,
    message: `${field}: ${message}`,
  });
}

function validateInteger(
  value: number | null | undefined,
  field: string,
  min: number,
  max: number,
): number | null | undefined {
  if (value == null) return value;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    return validationError(field, `must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function validateString(
  value: string | null | undefined,
  field: string,
): string | null | undefined {
  if (value == null) return value;
  const normalized = value.trim();
  if (!normalized) return validationError(field, "must not be blank.");
  return normalized;
}

function validateEnum(
  value: string | null | undefined,
  field: string,
  allowed: readonly string[],
): string | null | undefined {
  const normalized = validateString(value, field);
  if (normalized == null) return normalized;
  const canonical = normalized.toLowerCase();
  if (!allowed.includes(canonical)) {
    return validationError(field, `must be one of: ${allowed.join(", ")}.`);
  }
  return canonical;
}

/** Validates and normalizes only fields explicitly present in a preference write. */
export function validateImagePreferenceWrite(
  values: ImagePreferenceValues,
): ImagePreferenceValues {
  const normalized: ImagePreferenceValues = {};
  if (values.defaultImageCount !== undefined) {
    normalized.defaultImageCount = validateInteger(
      values.defaultImageCount,
      "defaultImageCount",
      1,
      10,
    );
  }
  if (values.defaultImageAspectRatio !== undefined) {
    normalized.defaultImageAspectRatio = validateString(
      values.defaultImageAspectRatio,
      "defaultImageAspectRatio",
    );
  }
  if (values.defaultImageResolution !== undefined) {
    normalized.defaultImageResolution = validateString(
      values.defaultImageResolution,
      "defaultImageResolution",
    );
  }
  if (values.defaultImageQuality !== undefined) {
    normalized.defaultImageQuality = validateEnum(
      values.defaultImageQuality,
      "defaultImageQuality",
      IMAGE_QUALITY_VALUES,
    );
  }
  if (values.defaultImageBackground !== undefined) {
    normalized.defaultImageBackground = validateEnum(
      values.defaultImageBackground,
      "defaultImageBackground",
      IMAGE_BACKGROUND_VALUES,
    );
  }
  if (values.defaultImageOutputFormat !== undefined) {
    normalized.defaultImageOutputFormat = validateEnum(
      values.defaultImageOutputFormat,
      "defaultImageOutputFormat",
      IMAGE_OUTPUT_FORMAT_VALUES,
    );
  }
  if (values.defaultImageOutputCompression !== undefined) {
    normalized.defaultImageOutputCompression = validateInteger(
      values.defaultImageOutputCompression,
      "defaultImageOutputCompression",
      0,
      100,
    );
  }
  return normalized;
}

function sanitizedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizedEnum(value: unknown, allowed: readonly string[]): string | undefined {
  const normalized = sanitizedString(value)?.toLowerCase();
  return normalized && allowed.includes(normalized) ? normalized : undefined;
}

function sanitizedInteger(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Defensively sanitizes persisted or scheduled internal image configuration. */
export function sanitizeImageGenerationConfig(
  value: ImageGenerationConfig | undefined,
): ImageGenerationConfig | undefined {
  if (value === undefined) return undefined;
  const result: ImageGenerationConfig = {};
  const count = sanitizedInteger(value.count, 1, 10);
  const compression = sanitizedInteger(value.outputCompression, 0, 100);
  const aspectRatio = sanitizedString(value.aspectRatio);
  const resolution = sanitizedString(value.resolution);
  const quality = sanitizedEnum(value.quality, IMAGE_QUALITY_VALUES);
  const background = sanitizedEnum(value.background, IMAGE_BACKGROUND_VALUES);
  const outputFormat = sanitizedEnum(value.outputFormat, IMAGE_OUTPUT_FORMAT_VALUES);
  if (count !== undefined) result.count = count;
  if (aspectRatio !== undefined) result.aspectRatio = aspectRatio;
  if (resolution !== undefined) result.resolution = resolution;
  if (quality !== undefined) result.quality = quality;
  if (background !== undefined) result.background = background;
  if (outputFormat !== undefined) result.outputFormat = outputFormat;
  if (compression !== undefined) result.outputCompression = compression;
  return result;
}

export function imageConfigFromPreferences(
  values: ImagePreferenceValues | null | undefined,
): ImageGenerationConfig {
  return sanitizeImageGenerationConfig({
    count: values?.defaultImageCount ?? undefined,
    aspectRatio: values?.defaultImageAspectRatio ?? undefined,
    resolution: values?.defaultImageResolution ?? undefined,
    quality: values?.defaultImageQuality ?? undefined,
    background: values?.defaultImageBackground ?? undefined,
    outputFormat: values?.defaultImageOutputFormat ?? undefined,
    outputCompression: values?.defaultImageOutputCompression ?? undefined,
  }) ?? {};
}
