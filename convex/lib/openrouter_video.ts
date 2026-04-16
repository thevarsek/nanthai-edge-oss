// convex/lib/openrouter_video.ts
// =============================================================================
// OpenRouter Video API client.
//
// Three operations:
//   1. submitVideoJob() — POST /api/v1/videos → job ID + polling URL
//   2. pollVideoJobStatus() — GET polling URL → status + content URLs
//   3. downloadVideoContent() — GET content URL → ArrayBuffer (video/mp4)
//
// All functions are pure HTTP helpers with no Convex dependencies. They are
// called by the video generation actions.
// =============================================================================

import { HTTP_REFERER, X_TITLE } from "./openrouter_constants";

// -- Request types ------------------------------------------------------------

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
  frame_images?: VideoFrameImage[];
  input_references?: VideoInputReference[];
}

// -- Response types -----------------------------------------------------------

export interface SubmitVideoJobResponse {
  id: string;
  polling_url: string;
  status: "pending";
}

export interface PollVideoJobResponse {
  id: string;
  generation_id?: string;
  polling_url: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  unsigned_urls?: string[];
  usage?: {
    cost?: number;
    is_byok?: boolean;
  };
  error?: {
    message?: string;
    code?: string;
  };
}

// -- Submit -------------------------------------------------------------------

export async function submitVideoJob(
  apiKey: string,
  request: SubmitVideoJobRequest,
): Promise<SubmitVideoJobResponse> {
  const response = await fetch("https://openrouter.ai/api/v1/videos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": HTTP_REFERER,
      "X-Title": X_TITLE,
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Video submission failed: ${response.status} ${response.statusText} — ${errorText}`,
    );
  }

  const data = await response.json();
  return data as SubmitVideoJobResponse;
}

// -- Poll ---------------------------------------------------------------------

export async function pollVideoJobStatus(
  apiKey: string,
  pollingUrl: string,
): Promise<PollVideoJobResponse> {
  const response = await fetch(pollingUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": HTTP_REFERER,
      "X-Title": X_TITLE,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Video poll failed: ${response.status} ${response.statusText} — ${errorText}`,
    );
  }

  const data = await response.json();
  return data as PollVideoJobResponse;
}

// -- Download -----------------------------------------------------------------

export async function downloadVideoContent(
  apiKey: string,
  contentUrl: string,
): Promise<ArrayBuffer> {
  const response = await fetch(contentUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": HTTP_REFERER,
      "X-Title": X_TITLE,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `Video download failed: ${response.status} ${response.statusText} — ${errorText}`,
    );
  }

  return await response.arrayBuffer();
}
