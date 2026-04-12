// convex/chat/actions_run_generation_loop.ts
// =============================================================================
// Compaction-aware generation wrapper.
//
// Wraps callOpenRouterStreaming + runToolCallLoop with compaction checks
// between tool rounds. Uses the `shouldExitLoop` callback to break out of
// the tool loop when context overflow (85% of model limit) or approaching
// action timeout (7-min mark) is detected. Then prunes old tool outputs
// and (if needed) calls a fast LLM to summarise the conversation before
// continuing with fresh context.
//
// Only activates during tool-call loops — normal chat flows through
// unchanged.
// =============================================================================

import {
  callOpenRouterStreaming,
  ChatRequestParameters,
  OnDelta,
  OnReasoningDelta,
  OpenRouterMessage,
  OpenRouterUsage,
  RetryConfig,
  StreamResult,
  ToolCall,
} from "../lib/openrouter";
import { COMPACTION } from "../lib/compaction_constants";
import {
  isContextOverflow,
  isApproachingTimeout,
  pruneToolOutputs,
  compactMessages,
  buildCompactedMessages,
} from "./compaction";
import {
  DeferredToolRound,
  runToolCallLoop,
  RecordedToolCall,
  RecordedToolResult,
  ToolCallLoopOptions,
} from "../tools/execute_loop";
import { ToolExecutionContext, ToolRegistry, ToolResult } from "../tools/registry";
import { StreamWriter } from "./stream_writer";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerationLoopResult {
  /** The final StreamResult from the last model call. */
  streamResult: StreamResult;
  /** All tool calls across all rounds (including across compaction cycles). */
  allToolCalls: RecordedToolCall[];
  /** All tool results across all rounds (including across compaction cycles). */
  allToolResults: RecordedToolResult[];
  /** Aggregated usage across all segments (initial + post-compaction). */
  totalUsage: OpenRouterUsage | null;
  /** Number of compaction cycles that occurred. */
  compactionCount: number;
  /** Deferred async tool round that paused the parent workflow. */
  deferredToolRound?: DeferredToolRound;
  /** Safe continuation checkpoint for callers that support cross-action resume. */
  continuation?: {
    reason: "timeout" | "round_budget";
    messages: OpenRouterMessage[];
  };
  /** M23: Compaction usage records for ancillary cost tracking. */
  compactionUsages: Array<{
    usage: OpenRouterUsage;
    generationId: string | null;
    modelId: string;
  }>;
}

export interface GenerationLoopOptions {
  // Same inputs as callOpenRouterStreaming + runToolCallLoop
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  params: ChatRequestParameters;
  callbacks: { onDelta?: OnDelta; onReasoningDelta?: OnReasoningDelta };
  retryConfig?: RetryConfig;
  toolRegistry?: ToolRegistry;
  toolCtx: ToolExecutionContext;
  onToolRoundStart?: (round: number, toolCalls: ToolCall[]) => Promise<void>;
  onToolRoundComplete?: (
    round: number,
    results: Array<{ toolCallId: string; result: ToolResult }>,
  ) => Promise<void>;
  onPrepareNextTurn?: ToolCallLoopOptions["onPrepareNextTurn"];
  // Compaction-specific
  modelContextLimit: number;
  writer: StreamWriter;
  actionStartTime: number;
  allowContinuationHandoff?: boolean;
  initialTotalUsage?: OpenRouterUsage | null;
  initialToolCalls?: RecordedToolCall[];
  initialToolResults?: RecordedToolResult[];
  initialCompactionCount?: number;
  maxToolRoundsPerInvocation?: number;
}

const defaultRunGenerationWithCompactionDeps = {
  callOpenRouterStreaming,
  runToolCallLoop,
  isContextOverflow,
  isApproachingTimeout,
  pruneToolOutputs,
  compactMessages,
  buildCompactedMessages,
};

export type RunGenerationWithCompactionDeps =
  typeof defaultRunGenerationWithCompactionDeps;

export function createRunGenerationWithCompactionDepsForTest(
  overrides: DeepPartial<RunGenerationWithCompactionDeps> = {},
): RunGenerationWithCompactionDeps {
  return mergeTestDeps(defaultRunGenerationWithCompactionDeps, overrides);
}

// ---------------------------------------------------------------------------
// Usage aggregation
// ---------------------------------------------------------------------------

/** Sum two optional numbers: returns undefined when both are undefined. */
function sumOptional(a?: number, b?: number): number | undefined {
  if (a == null && b == null) return undefined;
  return (a ?? 0) + (b ?? 0);
}

function aggregateUsage(
  existing: OpenRouterUsage | null,
  incoming: OpenRouterUsage | null,
): OpenRouterUsage | null {
  if (!incoming) return existing;
  if (!existing) return incoming;
  return {
    promptTokens: existing.promptTokens + incoming.promptTokens,
    completionTokens: existing.completionTokens + incoming.completionTokens,
    totalTokens: existing.totalTokens + incoming.totalTokens,
    cost: sumOptional(existing.cost, incoming.cost),
    // isByok: use the latest value (not summable)
    isByok: incoming.isByok ?? existing.isByok,
    cachedTokens: sumOptional(existing.cachedTokens, incoming.cachedTokens),
    cacheWriteTokens: sumOptional(existing.cacheWriteTokens, incoming.cacheWriteTokens),
    audioPromptTokens: sumOptional(existing.audioPromptTokens, incoming.audioPromptTokens),
    videoTokens: sumOptional(existing.videoTokens, incoming.videoTokens),
    reasoningTokens: sumOptional(existing.reasoningTokens, incoming.reasoningTokens),
    imageCompletionTokens: sumOptional(existing.imageCompletionTokens, incoming.imageCompletionTokens),
    audioCompletionTokens: sumOptional(existing.audioCompletionTokens, incoming.audioCompletionTokens),
    upstreamInferenceCost: sumOptional(existing.upstreamInferenceCost, incoming.upstreamInferenceCost),
    upstreamInferencePromptCost: sumOptional(existing.upstreamInferencePromptCost, incoming.upstreamInferencePromptCost),
    upstreamInferenceCompletionsCost: sumOptional(existing.upstreamInferenceCompletionsCost, incoming.upstreamInferenceCompletionsCost),
  };
}

// ---------------------------------------------------------------------------
// Extract system prompt from the message array
// ---------------------------------------------------------------------------

function extractSystemPrompt(
  messages: OpenRouterMessage[],
): string | undefined {
  const systemMsg = messages.find((m) => m.role === "system");
  if (!systemMsg) return undefined;
  return typeof systemMsg.content === "string"
    ? systemMsg.content
    : undefined;
}

/**
 * Find the last user message in the array.
 */
function findLastUserMessage(
  messages: OpenRouterMessage[],
): OpenRouterMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Main wrapper
// ---------------------------------------------------------------------------

/**
 * Run the generation pipeline with compaction support.
 *
 * For simple requests (no tool calls), this behaves identically to
 * `callOpenRouterStreaming` — the compaction layer adds zero overhead.
 *
 * For tool-call loops, after each tool round the wrapper checks:
 *   1. Is elapsed time approaching the 10-min action timeout?
 *   2. Did promptTokens exceed 85% of the model's context limit?
 *
 * If either triggers, it:
 *   a. Flushes the StreamWriter (ensures partial content is persisted)
 *   b. Prunes verbose tool outputs from older rounds
 *   c. If still over threshold, calls the compaction model for a summary
 *   d. Replaces message history with [system prompt, summary, last user msg]
 *   e. Continues the tool loop with fresh context
 *
 * Max compaction cycles: COMPACTION.MAX_CONTINUATIONS (5).
 */
export async function runGenerationWithCompaction(
  options: GenerationLoopOptions,
  deps: RunGenerationWithCompactionDeps = defaultRunGenerationWithCompactionDeps,
): Promise<GenerationLoopResult> {
  const {
    apiKey,
    model,
    callbacks,
    retryConfig,
    toolCtx,
    onToolRoundStart,
    onToolRoundComplete,
    modelContextLimit,
    writer,
    actionStartTime,
  } = options;

  // Mutable — progressive tool loading may expand the registry/params
  // within the tool-call loop, and compaction must preserve those expansions.
  let currentParams = options.params;
  let currentToolRegistry = options.toolRegistry;

  let currentMessages = [...options.messages];
  let totalUsage: OpenRouterUsage | null = options.initialTotalUsage ?? null;
  let compactionCount = options.initialCompactionCount ?? 0;
  const allToolCalls: RecordedToolCall[] = [...(options.initialToolCalls ?? [])];
  const allToolResults: RecordedToolResult[] = [...(options.initialToolResults ?? [])];
  // M23: Collect compaction usage records for ancillary cost tracking.
  const compactionUsages: GenerationLoopResult["compactionUsages"] = [];

  // Outer loop: each iteration is one "segment" (initial or post-compaction).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // --- 1. Initial streaming call ---
    const streamResult = await deps.callOpenRouterStreaming(
      apiKey,
      model,
      currentMessages,
      currentParams,
      callbacks,
      retryConfig,
    );

    totalUsage = aggregateUsage(totalUsage, streamResult.usage);

    // After the initial streaming call, disable web search for all subsequent
    // re-calls (tool-loop rounds, compaction re-entries, final forced text).
    // Web grounding from the first call is already in the conversation context;
    // re-running the plugin on tool-result rounds wastes ~$0.02/round (Exa).
    currentParams = { ...currentParams, webSearchEnabled: false };

    // --- 2. If no tool calls, we're done ---
    if (
      !currentToolRegistry ||
      currentToolRegistry.isEmpty ||
      streamResult.finishReason !== "tool_calls" ||
      streamResult.toolCalls.length === 0
    ) {
      return {
        streamResult,
        allToolCalls,
        allToolResults,
        totalUsage,
        compactionCount,
        deferredToolRound: undefined,
        continuation: undefined,
        compactionUsages,
      };
    }

    // --- 3. Run the tool-call loop with compaction checks ---
    // We inject a `shouldExitLoop` callback that checks for context overflow
    // and approaching timeout after every model re-call. When it trips, the
    // loop returns with `exitedEarly=true` so the outer wrapper can compact
    // and continue instead of waiting for Convex to hit the hard timeout.
    await writer.patchReasoningIfNeeded(true);

    const loopOptions: ToolCallLoopOptions = {
      apiKey,
      model,
      messages: currentMessages,
      params: currentParams,
      callbacks,
      retryConfig,
      registry: currentToolRegistry,
      toolCtx,
      onToolRoundStart,
      onToolRoundComplete,
      onPrepareNextTurn: options.onPrepareNextTurn,
      maxRoundsPerInvocation: options.maxToolRoundsPerInvocation,
      shouldExitLoop: async (_round, roundResult) => {
        const roundUsage = roundResult.usage;
        const contextOverflow = roundUsage
          ? deps.isContextOverflow(roundUsage.promptTokens, modelContextLimit)
          : false;
        const timeoutApproaching = deps.isApproachingTimeout(actionStartTime);
        return contextOverflow || timeoutApproaching;
      },
    };

    const loopResult = await deps.runToolCallLoop(streamResult, loopOptions);

    // Preserve any progressive registry/params expansions from the inner loop
    // so they survive compaction cycles.
    // AUDIT-3: The inner loop's onPrepareNextTurn may have re-spread the
    // original gatedParams (which included webSearchEnabled: true) into
    // finalParams. Strip it here so subsequent compaction re-entries don't
    // pay $0.02/round for Exa web search.
    currentToolRegistry = loopResult.finalRegistry;
    currentParams = { ...loopResult.finalParams, webSearchEnabled: false };

    totalUsage = aggregateUsage(totalUsage, loopResult.streamResult.usage);
    allToolCalls.push(...loopResult.allToolCalls);
    allToolResults.push(...loopResult.allToolResults);

    if (loopResult.deferredToolRound) {
      return {
        streamResult: loopResult.streamResult,
        allToolCalls,
        allToolResults,
        totalUsage,
        compactionCount,
        deferredToolRound: loopResult.deferredToolRound,
        continuation: undefined,
        compactionUsages,
      };
    }

    if (loopResult.exitReason === "round_budget" && options.allowContinuationHandoff) {
      return {
        streamResult: loopResult.streamResult,
        allToolCalls,
        allToolResults,
        totalUsage,
        compactionCount,
        deferredToolRound: undefined,
        continuation: {
          reason: "round_budget",
          messages: loopResult.conversationMessages,
        },
        compactionUsages,
      };
    }

    // --- 4. Check if compaction is needed ---
    const lastUsage = loopResult.streamResult.usage;
    const needsContextCompaction = lastUsage
      ? deps.isContextOverflow(lastUsage.promptTokens, modelContextLimit)
      : false;
    const needsTimeoutCompaction = deps.isApproachingTimeout(actionStartTime);

    // If the loop did not exit early for compaction and there is no further
    // tool work to do, we're done.
    if (
      !loopResult.exitedEarly &&
      (
        (!needsContextCompaction && !needsTimeoutCompaction) ||
        loopResult.streamResult.finishReason !== "tool_calls"
      )
    ) {
      return {
        streamResult: loopResult.streamResult,
        allToolCalls,
        allToolResults,
        totalUsage,
        compactionCount,
        deferredToolRound: loopResult.deferredToolRound,
        continuation: undefined,
        compactionUsages,
      };
    }

    // Hit the continuation cap — force a final text response so the user
    // doesn't see a dangling tool_calls finish reason.
    // AUDIT-5: Also strip webSearchEnabled to avoid a $0.02 Exa charge.
    if (compactionCount >= COMPACTION.MAX_CONTINUATIONS) {
      const finalMessages = loopResult.conversationMessages;
      const finalResult = await deps.callOpenRouterStreaming(
        apiKey,
        model,
        finalMessages,
        { ...currentParams, toolChoice: "none", webSearchEnabled: false },
        callbacks,
        retryConfig,
      );
      totalUsage = aggregateUsage(totalUsage, finalResult.usage);
      return {
        streamResult: finalResult,
        allToolCalls,
        allToolResults,
        totalUsage,
        compactionCount,
        deferredToolRound: undefined,
        continuation: undefined,
        compactionUsages,
      };
    }

    // --- 5. Compaction needed — compress and continue ---
    compactionCount++;

    // Flush any pending stream content before compaction pause.
    await writer.flush();

    // Use the full conversation messages from the tool-call loop — these
    // include the original messages PLUS all assistant tool_calls and tool
    // result messages that were appended during execution. This is critical
    // because `currentMessages` alone is stale (missing tool rounds), so
    // pruning/compacting it would miss the verbose content that caused the
    // overflow.
    const fullConversation = loopResult.conversationMessages;

    // Step 5a: Try pruning first.
    const pruneResult = deps.pruneToolOutputs(fullConversation);

    // Short-circuit: if pruning recovered significant tokens and we triggered
    // on context overflow (not timeout), continue with pruned messages directly
    // instead of paying for a compaction model call.
    if (
      pruneResult.tokensSaved > 0 &&
      needsContextCompaction &&
      !needsTimeoutCompaction
    ) {
      currentMessages = pruneResult.messages;
      continue;
    }

    let conversationToCompact = pruneResult.messages;

    // Step 5b: Call the compaction model for a summary.
    const systemPrompt = extractSystemPrompt(options.messages);
    const lastUserMessage = findLastUserMessage(options.messages);

    const compactionResult = await deps.compactMessages(
      conversationToCompact,
      apiKey,
    );

    // M23: Collect compaction usage for ancillary cost tracking.
    if (compactionResult.usage) {
      compactionUsages.push({
        usage: compactionResult.usage,
        generationId: compactionResult.generationId,
        modelId: compactionResult.modelId,
      });
    }

    // Step 5c: Replace message history with compacted context.
    currentMessages = deps.buildCompactedMessages(
      systemPrompt,
      compactionResult.summary,
      lastUserMessage,
    );

    if (needsTimeoutCompaction && options.allowContinuationHandoff) {
      return {
        streamResult: loopResult.streamResult,
        allToolCalls,
        allToolResults,
        totalUsage,
        compactionCount,
        deferredToolRound: undefined,
        continuation: {
          reason: "timeout",
          messages: currentMessages,
        },
        compactionUsages,
      };
    }

    // Continue the outer loop — the next iteration will call the model
    // with the compacted messages and resume tool calling.
  }
}
