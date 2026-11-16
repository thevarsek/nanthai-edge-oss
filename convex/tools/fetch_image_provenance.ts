// convex/tools/fetch_image_provenance.ts
// =============================================================================
// fetch_image only requests a remote URL that the user supplied or that this
// turn's web search cited. A URL the model composed itself (for example one
// carrying conversation data in its query string, as prompt-injected content
// may ask for) is never requested, so the tool cannot become an outbound
// channel for anything in the model's context.
//
// Sources that count:
//   1. The text of a user-written message in the current chat (checked in
//      `fetch_image_queries.ts`); results published by external MCP clients
//      are excluded.
//   2. Citation URLs returned by `web_search` in the current turn. Only the
//      provider's citation fields count, never the summary text, which can
//      echo the model-chosen query.
// =============================================================================

import type { OpenRouterMessage } from "../lib/openrouter_types";

export const FETCH_IMAGE_MAX_URL_LENGTH = 2048;
const SEARCH_CITATION_TOOLS = new Set(["web_search"]);

export const FETCH_IMAGE_UNTRUSTED_URL_ERROR =
  "This image URL was not provided by the user or cited by this turn's web search, so it was not fetched. " +
  "Ask the user to paste the image URL in the chat or attach the image.";

/** Forms of one URL that may appear verbatim in source text. */
export function fetchImageUrlCandidates(raw: string, normalized: string): string[] {
  const candidates = new Set([raw.trim(), normalized]);
  // `new URL("https://a.example")` adds a trailing slash the user did not type.
  if (normalized.endsWith("/")) candidates.add(normalized.slice(0, -1));
  return [...candidates].filter((candidate) => candidate.length > 0);
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function citationUrlsFromPayload(content: string): string[] {
  let payload: unknown;
  try {
    payload = JSON.parse(content);
  } catch {
    return [];
  }
  if (!payload || typeof payload !== "object") return [];
  const record = payload as { citations?: unknown; annotations?: unknown };
  const urls = stringValues(record.citations);
  if (Array.isArray(record.annotations)) {
    for (const annotation of record.annotations) {
      const url = (annotation as { url_citation?: { url?: unknown } } | null)?.url_citation?.url;
      if (typeof url === "string") urls.push(url);
    }
  }
  return urls;
}

/** Citation URLs produced by search tools in the running turn transcript. */
export function searchCitationUrls(messages: readonly OpenRouterMessage[] | undefined): Set<string> {
  const urls = new Set<string>();
  if (!messages) return urls;
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) toolNames.set(call.id, call.function.name);
  }
  for (const message of messages) {
    if (message.role !== "tool" || !message.tool_call_id || typeof message.content !== "string") continue;
    if (!SEARCH_CITATION_TOOLS.has(toolNames.get(message.tool_call_id) ?? "")) continue;
    for (const url of citationUrlsFromPayload(message.content)) urls.add(url.trim());
  }
  return urls;
}

export function isCitedSearchUrl(
  candidates: readonly string[],
  messages: readonly OpenRouterMessage[] | undefined,
): boolean {
  const cited = searchCitationUrls(messages);
  return candidates.some((candidate) => cited.has(candidate));
}

export function textContainsUrl(text: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => text.includes(candidate));
}
