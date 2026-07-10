import type { ImageGenerationConfig } from "../preferences/image_defaults";

export interface ImageCapabilityDescriptor {
  type?: string;
  values?: string[];
  min?: number;
  max?: number;
}

export type ImageSupportedParameters = Record<string, ImageCapabilityDescriptor | unknown>;

export interface ResolvedImageGenerationOptions {
  n?: number;
  aspectRatio?: string;
  resolution?: string;
  size?: string;
  quality?: string;
  background?: string;
  outputFormat?: string;
  outputCompression?: number;
}

function descriptor(
  parameters: ImageSupportedParameters | undefined,
  key: string,
): ImageCapabilityDescriptor | undefined {
  if (!parameters || !(key in parameters)) return undefined;
  const value = parameters[key];
  return value && typeof value === "object"
    ? value as ImageCapabilityDescriptor
    : {};
}

function requestedString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.toLowerCase() !== "auto" ? normalized : undefined;
}

function descriptorValues(value: ImageCapabilityDescriptor): string[] {
  return Array.isArray(value.values)
    ? value.values.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function exactEnum(
  requested: string | undefined,
  value: ImageCapabilityDescriptor | undefined,
): string | undefined {
  const normalized = requestedString(requested);
  if (!normalized || !value) return undefined;
  const values = descriptorValues(value);
  if (values.length === 0) return normalized;
  return values.find((candidate) =>
    candidate.trim().toLowerCase() === normalized.toLowerCase()
  );
}

function clampAdvertisedInteger(
  requested: number | undefined,
  value: ImageCapabilityDescriptor | undefined,
): number | undefined {
  if (requested === undefined || !Number.isFinite(requested) || !value) return undefined;
  const min = typeof value.min === "number" && Number.isFinite(value.min)
    ? Math.ceil(value.min)
    : Number.MIN_SAFE_INTEGER;
  const max = typeof value.max === "number" && Number.isFinite(value.max)
    ? Math.floor(value.max)
    : Number.MAX_SAFE_INTEGER;
  return Math.max(min, Math.min(max, Math.round(requested)));
}

function advertisedPositiveIntegers(
  value: ImageCapabilityDescriptor,
): number[] {
  const counts = descriptorValues(value)
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isInteger(entry) && entry > 0);
  return Array.from(new Set(counts)).sort((left, right) => left - right);
}

function resolveAdvertisedCount(
  requested: number | undefined,
  value: ImageCapabilityDescriptor | undefined,
): number | undefined {
  if (requested === undefined || !Number.isFinite(requested) || !value) {
    return undefined;
  }
  if (Array.isArray(value.values)) {
    const supported = advertisedPositiveIntegers(value);
    if (supported.length === 0) return undefined;
    const rounded = Math.max(1, Math.round(requested));
    return supported.filter((candidate) => candidate <= rounded).at(-1) ?? supported[0];
  }
  if (value.min === undefined && value.max === undefined) return undefined;
  return clampAdvertisedInteger(requested, value);
}

function parseAspectRatio(value: string): number | undefined {
  const normalized = value.trim().toLowerCase();
  const pair = normalized.match(/^(\d+(?:\.\d+)?)\s*[:/x×]\s*(\d+(?:\.\d+)?)$/);
  if (pair) {
    const width = Number(pair[1]);
    const height = Number(pair[2]);
    return width > 0 && height > 0 ? width / height : undefined;
  }
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function closestAspectRatio(
  requested: string | undefined,
  value: ImageCapabilityDescriptor | undefined,
): string | undefined {
  const exact = exactEnum(requested, value);
  if (exact || !value) return exact;
  const normalized = requestedString(requested);
  const target = normalized ? parseAspectRatio(normalized) : undefined;
  if (target === undefined) return undefined;
  const candidates = descriptorValues(value).flatMap((candidate) => {
    const ratio = parseAspectRatio(candidate);
    return ratio === undefined ? [] : [{ candidate, distance: Math.abs(ratio - target) }];
  });
  candidates.sort((left, right) => left.distance - right.distance);
  return candidates[0]?.candidate;
}

function parseResolution(value: string): number | undefined {
  const normalized = value.trim().toLowerCase();
  const dimensions = normalized.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)$/);
  if (dimensions) return Math.max(Number(dimensions[1]), Number(dimensions[2]));
  const tier = normalized.match(/^(\d+(?:\.\d+)?)\s*(k|p)?$/);
  if (!tier) return undefined;
  const amount = Number(tier[1]);
  return tier[2] === "k" ? amount * 1024 : amount;
}

function closestResolution(
  requested: string | undefined,
  value: ImageCapabilityDescriptor | undefined,
): string | undefined {
  const exact = exactEnum(requested, value);
  if (exact || !value) return exact;
  const normalized = requestedString(requested);
  const target = normalized ? parseResolution(normalized) : undefined;
  if (target === undefined) return undefined;
  const candidates = descriptorValues(value).flatMap((candidate) => {
    const resolution = parseResolution(candidate);
    return resolution === undefined ? [] : [{ candidate, resolution }];
  }).sort((left, right) => left.resolution - right.resolution);
  const lower = candidates.filter((candidate) => candidate.resolution <= target).at(-1);
  return lower?.candidate ?? candidates.find((candidate) => candidate.resolution > target)?.candidate;
}

const QUALITY_ORDER = new Map([
  ["low", 0],
  ["medium", 1],
  ["high", 2],
]);

function closestQuality(
  requested: string | undefined,
  value: ImageCapabilityDescriptor | undefined,
): string | undefined {
  const exact = exactEnum(requested, value);
  if (exact || !value) return exact;
  const target = QUALITY_ORDER.get(requestedString(requested)?.toLowerCase() ?? "");
  if (target === undefined) return undefined;
  const candidates = descriptorValues(value).flatMap((candidate) => {
    const rank = QUALITY_ORDER.get(candidate.trim().toLowerCase());
    return rank === undefined ? [] : [{ candidate, rank }];
  });
  candidates.sort((left, right) =>
    Math.abs(left.rank - target) - Math.abs(right.rank - target) || left.rank - right.rank
  );
  return candidates[0]?.candidate;
}

function safeTransparentFormat(
  options: ResolvedImageGenerationOptions,
  formatDescriptor: ImageCapabilityDescriptor | undefined,
): void {
  if (options.background?.toLowerCase() !== "transparent") return;
  const format = options.outputFormat?.toLowerCase();
  if (format !== "jpeg" && format !== "jpg") return;
  const formats = formatDescriptor ? descriptorValues(formatDescriptor) : [];
  const replacement = ["png", "webp"].flatMap((preferred) =>
    formats.filter((candidate) => candidate.trim().toLowerCase() === preferred)
  )[0];
  if (replacement) {
    options.outputFormat = replacement;
  } else {
    delete options.background;
  }
}

export function resolveImageGenerationOptions(
  config: ImageGenerationConfig | undefined,
  parameters: ImageSupportedParameters | undefined,
): ResolvedImageGenerationOptions {
  if (!config || !parameters) return {};
  const options: ResolvedImageGenerationOptions = {};
  const count = resolveAdvertisedCount(config.count, descriptor(parameters, "n"));
  const compression = clampAdvertisedInteger(
    config.outputCompression,
    descriptor(parameters, "output_compression"),
  );
  const aspectRatio = closestAspectRatio(
    config.aspectRatio,
    descriptor(parameters, "aspect_ratio"),
  );
  const resolutionDescriptor = descriptor(parameters, "resolution");
  const sizeDescriptor = resolutionDescriptor ? undefined : descriptor(parameters, "size");
  const resolution = closestResolution(
    config.resolution,
    resolutionDescriptor ?? sizeDescriptor,
  );
  const quality = closestQuality(config.quality, descriptor(parameters, "quality"));
  const background = exactEnum(config.background, descriptor(parameters, "background"));
  const formatDescriptor = descriptor(parameters, "output_format");
  const outputFormat = exactEnum(config.outputFormat, formatDescriptor);
  if (count !== undefined) options.n = count;
  if (aspectRatio !== undefined) options.aspectRatio = aspectRatio;
  if (resolution !== undefined && resolutionDescriptor) options.resolution = resolution;
  if (resolution !== undefined && sizeDescriptor) options.size = resolution;
  if (quality !== undefined) options.quality = quality;
  if (background !== undefined) options.background = background;
  if (outputFormat !== undefined) options.outputFormat = outputFormat;
  if (compression !== undefined) options.outputCompression = compression;
  safeTransparentFormat(options, formatDescriptor);
  if (options.outputFormat?.toLowerCase() === "png") {
    delete options.outputCompression;
  }
  return options;
}
