import { OpenRouterUsage } from "./openrouter_types";

export function normalizeImageUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("data:")) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  const compact = trimmed.replace(/\s+/g, "");
  const looksBase64 = /^[A-Za-z0-9+/=]+$/.test(compact);
  if (looksBase64 && compact.length >= 64) {
    return `data:image/png;base64,${compact}`;
  }

  return trimmed;
}

export function extractTextAndImages(
  content: unknown,
): { text?: string; imageUrls: string[] } {
  if (typeof content === "string") {
    return { text: content, imageUrls: [] };
  }

  if (!Array.isArray(content)) {
    return { imageUrls: [] };
  }

  const textParts: string[] = [];
  const images: string[] = [];

  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const payload = part as Record<string, unknown>;
    const partType =
      typeof payload.type === "string" ? payload.type.toLowerCase() : "";

    if (
      (partType === "text" || partType === "output_text") &&
      typeof payload.text === "string" &&
      payload.text.trim().length > 0
    ) {
      textParts.push(payload.text);
      continue;
    }

    if (payload.image_url && typeof payload.image_url === "object") {
      const imagePayload = payload.image_url as Record<string, unknown>;
      if (typeof imagePayload.url === "string") {
        const normalized = normalizeImageUrl(imagePayload.url);
        if (normalized) images.push(normalized);
      }
      const rawBase64 =
        imagePayload.b64_json ?? imagePayload.base64 ?? imagePayload.data;
      if (typeof rawBase64 === "string" && rawBase64.trim().length > 0) {
        const normalized = normalizeImageUrl(rawBase64);
        if (normalized) images.push(normalized);
      }
      continue;
    }

    if (partType.includes("image")) {
      const raw =
        payload.url ??
        payload.image ??
        payload.data ??
        payload.b64_json ??
        payload.base64 ??
        payload.image_base64;
      if (typeof raw === "string" && raw.trim().length > 0) {
        const normalized = normalizeImageUrl(raw);
        if (normalized) images.push(normalized);
      }
    }
  }

  return {
    text: textParts.length > 0 ? textParts.join("") : undefined,
    imageUrls: images,
  };
}

export function extractImageUrlsFromUnknown(value: unknown): string[] {
  if (!value) return [];

  if (typeof value === "string") {
    const normalized = normalizeImageUrl(value);
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(extractImageUrlsFromUnknown);
  }

  if (typeof value !== "object") {
    return [];
  }

  const payload = value as Record<string, unknown>;
  const candidates: unknown[] = [];

  if (payload.image_url) candidates.push(payload.image_url);
  if (payload.url) candidates.push(payload.url);
  if (payload.image) candidates.push(payload.image);
  if (payload.data) candidates.push(payload.data);
  if (payload.b64_json) candidates.push(payload.b64_json);
  if (payload.base64) candidates.push(payload.base64);
  if (payload.image_base64) candidates.push(payload.image_base64);

  return candidates.flatMap(extractImageUrlsFromUnknown);
}

export function usageFromUnknown(value: unknown): OpenRouterUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const usage = value as {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    is_byok?: boolean;
    prompt_tokens_details?: {
      cached_tokens?: number;
      cache_write_tokens?: number;
      audio_tokens?: number;
      video_tokens?: number;
    };
    completion_tokens_details?: {
      reasoning_tokens?: number;
      image_tokens?: number;
      audio_tokens?: number;
    };
    cost_details?: {
      upstream_inference_cost?: number;
      upstream_inference_prompt_cost?: number;
      upstream_inference_completions_cost?: number;
    };
    server_tool_use?: {
      web_search_requests?: number;
    };
  };
  if (
    usage.prompt_tokens === undefined &&
    usage.completion_tokens === undefined &&
    usage.total_tokens === undefined
  ) {
    return undefined;
  }
  const result: OpenRouterUsage = {
    promptTokens: usage.prompt_tokens ?? 0,
    completionTokens: usage.completion_tokens ?? 0,
    totalTokens: usage.total_tokens ?? 0,
  };
  if (typeof usage.cost === "number") result.cost = usage.cost;
  if (typeof usage.is_byok === "boolean") result.isByok = usage.is_byok;

  // prompt_tokens_details
  const ptd = usage.prompt_tokens_details;
  if (ptd) {
    if (typeof ptd.cached_tokens === "number" && ptd.cached_tokens > 0)
      result.cachedTokens = ptd.cached_tokens;
    if (typeof ptd.cache_write_tokens === "number" && ptd.cache_write_tokens > 0)
      result.cacheWriteTokens = ptd.cache_write_tokens;
    if (typeof ptd.audio_tokens === "number" && ptd.audio_tokens > 0)
      result.audioPromptTokens = ptd.audio_tokens;
    if (typeof ptd.video_tokens === "number" && ptd.video_tokens > 0)
      result.videoTokens = ptd.video_tokens;
  }

  // completion_tokens_details
  const ctd = usage.completion_tokens_details;
  if (ctd) {
    if (typeof ctd.reasoning_tokens === "number" && ctd.reasoning_tokens > 0)
      result.reasoningTokens = ctd.reasoning_tokens;
    if (typeof ctd.image_tokens === "number" && ctd.image_tokens > 0)
      result.imageCompletionTokens = ctd.image_tokens;
    if (typeof ctd.audio_tokens === "number" && ctd.audio_tokens > 0)
      result.audioCompletionTokens = ctd.audio_tokens;
  }

  // cost_details
  const cd = usage.cost_details;
  if (cd) {
    if (typeof cd.upstream_inference_cost === "number" && cd.upstream_inference_cost > 0)
      result.upstreamInferenceCost = cd.upstream_inference_cost;
    if (typeof cd.upstream_inference_prompt_cost === "number" && cd.upstream_inference_prompt_cost > 0)
      result.upstreamInferencePromptCost = cd.upstream_inference_prompt_cost;
    if (typeof cd.upstream_inference_completions_cost === "number" && cd.upstream_inference_completions_cost > 0)
      result.upstreamInferenceCompletionsCost = cd.upstream_inference_completions_cost;
  }

  // server_tool_use — tracks web search requests made by OpenRouter server tools
  const stu = usage.server_tool_use;
  if (stu) {
    if (typeof stu.web_search_requests === "number" && stu.web_search_requests > 0)
      result.webSearchRequests = stu.web_search_requests;
  }

  return result;
}

export function extractFirstTextFromUnknown(
  value: unknown,
  depth = 0,
): string | undefined {
  if (depth > 8 || value == null) return undefined;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (Array.isArray(value)) {
    const parsed = extractTextAndImages(value);
    if (parsed.text && parsed.text.trim().length > 0) {
      return parsed.text.trim();
    }
    for (const item of value) {
      const nested = extractFirstTextFromUnknown(item, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  }

  if (typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.text === "string" && record.text.trim().length > 0) {
    return record.text.trim();
  }

  const priorityKeys = [
    "content",
    "output_text",
    "message",
    "choice",
    "choices",
    "output",
    "response",
    "item",
    "part",
    "delta",
    "data",
  ] as const;

  for (const key of priorityKeys) {
    if (!(key in record)) continue;
    const nested = extractFirstTextFromUnknown(record[key], depth + 1);
    if (nested) return nested;
  }

  return undefined;
}

export function extractFirstStreamingTextFromUnknown(
  value: unknown,
  depth = 0,
): string | undefined {
  if (depth > 8 || value == null) return undefined;

  if (typeof value === "string") {
    return value.trim().length > 0 ? value : undefined;
  }

  if (Array.isArray(value)) {
    const parsed = extractTextAndImages(value);
    if (parsed.text && parsed.text.trim().length > 0) {
      return parsed.text;
    }
    for (const item of value) {
      const nested = extractFirstStreamingTextFromUnknown(item, depth + 1);
      if (nested) return nested;
    }
    return undefined;
  }

  if (typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.text === "string" && record.text.trim().length > 0) {
    return record.text;
  }

  const priorityKeys = [
    "content",
    "output_text",
    "message",
    "choice",
    "choices",
    "output",
    "response",
    "item",
    "part",
    "delta",
    "data",
  ] as const;

  for (const key of priorityKeys) {
    if (!(key in record)) continue;
    const nested = extractFirstStreamingTextFromUnknown(record[key], depth + 1);
    if (nested) return nested;
  }

  return undefined;
}
