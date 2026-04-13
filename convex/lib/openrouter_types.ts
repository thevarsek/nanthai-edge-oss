// Shared OpenRouter type definitions used by chat and autonomous flows.

// ---------------------------------------------------------------------------
// Tool-call types (OpenAI-compatible format returned by OpenRouter)
// ---------------------------------------------------------------------------

/** A fully-assembled tool call (after merging streaming deltas). */
export interface ToolCall {
  /** Unique ID assigned by the model (e.g. "call_abc123"). */
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded arguments string. */
    arguments: string;
  };
}

/**
 * Partial tool-call chunk received during streaming.
 * The model sends incremental pieces: index identifies which call is being
 * built, and `function.name` / `function.arguments` arrive over multiple
 * deltas.
 */
export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: {
    name?: string;
    arguments?: string;
  };
}

/** Tool definition sent in the request `tools` array (user-defined function). */
export interface FunctionToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * OpenRouter server tool definition.
 * Server tools are executed by OpenRouter transparently — the model decides
 * when/whether to invoke them, and OpenRouter handles execution server-side.
 */
export interface ServerToolDefinition {
  type: `openrouter:${string}`;
  /** Server-tool-specific parameters (e.g. max_results for web_search). */
  parameters?: Record<string, unknown>;
}

/**
 * Union of user-defined function tools and OpenRouter server tools.
 * The `tools` array sent to OpenRouter can contain both types.
 */
export type ToolDefinition = FunctionToolDefinition | ServerToolDefinition;

/** Controls which tool (if any) the model should call. */
export type ToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  name?: string;
  /** Present on assistant messages that contain tool calls. */
  tool_calls?: ToolCall[];
  /** Present on tool-result messages — matches the tool call's `id`. */
  tool_call_id?: string;
}

export interface ContentPart {
  type: "text" | "image_url" | "file" | "input_audio" | "video_url";
  text?: string;
  image_url?: { url: string; detail?: "auto" | "low" | "high" };
  file?: { filename: string; file_data: string };
  input_audio?: { data: string; format: string };
  video_url?: { url: string };
}

export interface ChatRequestParameters {
  temperature?: number | null;
  maxTokens?: number | null;
  includeReasoning?: boolean | null;
  reasoningEffort?: string | null;
  modalities?: string[] | null;
  audio?: { voice: string; format: string } | null;
  imageConfig?: { aspectRatio?: string; imageSize?: string } | null;
  plugins?: { id: string }[] | null;
  webSearchEnabled?: boolean;
  /**
   * Cap on cumulative web search results across all searches in a single
   * OpenRouter API call. Default: 15 (= max 3 searches at 5 results each).
   * Subagents use 5 (= 1 search max). Only relevant when webSearchEnabled.
   */
  webSearchMaxTotalResults?: number;
  transforms?: string[] | null;
  /** Tool definitions to send to the model. */
  tools?: ToolDefinition[] | null;
  /** Controls which tool the model should call. */
  toolChoice?: ToolChoice | null;
}

export interface OpenRouterUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  isByok?: boolean;
  // prompt_tokens_details
  cachedTokens?: number;
  cacheWriteTokens?: number;
  audioPromptTokens?: number;
  videoTokens?: number;
  // completion_tokens_details
  reasoningTokens?: number;
  imageCompletionTokens?: number;
  audioCompletionTokens?: number;
  // cost_details
  upstreamInferenceCost?: number;
  upstreamInferencePromptCost?: number;
  upstreamInferenceCompletionsCost?: number;
  // server_tool_use
  webSearchRequests?: number;
}

export interface StreamResult {
  content: string;
  reasoning: string;
  usage: OpenRouterUsage | null;
  finishReason: string | null;
  imageUrls: string[];
  audioBase64: string;
  audioTranscript: string;
  /** Fully-assembled tool calls (present when finishReason is "tool_calls"). */
  toolCalls: ToolCall[];
  /** Perplexity URL citation annotations accumulated from the stream. */
  annotations: PerplexityAnnotation[];
  /** OpenRouter generation ID (top-level `id` on SSE chunks). */
  generationId: string | null;
}

export interface NonStreamResult {
  content: string;
  usage: OpenRouterUsage | null;
  finishReason: string | null;
  audioBase64: string;
  audioTranscript: string;
  /** OpenRouter generation ID (top-level `id` on the response body). */
  generationId: string | null;
}

// ---------------------------------------------------------------------------
// Perplexity annotation types (shared by streaming + non-streaming paths)
// ---------------------------------------------------------------------------

/** A single Perplexity URL citation annotation. */
export interface PerplexityAnnotation {
  type: "url_citation";
  url_citation: {
    url: string;
    title?: string;
    start_index?: number;
    end_index?: number;
  };
}

/**
 * Given accumulated Perplexity annotations and raw content containing
 * `[1]`, `[2]`, etc., resolve the inline references to markdown links.
 * Returns the resolved content string.
 */
export function resolvePerplexityCitations(
  content: string,
  annotations: PerplexityAnnotation[],
): string {
  if (annotations.length === 0) return content;

  // Build 1-based citation map (same order annotations arrived).
  const citationMap = new Map<number, { url: string; title: string }>();
  annotations.forEach((a, i) => {
    if (a.url_citation?.url) {
      citationMap.set(i + 1, {
        url: a.url_citation.url,
        title: a.url_citation.title ?? a.url_citation.url,
      });
    }
  });

  // First pass: resolve [N] markers to markdown links.
  let resolved = content.replace(/\[(\d+)\]/g, (_match, numStr) => {
    const num = parseInt(numStr, 10);
    const cite = citationMap.get(num);
    if (cite) {
      return `[${num}. ${cite.title}](${cite.url})`;
    }
    return _match;
  });

  // Second pass: ensure a space before each resolved citation link so it
  // doesn't glue to the preceding word (e.g. `models.[1. …](…)`) and
  // consecutive citations like `…)(url1)[2. …](url2)` get separated.
  resolved = resolved.replace(
    /(\S)(\[\d+\. )/g,
    (_m, before: string, link: string) => `${before} ${link}`,
  );

  return resolved;
}

/** Callback invoked with each text delta during streaming. */
export type OnDelta = (delta: string) => Promise<void>;

/** Callback invoked with each reasoning delta during streaming. */
export type OnReasoningDelta = (delta: string) => Promise<void>;

/** Configuration for retry behavior. */
export interface RetryConfig {
  /** Maximum retries for empty stream responses. Default: 2 */
  emptyStreamRetries?: number;
  /** Backoff delays in ms for empty stream retries. Default: [500, 1500] */
  emptyStreamBackoffs?: number[];
  /** Fallback model to try if primary model fails entirely. */
  fallbackModel?: string;
  /** Whether to retry on unsupported parameter errors. Default: true */
  retryOnUnsupportedParam?: boolean;
  /**
   * Maximum retries for transient network errors (socket closed, fetch failed,
   * connection reset). Default: 1
   */
  networkRetries?: number;
  /** Backoff delay in ms before a network retry. Default: 2000 */
  networkRetryDelayMs?: number;
}
