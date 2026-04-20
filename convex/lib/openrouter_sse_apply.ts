import { ConvexError } from "convex/values";
import { ToolCallDelta } from "./openrouter_types";
import { SSEAccumulator, SSECallbacks, SSEEventResult } from "./openrouter_sse_types";

/**
 * Merge a batch of streaming tool-call deltas into the accumulator.
 *
 * OpenRouter (OpenAI-compatible) sends incremental chunks:
 *   - First delta for index N carries `id`, `type`, `function.name`
 *   - Subsequent deltas for index N carry `function.arguments` fragments
 *
 * We merge them in `toolCallsInProgress` keyed by `index`, then freeze the
 * full list into `toolCalls` when the stream finishes.
 */
function mergeToolCallDeltas(
  deltas: ToolCallDelta[],
  state: SSEAccumulator,
): void {
  for (const delta of deltas) {
    const idx = delta.index;
    let entry = state.toolCallsInProgress.get(idx);
    if (!entry) {
      entry = { id: "", name: "", arguments: "" };
      state.toolCallsInProgress.set(idx, entry);
    }
    if (delta.id) entry.id = delta.id;
    if (delta.function?.name) entry.name += delta.function.name;
    if (delta.function?.arguments) entry.arguments += delta.function.arguments;
  }
}

/**
 * Freeze all in-progress tool calls into the final `toolCalls` array.
 * Called once when the stream signals completion.
 */
export function finalizeToolCalls(state: SSEAccumulator): void {
  if (state.toolCallsInProgress.size === 0) return;

  // Sort by index to preserve the model's intended order.
  const sorted = Array.from(state.toolCallsInProgress.entries()).sort(
    ([a], [b]) => a - b,
  );
  state.toolCalls = sorted.map(([, entry]) => ({
    id: entry.id,
    type: "function" as const,
    function: {
      name: entry.name,
      arguments: entry.arguments,
    },
  }));
}

export async function applySSEEventResult(
  result: SSEEventResult,
  state: SSEAccumulator,
  callbacks: SSECallbacks,
): Promise<boolean> {
  if (result.error) {
    throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: `OpenRouter stream error: ${result.error}` });
  }

  // Accumulate reasoning BEFORE content so that when the content callback
  // fires shouldForceReasoningPatchOnContentStart, the reasoning from this
  // same SSE event is already included in the total.
  if (result.reasoningDelta) {
    state.reasoning += result.reasoningDelta;
    if (callbacks.onReasoningDelta) {
      await callbacks.onReasoningDelta(result.reasoningDelta);
    }
  }

  if (result.contentDelta) {
    state.content += result.contentDelta;
    if (callbacks.onDelta) {
      await callbacks.onDelta(result.contentDelta);
    }
  }

  if (result.audioDelta) {
    state.audioChunks.push(result.audioDelta);
  }
  if (result.audioTranscriptDelta) {
    state.audioTranscript += result.audioTranscriptDelta;
  }

  // Merge incremental tool-call fragments.
  if (result.toolCallDeltas) {
    // Track which indices already had a name before this batch.
    const previouslyNamed = callbacks.onToolCallStart
      ? new Set(
          Array.from(state.toolCallsInProgress.entries())
            .filter(([, e]) => e.name.length > 0)
            .map(([idx]) => idx),
        )
      : undefined;

    mergeToolCallDeltas(result.toolCallDeltas, state);

    // Fire onToolCallStart for any tool call that just gained a name.
    if (callbacks.onToolCallStart && previouslyNamed) {
      for (const [idx, entry] of state.toolCallsInProgress) {
        if (entry.name.length > 0 && !previouslyNamed.has(idx)) {
          await callbacks.onToolCallStart({ index: idx, id: entry.id, name: entry.name });
        }
      }
    }
  }

  // Accumulate Perplexity annotations (url_citation).
  if (result.annotations) {
    state.annotations.push(...result.annotations);
  }

  if (result.usage) state.usage = result.usage;
  if (result.finishReason) state.finishReason = result.finishReason;
  if (result.imageUrls) state.imageUrls.push(...result.imageUrls);
  // Capture the first generation ID we see — it is stable across all chunks.
  if (result.generationId && !state.generationId) {
    state.generationId = result.generationId;
  }

  // When the stream signals done, freeze in-progress tool calls.
  if (result.done) {
    finalizeToolCalls(state);
  }

  // Only cancel the stream reader on the [DONE] sentinel (terminal).
  // finish_reason arrives on an earlier chunk; the usage-only chunk follows
  // it and must not be dropped.
  return result.terminal === true;
}
