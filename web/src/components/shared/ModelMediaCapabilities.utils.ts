import type { TFunction } from "i18next";

export interface ImageMediaCapabilities {
  counts?: number[];
  countMin?: number;
  countMax?: number;
  aspectRatios: string[];
  resolutions: string[];
  sizes: string[];
  qualities: string[];
  backgrounds: string[];
  outputFormats: string[];
  maxInputReferences?: number;
  supportsStreaming: boolean;
}

export interface VideoMediaCapabilities {
  resolutions: string[];
  aspectRatios: string[];
  durations: number[];
  frameImages: string[];
  supportsAudio: boolean;
  supportsSeed: boolean;
}

export interface ModelMediaCapabilities {
  image?: ImageMediaCapabilities;
  video?: VideoMediaCapabilities;
}

const RESOLUTION_SCORES: Record<string, number> = {
  "480p": 480,
  "512": 512,
  "720p": 720,
  "1k": 1_000,
  "1080p": 1_080,
  "2k": 2_000,
  "4k": 4_000,
};

export function uniqueMediaValues(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

export function exactImageCounts(values?: number[]): number[] {
  return [...new Set(
    (values ?? []).filter((value) => Number.isInteger(value) && value > 0),
  )].sort((left, right) => left - right);
}

function bestResolution(values: string[]): string | undefined {
  return uniqueMediaValues(values).reduce<string | undefined>((best, candidate) => {
    if (!best) return candidate;
    const candidateScore = RESOLUTION_SCORES[candidate.toLowerCase()] ?? 0;
    const bestScore = RESOLUTION_SCORES[best.toLowerCase()] ?? 0;
    return candidateScore > bestScore ? candidate : best;
  }, undefined);
}

export function localizedMediaValue(t: TFunction, value: string): string {
  const keyByValue: Record<string, string> = {
    auto: "image_defaults_auto",
    low: "low",
    medium: "medium",
    high: "high",
    transparent: "image_defaults_transparent",
    opaque: "image_defaults_opaque",
    first_frame: "media_first_frame",
    last_frame: "media_last_frame",
    reference_image: "media_reference_image",
    reference_images: "media_reference_images",
  };
  const key = keyByValue[value.toLowerCase()];
  if (key) return t(key);
  if (["png", "jpeg", "jpg", "webp", "svg"].includes(value.toLowerCase())) {
    return value.toUpperCase();
  }
  return value.replaceAll("_", " ");
}

export function joinedMediaValues(t: TFunction, values: string[]): string {
  return uniqueMediaValues(values).map((value) => localizedMediaValue(t, value)).join(", ");
}

export function compactMediaSummary(
  t: TFunction,
  capabilities?: ModelMediaCapabilities,
): string[] {
  if (capabilities?.image) {
    const image = capabilities.image;
    const summary: string[] = [];
    const maximumCount = exactImageCounts(image.counts).at(-1) ?? image.countMax;
    if (maximumCount != null && maximumCount > 1) {
      summary.push(t("media_up_to_images", { count: maximumCount }));
    }
    if (image.maxInputReferences != null && image.maxInputReferences > 0) {
      summary.push(t("media_image_editing"));
    }
    const resolution = bestResolution([...image.resolutions, ...image.sizes]);
    if (resolution) summary.push(resolution);
    return summary.slice(0, 3);
  }

  if (capabilities?.video) {
    const video = capabilities.video;
    const summary: string[] = [];
    if (video.frameImages.length > 0) summary.push(t("guidance_cap_image_to_video"));
    if (video.supportsAudio) summary.push(t("media_audio"));
    const resolution = bestResolution(video.resolutions);
    if (resolution) summary.push(resolution);
    if (summary.length < 3 && video.durations.length > 0) {
      summary.push(`${Math.max(...video.durations)}s`);
    }
    return summary.slice(0, 3);
  }

  return [];
}
