import assert from "node:assert/strict";
import test from "node:test";

import {
  isContextOverflow,
  isApproachingTimeout,
  pruneToolOutputs,
  buildCompactedMessages,
} from "../chat/compaction";
import { COMPACTION } from "../lib/compaction_constants";
import type { OpenRouterMessage } from "../lib/openrouter_types";

// ── isContextOverflow ─────────────────────────────────────────────────

test("isContextOverflow returns false when under threshold", () => {
  // 85% threshold on 128k context = 108,800
  assert.equal(isContextOverflow(100_000, 128_000), false);
});

test("isContextOverflow returns true at threshold", () => {
  const limit = 128_000;
  const threshold = limit * COMPACTION.CONTEXT_OVERFLOW_THRESHOLD;
  assert.equal(isContextOverflow(threshold, limit), true);
});

test("isContextOverflow returns true above threshold", () => {
  assert.equal(isContextOverflow(120_000, 128_000), true);
});

test("isContextOverflow returns false for zero tokens", () => {
  assert.equal(isContextOverflow(0, 128_000), false);
});

test("isContextOverflow works with different context limits", () => {
  // 85% of 32k = 27,200
  assert.equal(isContextOverflow(27_000, 32_000), false);
  assert.equal(isContextOverflow(27_500, 32_000), true);
});

// ── isApproachingTimeout ──────────────────────────────────────────────

test("isApproachingTimeout returns false when just started", () => {
  assert.equal(isApproachingTimeout(Date.now()), false);
});

test("isApproachingTimeout returns true when near limit", () => {
  // Start 8 minutes ago → 2 minutes left, buffer is 3 minutes → should trigger
  const eightMinutesAgo = Date.now() - 8 * 60 * 1000;
  assert.equal(isApproachingTimeout(eightMinutesAgo), true);
});

test("isApproachingTimeout returns false with 5 minutes elapsed", () => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  assert.equal(isApproachingTimeout(fiveMinutesAgo), false);
});

test("isApproachingTimeout boundary is at 7 minutes", () => {
  // Action timeout = 10 min, buffer = 3 min → trigger at 7 min elapsed
  const sevenMinAgo = Date.now() - 7 * 60 * 1000;
  assert.equal(isApproachingTimeout(sevenMinAgo), true);

  const sixMinFiftyNine = Date.now() - (6 * 60 + 59) * 1000;
  assert.equal(isApproachingTimeout(sixMinFiftyNine), false);
});

// ── pruneToolOutputs ──────────────────────────────────────────────────

function makeToolMessage(content: string, role: OpenRouterMessage["role"] = "tool"): OpenRouterMessage {
  return { role, content };
}

function makeUserMessage(content: string): OpenRouterMessage {
  return { role: "user", content };
}

function makeAssistantMessage(content: string): OpenRouterMessage {
  return { role: "assistant", content };
}

test("pruneToolOutputs returns original when no tool messages", () => {
  const messages: OpenRouterMessage[] = [
    makeUserMessage("Hello"),
    makeAssistantMessage("Hi there!"),
    makeUserMessage("How are you?"),
  ];
  const result = pruneToolOutputs(messages);
  assert.equal(result.tokensSaved, 0);
  assert.deepEqual(result.messages, messages);
});

test("pruneToolOutputs preserves recent tool outputs", () => {
  // Create a few small tool messages — they should all be protected
  const messages: OpenRouterMessage[] = [
    makeUserMessage("Search for info"),
    makeToolMessage("Result: found some data"),
    makeAssistantMessage("Here is what I found"),
  ];
  const result = pruneToolOutputs(messages);
  assert.equal(result.tokensSaved, 0);
  assert.deepEqual(result.messages, messages);
});

test("pruneToolOutputs prunes old verbose tool outputs", () => {
  // We need enough total tool content to exceed PRUNE_PROTECT_TOKENS
  // and enough pruneable content to exceed PRUNE_MINIMUM_SAVINGS.
  //
  // PRUNE_PROTECT_TOKENS = 40,000 → need ~160,000 chars of protected content
  // PRUNE_MINIMUM_SAVINGS = 20,000 → need ~80,000 chars of prunable content
  // Strategy: put large old tool outputs first, then recent ones.

  const bigOldContent = "x".repeat(200_000); // ~50k tokens, will be pruned
  const recentContent = "y".repeat(200_000); // ~50k tokens, protected (newest)

  const messages: OpenRouterMessage[] = [
    makeUserMessage("Do task 1"),
    makeToolMessage(bigOldContent),        // index 1 — old, should be pruned
    makeAssistantMessage("Done task 1"),
    makeUserMessage("Do task 2"),
    makeToolMessage(recentContent),        // index 4 — recent, protected
    makeAssistantMessage("Done task 2"),
  ];

  const result = pruneToolOutputs(messages);

  // Old tool output should have been replaced
  assert.ok(result.tokensSaved > 0);
  assert.ok(result.messages[1].content !== bigOldContent);
  assert.ok((result.messages[1].content as string).includes("[pruned"));

  // Recent tool output should be preserved
  assert.equal(result.messages[4].content, recentContent);

  // Non-tool messages untouched
  assert.equal(result.messages[0].content, "Do task 1");
  assert.equal(result.messages[2].content, "Done task 1");
});

test("pruneToolOutputs does not mutate original messages", () => {
  const bigContent = "z".repeat(200_000);
  const messages: OpenRouterMessage[] = [
    makeUserMessage("Task"),
    makeToolMessage(bigContent),
    makeAssistantMessage("Between"),
    makeToolMessage("y".repeat(200_000)),
    makeAssistantMessage("Done"),
  ];

  const original0 = messages[1].content;
  pruneToolOutputs(messages);
  assert.equal(messages[1].content, original0); // Original not mutated
});

test("pruneToolOutputs skips pruning when savings too small", () => {
  // Small tool outputs that won't reach PRUNE_MINIMUM_SAVINGS
  const messages: OpenRouterMessage[] = [
    makeUserMessage("Task"),
    makeToolMessage("small result 1"),
    makeAssistantMessage("Ack"),
    makeToolMessage("small result 2"),
    makeAssistantMessage("Done"),
  ];

  const result = pruneToolOutputs(messages);
  assert.equal(result.tokensSaved, 0);
  assert.deepEqual(result.messages, messages);
});

// ── buildCompactedMessages ────────────────────────────────────────────

test("buildCompactedMessages includes system prompt, summary, and last user message", () => {
  const result = buildCompactedMessages(
    "You are a helpful assistant.",
    "Summary of what happened so far.",
    makeUserMessage("Continue please"),
  );

  assert.equal(result.length, 3);
  assert.equal(result[0].role, "system");
  assert.equal(result[0].content, "You are a helpful assistant.");
  assert.equal(result[1].role, "assistant");
  assert.ok((result[1].content as string).includes("Context Summary"));
  assert.ok((result[1].content as string).includes("Summary of what happened"));
  assert.equal(result[2].role, "user");
  assert.equal(result[2].content, "Continue please");
});

test("buildCompactedMessages omits system prompt when undefined", () => {
  const result = buildCompactedMessages(
    undefined,
    "Summary text",
    makeUserMessage("Next"),
  );

  assert.equal(result.length, 2);
  assert.equal(result[0].role, "assistant");
  assert.equal(result[1].role, "user");
});

test("buildCompactedMessages omits last user message when undefined", () => {
  const result = buildCompactedMessages(
    "System prompt",
    "Summary text",
    undefined,
  );

  assert.equal(result.length, 2);
  assert.equal(result[0].role, "system");
  assert.equal(result[1].role, "assistant");
});

test("buildCompactedMessages with only summary", () => {
  const result = buildCompactedMessages(undefined, "Just a summary", undefined);

  assert.equal(result.length, 1);
  assert.equal(result[0].role, "assistant");
  assert.ok((result[0].content as string).includes("Just a summary"));
});

// ── COMPACTION constants sanity ───────────────────────────────────────

test("COMPACTION constants have sensible values", () => {
  assert.ok(COMPACTION.CONTEXT_OVERFLOW_THRESHOLD > 0.5);
  assert.ok(COMPACTION.CONTEXT_OVERFLOW_THRESHOLD < 1.0);
  assert.ok(COMPACTION.ACTION_TIMEOUT_MS === 600_000); // 10 minutes
  assert.ok(COMPACTION.ACTION_TIMEOUT_BUFFER_MS < COMPACTION.ACTION_TIMEOUT_MS);
  assert.ok(COMPACTION.MAX_CONTINUATIONS >= 1);
  assert.ok(COMPACTION.PRUNE_PROTECT_TOKENS > 0);
  assert.ok(COMPACTION.PRUNE_MINIMUM_SAVINGS > 0);
  assert.ok(COMPACTION.COMPACTION_MAX_TOKENS > 0);
});
