import { HTTP_REFERER, X_TITLE } from "./openrouter_constants";

const OPENROUTER_ORIGIN = "https://openrouter.ai";
const VIDEO_API_PATH = "/api/v1/videos";
const MAX_VIDEO_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const VIDEO_FETCH_TIMEOUT_MS = 5 * 60 * 1000;

export interface VideoFrameImage {
  type: "image_url";
  image_url: { url: string };
  frame_type: "first_frame" | "last_frame";
}

export interface VideoInputReference {
  type: "image_url";
  image_url: { url: string };
}

export interface SubmitVideoJobRequest {
  model: string;
  prompt: string;
  resolution?: string;
  aspect_ratio?: string;
  duration?: number;
  generate_audio?: boolean;
  seed?: number;
  provider?: {
    sort?: "latency" | "throughput" | "price";
    preferred_max_latency?: { p50?: number; p90?: number; p99?: number };
    zdr?: boolean;
  };
  output?: { upload_url?: string };
  frame_images?: VideoFrameImage[];
  input_references?: VideoInputReference[];
}

export interface SubmitVideoJobResponse {
  id: string;
  status: "pending";
}

export interface PollVideoJobResponse {
  id: string;
  generation_id?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  usage?: { cost?: number; is_byok?: boolean };
  error?: { message?: string; code?: string };
}

export function normalizeVideoJobError(
  value: unknown,
): PollVideoJobResponse["error"] {
  if (typeof value === "string" && value.trim()) {
    return { message: value.trim() };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const error = value as { message?: unknown; code?: unknown };
  const message = typeof error.message === "string" && error.message.trim()
    ? error.message.trim()
    : undefined;
  const code = typeof error.code === "string" && error.code.trim()
    ? error.code.trim()
    : undefined;
  return message || code ? { message, code } : undefined;
}

function videoUrl(jobId?: string, content = false): string {
  const normalizedJobId = jobId?.trim();
  if (!normalizedJobId || normalizedJobId.length > 512) {
    throw new Error("OpenRouter returned an invalid video job identifier.");
  }
  const suffix = content ? "/content?index=0" : "";
  return `${OPENROUTER_ORIGIN}${VIDEO_API_PATH}/${encodeURIComponent(normalizedJobId)}${suffix}`;
}

function openRouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "HTTP-Referer": HTTP_REFERER,
    "X-Title": X_TITLE,
  };
}

async function fetchOpenRouterVideo(
  url: string,
  apiKey: string,
  init: RequestInit = {},
): Promise<{ response: Response; finish: () => void }> {
  const parsed = new URL(url);
  if (
    parsed.origin !== OPENROUTER_ORIGIN
    || parsed.username
    || parsed.password
    || parsed.port
    || parsed.hash
    || (parsed.pathname !== VIDEO_API_PATH && !parsed.pathname.startsWith(`${VIDEO_API_PATH}/`))
  ) {
    throw new Error("OpenRouter video endpoint validation failed.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VIDEO_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      ...init,
      redirect: "manual",
      signal: controller.signal,
      headers: { ...openRouterHeaders(apiKey), ...init.headers },
    });
    return { response, finish: () => clearTimeout(timeout) };
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

export async function submitVideoJob(
  apiKey: string,
  request: SubmitVideoJobRequest,
): Promise<SubmitVideoJobResponse> {
  const requestResult = await fetchOpenRouterVideo(`${OPENROUTER_ORIGIN}${VIDEO_API_PATH}`, apiKey, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });
  try {
    const response = requestResult.response;
    if (!response.ok) {
      throw new Error(`Video submission failed (HTTP ${response.status}).`);
    }
    const data = await response.json() as Partial<SubmitVideoJobResponse>;
    if (typeof data.id !== "string" || data.status !== "pending") {
      throw new Error("OpenRouter returned an invalid video submission response.");
    }
    return { id: data.id, status: "pending" };
  } finally {
    requestResult.finish();
  }
}

export async function pollVideoJobStatus(
  apiKey: string,
  jobId: string,
): Promise<PollVideoJobResponse> {
  const pollingUrl = videoUrl(jobId);
  const request = await fetchOpenRouterVideo(pollingUrl, apiKey);
  try {
    if (!request.response.ok) {
      throw new Error(`Video poll failed (HTTP ${request.response.status}).`);
    }
    const data = await request.response.json() as PollVideoJobResponse & { error?: unknown };
    if (data.id !== jobId || !["pending", "in_progress", "completed", "failed"].includes(data.status)) {
      throw new Error("OpenRouter returned an invalid video poll response.");
    }
    return {
      id: data.id,
      status: data.status,
      generation_id: data.generation_id,
      usage: data.usage,
      error: normalizeVideoJobError(data.error),
    };
  } finally {
    request.finish();
  }
}

export async function downloadVideoContent(
  apiKey: string,
  jobId: string,
): Promise<ArrayBuffer> {
  const request = await fetchOpenRouterVideo(videoUrl(jobId, true), apiKey);
  try {
    const { response } = request;
    if (!response.ok) throw new Error(`Video download failed (HTTP ${response.status}).`);
    const contentType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType && contentType !== "application/octet-stream" && !contentType.startsWith("video/")) {
      throw new Error("OpenRouter returned an unsupported video content type.");
    }
    const contentLength = Number(response.headers.get("Content-Length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_VIDEO_DOWNLOAD_BYTES) {
      throw new Error("OpenRouter video output exceeds the supported size.");
    }
    if (!response.body) throw new Error("OpenRouter returned an empty video response.");

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_VIDEO_DOWNLOAD_BYTES) {
        await reader.cancel();
        throw new Error("OpenRouter video output exceeds the supported size.");
      }
      chunks.push(value);
    }
    if (totalBytes === 0) throw new Error("OpenRouter returned an empty video response.");
    const output = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output.buffer;
  } finally {
    request.finish();
  }
}
