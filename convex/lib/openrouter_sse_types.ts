import {
  OnDelta,
  OnReasoningDelta,
  OpenRouterUsage,
  PerplexityAnnotation,
  ToolCall,
  ToolCallDelta,
} from "./openrouter_types";

export interface SSEEvent {
  event?: string;
  data: string;
}

export interface SSEEventResult {
  contentDelta?: string;
  reasoningDelta?: string;
  audioDelta?: string;
  audioTranscriptDelta?: string;
  /** Incremental tool-call chunks from a single SSE event. */
  toolCallDeltas?: ToolCallDelta[];
  /** Perplexity URL citation annotations from this SSE event. */
  annotations?: PerplexityAnnotation[];
  usage?: OpenRouterUsage;
  finishReason?: string;
  imageUrls?: string[];
  done?: boolean;
  /**
   * True only for the `[DONE]` sentinel. The stream reader should keep
   * processing events after `done` (which fires on `finish_reason`) so that
   * the subsequent usage-only chunk is not dropped.  Only `terminal` should
   * cause the reader to cancel the underlying transport.
   */
  terminal?: boolean;
  error?: string;
  /** OpenRouter generation ID (top-level `id` field on every SSE chunk). */
  generationId?: string;
}

export interface SSEAccumulator {
  content: string;
  reasoning: string;
  usage: OpenRouterUsage | null;
  finishReason: string | null;
  imageUrls: string[];
  audioChunks: string[];
  audioTranscript: string;
  /**
   * Partial tool calls being assembled from streaming deltas.
   * Keyed by delta `index` — each entry accumulates `id`, `name`, and
   * `arguments` fragments until the stream finishes.
   */
  toolCallsInProgress: Map<number, { id: string; name: string; arguments: string }>;
  /** Fully-assembled tool calls (frozen when the stream ends). */
  toolCalls: ToolCall[];
  /** Perplexity URL citation annotations accumulated across all SSE chunks. */
  annotations: PerplexityAnnotation[];
  /** OpenRouter generation ID extracted from the top-level `id` on the first SSE chunk. */
  generationId: string | null;
}

export interface SSECallbacks {
  onDelta?: OnDelta;
  onReasoningDelta?: OnReasoningDelta;
  /** Called when a new tool call name first appears in the stream (before args are complete). */
  onToolCallStart?: (toolCall: { index: number; id: string; name: string }) => Promise<void>;
}
