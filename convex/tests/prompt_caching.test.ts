import assert from "node:assert/strict";
import test from "node:test";

import { buildRequestBody } from "../lib/openrouter_request.ts";
import type { OpenRouterMessage } from "../lib/openrouter_types.ts";

const SYSTEM_MSG: OpenRouterMessage = {
  role: "system",
  content: "You are a helpful assistant.",
};
const USER_MSG: OpenRouterMessage = { role: "user", content: "Hello" };
const MESSAGES = [SYSTEM_MSG, USER_MSG];
const BASE_PARAMS = {};

// ── Anthropic models get cache_control ────────────────────────────────

test("adds cache_control for anthropic/claude-sonnet-4", () => {
  const body = buildRequestBody(
    "anthropic/claude-sonnet-4",
    MESSAGES,
    BASE_PARAMS,
    true,
  );
  assert.deepStrictEqual(body.cache_control, { type: "ephemeral" });
});

test("adds cache_control for anthropic/claude-sonnet-4.6", () => {
  const body = buildRequestBody(
    "anthropic/claude-sonnet-4.6",
    MESSAGES,
    BASE_PARAMS,
    true,
  );
  assert.deepStrictEqual(body.cache_control, { type: "ephemeral" });
});

test("adds cache_control for anthropic/claude-haiku-4.5", () => {
  const body = buildRequestBody(
    "anthropic/claude-haiku-4.5",
    MESSAGES,
    BASE_PARAMS,
    false,
  );
  assert.deepStrictEqual(body.cache_control, { type: "ephemeral" });
});

// ── Non-Anthropic models do NOT get cache_control ─────────────────────

test("no cache_control for openai/gpt-4o", () => {
  const body = buildRequestBody("openai/gpt-4o", MESSAGES, BASE_PARAMS, true);
  assert.equal(body.cache_control, undefined);
});

test("no cache_control for google/gemini-2.5-pro", () => {
  const body = buildRequestBody(
    "google/gemini-2.5-pro-preview-05-06",
    MESSAGES,
    BASE_PARAMS,
    true,
  );
  assert.equal(body.cache_control, undefined);
});

test("no cache_control for deepseek/deepseek-chat", () => {
  const body = buildRequestBody(
    "deepseek/deepseek-chat",
    MESSAGES,
    BASE_PARAMS,
    true,
  );
  assert.equal(body.cache_control, undefined);
});

test("no cache_control for meta-llama model", () => {
  const body = buildRequestBody(
    "meta-llama/llama-4-maverick",
    MESSAGES,
    BASE_PARAMS,
    true,
  );
  assert.equal(body.cache_control, undefined);
});

// ── cache_control coexists with other params ──────────────────────────

test("cache_control coexists with temperature and max_tokens", () => {
  const body = buildRequestBody(
    "anthropic/claude-sonnet-4",
    MESSAGES,
    { temperature: 0.7, maxTokens: 4096 },
    true,
  );
  assert.deepStrictEqual(body.cache_control, { type: "ephemeral" });
  assert.equal(body.temperature, 0.7);
  assert.equal(body.max_tokens, 4096);
});

test("cache_control coexists with transforms", () => {
  const body = buildRequestBody(
    "anthropic/claude-sonnet-4",
    MESSAGES,
    {},
    true,
  );
  assert.deepStrictEqual(body.cache_control, { type: "ephemeral" });
  assert.deepStrictEqual(body.transforms, ["middle-out"]);
});

test("preserves per-part cache_control on stable prompt blocks", () => {
  const body = buildRequestBody(
    "google/gemini-2.5-pro-preview-05-06",
    [
      {
        role: "system",
        content: [
          { type: "text", text: "volatile intro" },
          { type: "text", text: "cached block", cache_control: { type: "ephemeral" } },
        ],
      },
      USER_MSG,
    ],
    BASE_PARAMS,
    true,
  );

  const system = (body.messages as Array<Record<string, unknown>>)[0];
  const content = system.content as Array<Record<string, unknown>>;
    assert.equal("cache_control" in content[0], false);
    assert.deepStrictEqual(content[1].cache_control, { type: "ephemeral" });
  assert.equal(JSON.stringify(body).includes("\"volatile intro\",\"cache_control\""), false);
  assert.equal(body.cache_control, undefined);
});
