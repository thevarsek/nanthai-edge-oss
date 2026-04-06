import { ContentPart, OpenRouterMessage } from "../lib/openrouter";
import { contentFromParts } from "./helpers_utils";

export interface VideoUrlPromotionOptions {
  modelId: string;
  provider?: string;
  hasVideoInput?: boolean;
}

export interface VideoUrlPromotionEvent {
  status: "promoted" | "skipped";
  url: string;
  reason?: "unsupported_model" | "malformed_url" | "non_public_url";
}

const PUBLIC_URL_PATTERN = /\bhttps?:\/\/[^\s<>()]+/gi;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export function promoteLatestUserVideoUrls(
  messages: OpenRouterMessage[],
  options: VideoUrlPromotionOptions,
): { messages: OpenRouterMessage[]; events: VideoUrlPromotionEvent[] } {
  const latestUserIndex = findLatestUserMessageIndex(messages);
  if (latestUserIndex < 0) {
    return { messages, events: [] };
  }

  const latestUserMessage = messages[latestUserIndex];
  const parts = contentToParts(latestUserMessage.content);
  const text = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n\n")
    .trim();

  if (!text) {
    return { messages, events: [] };
  }

  const { urls, events } = extractSupportedVideoUrlsFromText(text);
  if (events.length === 0) {
    return { messages, events: [] };
  }

  if (!options.hasVideoInput) {
    return {
      messages,
      events: events.map((event) =>
        event.status === "promoted"
          ? { ...event, status: "skipped", reason: "unsupported_model" as const }
          : event,
      ),
    };
  }

  const existingUrls = new Set(
    parts
      .filter((part) => part.type === "video_url")
      .map((part) => part.video_url?.url)
      .filter((url): url is string => typeof url === "string"),
  );

  const appendedParts = urls
    .filter((url) => !existingUrls.has(url))
    .map((url) => ({
      type: "video_url" as const,
      video_url: { url },
    }));

  if (appendedParts.length === 0) {
    return { messages, events };
  }

  const updatedMessages = [...messages];
  updatedMessages[latestUserIndex] = {
    ...latestUserMessage,
    content: contentFromParts([...parts, ...appendedParts]),
  };

  return { messages: updatedMessages, events };
}

export function extractSupportedVideoUrlsFromText(
  text: string,
): { urls: string[]; events: VideoUrlPromotionEvent[] } {
  const matches = text.match(PUBLIC_URL_PATTERN) ?? [];
  if (matches.length === 0) {
    return { urls: [], events: [] };
  }

  const urls: string[] = [];
  const events: VideoUrlPromotionEvent[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const result = canonicalizePublicVideoUrl(match);
    if (!result.url) {
      if (result.reason) {
        events.push({
          status: "skipped",
          url: match,
          reason: result.reason,
        });
      }
      continue;
    }

    if (seen.has(result.url)) {
      continue;
    }

    seen.add(result.url);
    urls.push(result.url);
    events.push({
      status: "promoted",
      url: result.url,
    });
  }

  return { urls, events };
}

export function canonicalizePublicVideoUrl(
  rawUrl: string,
): { url?: string; reason?: "malformed_url" | "non_public_url" } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { reason: "malformed_url" };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(hostname)) {
    return {};
  }

  const videoId = extractYouTubeVideoId(parsed);
  if (!videoId) {
    return { reason: "non_public_url" };
  }

  return { url: `https://www.youtube.com/watch?v=${videoId}` };
}

function findLatestUserMessageIndex(messages: OpenRouterMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return -1;
}

function contentToParts(content: OpenRouterMessage["content"]): ContentPart[] {
  if (typeof content === "string") {
    return content.trim().length > 0 ? [{ type: "text", text: content }] : [];
  }
  return content ?? [];
}

function extractYouTubeVideoId(url: URL): string | undefined {
  const hostname = url.hostname.toLowerCase();
  let candidate: string | null = null;

  if (hostname === "youtu.be" || hostname === "www.youtu.be") {
    candidate = url.pathname.split("/").filter(Boolean)[0] ?? null;
  } else if (
    hostname === "youtube.com" ||
    hostname === "www.youtube.com" ||
    hostname === "m.youtube.com" ||
    hostname === "music.youtube.com"
  ) {
    if (url.pathname === "/watch") {
      candidate = url.searchParams.get("v");
    } else {
      const segments = url.pathname.split("/").filter(Boolean);
      if (
        segments[0] === "shorts" ||
        segments[0] === "embed" ||
        segments[0] === "live"
      ) {
        candidate = segments[1] ?? null;
      }
    }
  }

  if (!candidate || !YOUTUBE_VIDEO_ID_PATTERN.test(candidate)) {
    return undefined;
  }

  return candidate;
}
