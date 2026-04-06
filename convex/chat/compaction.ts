// convex/chat/compaction.ts
// =============================================================================
// Context compaction engine for the tool-call loop.
//
// Provides detection (isContextOverflow, isApproachingTimeout), pruning
// (pruneToolOutputs), and LLM-based summarisation (compactMessages).
//
// Used exclusively by the generation loop wrapper — normal user↔assistant
// chat uses the existing middle-out truncation strategy.
// =============================================================================

import { COMPACTION } from "../lib/compaction_constants";
import { MODEL_IDS } from "../lib/model_constants";
import { callOpenRouterNonStreaming } from "../lib/openrouter_nonstream";
import { OpenRouterMessage, OpenRouterUsage } from "../lib/openrouter_types";

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when prompt tokens exceed the model's context limit threshold.
 * Uses real token counts from OpenRouter usage data, not estimates.
 */
export function isContextOverflow(
  promptTokens: number,
  modelContextLimit: number,
): boolean {
  return promptTokens >= modelContextLimit * COMPACTION.CONTEXT_OVERFLOW_THRESHOLD;
}

/**
 * Returns true when elapsed time is within the timeout buffer of the
 * 10-minute Convex action limit.
 */
export function isApproachingTimeout(startTimeMs: number): boolean {
  const elapsed = Date.now() - startTimeMs;
  return elapsed >= COMPACTION.ACTION_TIMEOUT_MS - COMPACTION.ACTION_TIMEOUT_BUFFER_MS;
}

// ---------------------------------------------------------------------------
// Pruning — strip verbose tool outputs from older rounds
// ---------------------------------------------------------------------------

/** Rough token estimate: ~4 chars per token for English text. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Prune tool-result messages from older rounds to recover context space.
 *
 * Strategy: Walk messages from newest to oldest. Protect the most recent
 * `PRUNE_PROTECT_TOKENS` worth of content. For older tool-result messages,
 * replace their verbose content with a short "[pruned — N chars]" stub.
 *
 * Returns a new array (does not mutate the input) and the estimated token
 * savings. If savings < PRUNE_MINIMUM_SAVINGS, returns the original messages
 * unchanged.
 */
export function pruneToolOutputs(
  messages: OpenRouterMessage[],
): { messages: OpenRouterMessage[]; tokensSaved: number } {
  // Find tool-result messages and estimate their sizes, newest first.
  const toolIndices: Array<{ index: number; tokens: number }> = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "tool") {
      const content = typeof messages[i].content === "string"
        ? (messages[i].content as string)
        : JSON.stringify(messages[i].content ?? "");
      toolIndices.push({ index: i, tokens: estimateTokens(content) });
    }
  }

  if (toolIndices.length === 0) {
    return { messages, tokensSaved: 0 };
  }

  // Protect the newest tool outputs up to PRUNE_PROTECT_TOKENS.
  let protectedTokens = 0;
  const toPrune = new Set<number>();

  for (const entry of toolIndices) {
    if (protectedTokens < COMPACTION.PRUNE_PROTECT_TOKENS) {
      protectedTokens += entry.tokens;
    } else {
      toPrune.add(entry.index);
    }
  }

  if (toPrune.size === 0) {
    return { messages, tokensSaved: 0 };
  }

  // Calculate savings.
  let tokensSaved = 0;
  for (const entry of toolIndices) {
    if (toPrune.has(entry.index)) {
      tokensSaved += entry.tokens;
    }
  }

  if (tokensSaved < COMPACTION.PRUNE_MINIMUM_SAVINGS) {
    return { messages, tokensSaved: 0 };
  }

  // Build pruned message array.
  const pruned = messages.map((msg, i) => {
    if (!toPrune.has(i)) return msg;
    const content = typeof msg.content === "string"
      ? msg.content
      : JSON.stringify(msg.content ?? "");
    return {
      ...msg,
      content: `[pruned — ${content.length} chars]`,
    };
  });

  return { messages: pruned, tokensSaved };
}

// ---------------------------------------------------------------------------
// LLM-based compaction
// ---------------------------------------------------------------------------

const COMPACTION_SYSTEM_PROMPT = `You are summarising a conversation for seamless continuation by another AI model.
Produce a detailed but concise summary covering:

## Goal
What the user is trying to accomplish.

## Key Context
Important instructions, constraints, or preferences the user specified.

## Tool Results
What tools were called and their key results (data retrieved, files generated, errors encountered).
Be specific — the continuing model won't see the original tool outputs.

## Progress
What has been completed, what's in progress, and what remains.

## Current State
The last thing the model was doing when the summary was requested.

Be thorough on tool results since they contain data the user asked for.
Do not respond to any questions in the conversation — only output the summary.`;

/** Result of an LLM-based compaction call. */
export interface CompactionResult {
  summary: string;
  usage: OpenRouterUsage | null;
  generationId: string | null;
  modelId: string;
}

/**
 * Call the compaction model to produce a summary of the conversation.
 *
 * Strips media/images from messages and truncates very long tool outputs
 * before sending to the compaction model, keeping the request small and fast.
 *
 * Returns the summary text along with usage data for cost tracking (M23).
 */
export async function compactMessages(
  messages: OpenRouterMessage[],
  apiKey: string,
): Promise<CompactionResult> {
  // Prepare messages for the compaction model — strip binary content.
  const cleanedMessages = messages.map((msg) => {
    if (Array.isArray(msg.content)) {
      // Multi-part content: keep only text parts.
      const textParts = msg.content
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text!)
        .join("\n");
      return { ...msg, content: textParts || "[non-text content]" };
    }
    return msg;
  });

  // Build the compaction request.
  const compactionMessages: OpenRouterMessage[] = [
    { role: "system", content: COMPACTION_SYSTEM_PROMPT },
    {
      role: "user",
      content:
        "Here is the conversation to summarise:\n\n" +
        cleanedMessages
          .filter((m) => m.role !== "system") // Don't duplicate system prompt
          .map((m) => {
            const role = m.role.toUpperCase();
            const content = typeof m.content === "string"
              ? m.content
              : JSON.stringify(m.content ?? "");
            // Truncate very long individual messages for the compaction call.
            const truncated = content.length > 8000
              ? content.slice(0, 8000) + "…[truncated]"
              : content;
            return `[${role}]: ${truncated}`;
          })
          .join("\n\n"),
    },
  ];

  const compactionModel = MODEL_IDS.compaction;
  const result = await callOpenRouterNonStreaming(
    apiKey,
    compactionModel,
    compactionMessages,
    {
      temperature: COMPACTION.COMPACTION_TEMPERATURE,
      maxTokens: COMPACTION.COMPACTION_MAX_TOKENS,
    },
  );

  return {
    summary: result.content || "[Compaction produced empty summary]",
    usage: result.usage,
    generationId: result.generationId,
    modelId: compactionModel,
  };
}

/**
 * Build a fresh message array after compaction: the original system prompt,
 * the compaction summary as an assistant message, and the last user message.
 */
export function buildCompactedMessages(
  originalSystemPrompt: string | undefined,
  summary: string,
  lastUserMessage: OpenRouterMessage | undefined,
): OpenRouterMessage[] {
  const messages: OpenRouterMessage[] = [];

  if (originalSystemPrompt) {
    messages.push({ role: "system", content: originalSystemPrompt });
  }

  messages.push({
    role: "assistant",
    content:
      "[Context Summary from previous conversation]\n\n" + summary,
  });

  if (lastUserMessage) {
    messages.push(lastUserMessage);
  }

  return messages;
}
