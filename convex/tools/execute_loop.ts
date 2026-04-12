// convex/tools/execute_loop.ts
// =============================================================================
// Tool-call execution loop for the OpenRouter streaming pipeline.
//
// When a model response finishes with `finish_reason: "tool_calls"`, this
// module executes the requested tools, builds tool-result messages, and
// re-calls OpenRouter — looping until the model produces a final text
// response or we hit the iteration cap.
// =============================================================================

import {
  callOpenRouterStreaming,
  ChatRequestParameters,
  OnDelta,
  OnReasoningDelta,
  OpenRouterMessage,
  RetryConfig,
  StreamResult,
  ToolCall,
} from "../lib/openrouter";
import {
  ToolDeferredPayload,
  ToolExecutionContext,
  ToolRegistry,
  ToolResult,
} from "./registry";
import { DeepPartial, mergeTestDeps } from "../lib/test_deps";

const defaultToolCallLoopDeps = {
  callOpenRouterStreaming,
};

export type ToolCallLoopDeps = typeof defaultToolCallLoopDeps;

export function createToolCallLoopDepsForTest(
  overrides: DeepPartial<ToolCallLoopDeps> = {},
): ToolCallLoopDeps {
  return mergeTestDeps(defaultToolCallLoopDeps, overrides);
}

/** Maximum number of tool-call rounds before we force the model to stop. */
export const MAX_TOOL_ROUNDS = 20;

/**
 * Maximum length of a tool result's JSON string stored in the message.
 * Keeps the messages table from bloating with huge tool outputs (e.g. CSV data).
 */
const MAX_TOOL_RESULT_STORE_CHARS = 4000;

/** A recorded tool call for structured persistence. */
export interface RecordedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** A recorded tool result for structured persistence. */
export interface RecordedToolResult {
  toolCallId: string;
  toolName: string;
  result: string;
  isError?: boolean;
}

/** Extended result from `runToolCallLoop` including accumulated tool metadata. */
export interface ToolCallLoopResult {
  /** The final StreamResult from the last model call. */
  streamResult: StreamResult;
  /**
   * True when `shouldExitLoop` requested an early break so the caller can
   * compact or otherwise continue the workflow instead of treating the result
   * as the terminal response.
   */
  exitedEarly: boolean;
  exitReason?: "round_budget" | "should_exit";
  /** All tool calls across all rounds, in execution order. */
  allToolCalls: RecordedToolCall[];
  /** All tool results across all rounds, in execution order. */
  allToolResults: RecordedToolResult[];
  /**
   * The full conversation messages including all tool-round messages
   * (assistant tool_calls + tool results). Needed by the compaction layer
   * to prune/summarise the actual messages the model saw.
   */
  conversationMessages: OpenRouterMessage[];
  /** Async-pausing tool round, when a tool requested deferred continuation. */
  deferredToolRound?: DeferredToolRound;
  /**
   * The final tool registry after any progressive expansions from
   * `onPrepareNextTurn`. Callers (e.g. compaction wrapper) should use
   * this to avoid losing expanded tools across compaction cycles.
   */
  finalRegistry: ToolRegistry;
  /**
   * The final request params after any progressive expansions.
   */
  finalParams: ChatRequestParameters;
}

export interface DeferredToolRound {
  round: number;
  baseConversationMessages: OpenRouterMessage[];
  resumeConversationMessages: OpenRouterMessage[];
  toolCalls: ToolCall[];
  recordedToolCalls: RecordedToolCall[];
  recordedToolResults: RecordedToolResult[];
  deferredResults: Array<{
    toolCallId: string;
    toolName: string;
    payload: ToolDeferredPayload;
  }>;
}

/** Options for the tool-call loop. */
export interface ToolCallLoopOptions {
  apiKey: string;
  model: string;
  /** The message history as sent for the initial request. */
  messages: OpenRouterMessage[];
  params: ChatRequestParameters;
  callbacks: {
    onDelta?: OnDelta;
    onReasoningDelta?: OnReasoningDelta;
  };
  retryConfig?: RetryConfig;
  /** The registry containing all available tools. */
  registry: ToolRegistry;
  /** Context for tool execution (Convex ctx + userId). */
  toolCtx: ToolExecutionContext;
  /**
   * Optional callback invoked before each tool execution round.
   * Can be used to update UI status, check cancellation, etc.
   */
  onToolRoundStart?: (round: number, toolCalls: ToolCall[]) => Promise<void>;
  /**
   * Optional callback invoked after each tool execution round with results.
   */
  onToolRoundComplete?: (
    round: number,
    results: Array<{ toolCallId: string; result: ToolResult }>,
  ) => Promise<void>;
  /**
   * Optional callback invoked after a tool round completes but before the
   * next model call is made. Allows callers to expand the active registry and
   * rebuild the next-turn params (for progressive skill/tool loading).
   */
  onPrepareNextTurn?: (
    round: number,
    toolCalls: ToolCall[],
    results: Array<{ toolCallId: string; result: ToolResult }>,
    currentRegistry: ToolRegistry,
    currentParams: ChatRequestParameters,
  ) => Promise<{
    registry?: ToolRegistry;
    params?: ChatRequestParameters;
  } | void>;
  /**
   * Optional callback invoked after each model re-call in the loop.
   * If it returns `true`, the loop exits early (used by compaction
   * to break out when context overflow or timeout is detected).
   * Receives the latest StreamResult so the caller can inspect usage.
   */
  shouldExitLoop?: (
    round: number,
    streamResult: StreamResult,
  ) => Promise<boolean>;
  /** Optional hard cap for how many tool rounds this invocation may execute. */
  maxRoundsPerInvocation?: number;
}

/**
 * Build OpenRouterMessage entries for a tool-call round:
 * 1. An assistant message carrying the tool_calls (content: null)
 * 2. One tool-result message per executed tool call
 */
function buildToolRoundMessages(
  toolCalls: ToolCall[],
  results: Array<{ toolCallId: string; result: ToolResult }>,
): OpenRouterMessage[] {
  const messages: OpenRouterMessage[] = [];

  // The assistant message that requested the tool calls.
  messages.push({
    role: "assistant",
    content: null,
    tool_calls: toolCalls,
  });

  // One tool-result message per call.
  for (const { toolCallId, result } of results) {
    messages.push({
      role: "tool",
      tool_call_id: toolCallId,
      content: JSON.stringify(result.success ? result.data : { error: result.error }),
    });
  }

  return messages;
}

/**
 * Truncate a string to `MAX_TOOL_RESULT_STORE_CHARS` for persistence.
 */
function truncateForStorage(str: string): string {
  if (str.length <= MAX_TOOL_RESULT_STORE_CHARS) return str;
  return str.slice(0, MAX_TOOL_RESULT_STORE_CHARS) + "…[truncated]";
}

/**
 * Run the tool-call loop. Takes an initial `StreamResult` (which may or may
 * not contain tool calls) and loops until the model produces a final text
 * response.
 *
 * Returns a `ToolCallLoopResult` containing the final `StreamResult` plus
 * accumulated tool calls and results across all rounds.
 *
 * If the initial result has no tool calls (`finishReason !== "tool_calls"`),
 * it is returned immediately with empty tool data.
 */
export async function runToolCallLoop(
  initialResult: StreamResult,
  options: ToolCallLoopOptions,
  deps: ToolCallLoopDeps = defaultToolCallLoopDeps,
): Promise<ToolCallLoopResult> {
  let currentResult = initialResult;
  let conversationMessages = [...options.messages];
  let currentRegistry = options.registry;
  let currentParams = options.params;
  let round = 0;
  let exitedEarly = false;
  let exitReason: ToolCallLoopResult["exitReason"];
  let deferredToolRound: DeferredToolRound | undefined;

  const allToolCalls: RecordedToolCall[] = [];
  const allToolResults: RecordedToolResult[] = [];

  while (
    currentResult.finishReason === "tool_calls" &&
    currentResult.toolCalls.length > 0 &&
    round < MAX_TOOL_ROUNDS
  ) {
    round++;

    if (options.onToolRoundStart) {
      await options.onToolRoundStart(round, currentResult.toolCalls);
    }

    // Record tool calls for structured persistence.
    for (const tc of currentResult.toolCalls) {
      allToolCalls.push({
        id: tc.id,
        name: tc.function.name,
        arguments: truncateForStorage(tc.function.arguments),
      });
    }

    // Execute all tool calls in parallel to minimise round-trip latency.
    const results = await currentRegistry.executeAllToolCalls(
      currentResult.toolCalls,
      options.toolCtx,
    );

    if (options.onPrepareNextTurn) {
      const nextTurn = await options.onPrepareNextTurn(
        round,
        currentResult.toolCalls,
        results,
        currentRegistry,
        currentParams,
      );
      if (nextTurn?.registry) {
        currentRegistry = nextTurn.registry;
      }
      if (nextTurn?.params) {
        currentParams = nextTurn.params;
      }
    }

    // Append assistant tool-call message + tool results to conversation.
    const roundMessages = buildToolRoundMessages(
      currentResult.toolCalls,
      results,
    );
    conversationMessages = [...conversationMessages, ...roundMessages];

    const deferredResults = results.flatMap(({ toolCallId, result }) => {
      if (!result.deferred) return [];
      const matchingCall = currentResult.toolCalls.find((tc) => tc.id === toolCallId);
      return [{
        toolCallId,
        toolName: matchingCall?.function.name ?? "unknown",
        payload: result.deferred,
      }];
    });

    // Record tool results for structured persistence after any progressive
    // same-round retries or rewrites have been applied.
    for (const { toolCallId, result } of results) {
      const matchingCall = currentResult.toolCalls.find(
        (tc) => tc.id === toolCallId,
      );
      const toolName = matchingCall?.function.name ?? "unknown";
      allToolResults.push({
        toolCallId,
        toolName,
        result: truncateForStorage(
          JSON.stringify(result.success ? result.data : { error: result.error }),
        ),
        isError: result.success ? undefined : true,
      });
    }

    if (options.onToolRoundComplete) {
      await options.onToolRoundComplete(round, results);
    }

    if (deferredResults.length > 0) {
      deferredToolRound = {
        round,
        baseConversationMessages: conversationMessages.slice(0, -roundMessages.length),
        resumeConversationMessages: [...conversationMessages],
        toolCalls: currentResult.toolCalls,
        recordedToolCalls: allToolCalls.slice(),
        recordedToolResults: allToolResults.slice(),
        deferredResults,
      };
      break;
    }

    if (
      options.maxRoundsPerInvocation != null &&
      round >= options.maxRoundsPerInvocation
    ) {
      exitedEarly = true;
      exitReason = "round_budget";
      break;
    }

    // Re-call OpenRouter with the extended conversation.
    // On the final allowed round, force the model NOT to call tools again.
    // Always disable webSearchEnabled on re-calls — web grounding from the
    // initial call is already in the conversation context, and re-running
    // the web plugin on tool-result rounds wastes ~$0.02/round (Exa pricing).
    const isLastAllowedRound = round >= MAX_TOOL_ROUNDS;
    const roundParams: ChatRequestParameters = {
      ...currentParams,
      webSearchEnabled: false,
      ...(isLastAllowedRound ? { toolChoice: "none" as const } : {}),
    };

    currentResult = await deps.callOpenRouterStreaming(
      options.apiKey,
      options.model,
      conversationMessages,
      roundParams,
      options.callbacks,
      options.retryConfig,
    );

    // Allow the caller to break out early (e.g. for mid-loop compaction).
    if (options.shouldExitLoop) {
      const shouldExit = await options.shouldExitLoop(round, currentResult);
      if (shouldExit) {
        exitedEarly = true;
        exitReason = "should_exit";
        break;
      }
    }
  }

  return {
    streamResult: currentResult,
    exitedEarly,
    exitReason,
    allToolCalls,
    allToolResults,
    conversationMessages,
    deferredToolRound,
    finalRegistry: currentRegistry,
    finalParams: currentParams,
  };
}
