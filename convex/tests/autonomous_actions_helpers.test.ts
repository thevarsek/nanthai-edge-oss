import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  checkConsensusInternal,
  dedupeMessageIds,
  generateModeratorDirective,
  sleep,
} from "../autonomous/actions_helpers";
import { MODEL_IDS } from "../lib/model_constants";

test("dedupeMessageIds keeps first occurrence order and sleep resolves", async () => {
  assert.deepEqual(
    dedupeMessageIds(["m1", "m2", "m1", "m3"] as any),
    ["m1", "m2", "m3"],
  );

  const started = Date.now();
  await sleep(1);
  assert.ok(Date.now() >= started);
});

test("generateModeratorDirective uses persona prompt and trims the model response", async () => {
  const fetchMock = mock.method(globalThis, "fetch", (async () =>
    new Response(
      JSON.stringify({
        id: "gen_1",
        choices: [{ message: { content: "  Push on the weakest assumption.  " }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as any,
  );

  const ctx = {
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("personaId" in args) {
        return { systemPrompt: "Be incisive and concise." };
      }
      if ("count" in args) {
        return [
          { participantName: "Ava", role: "assistant", content: "We should ship now." },
          { role: "user", content: "What is the biggest risk?" },
        ];
      }
      return "api_key_123";
    },
  } as any;

  const directive = await generateModeratorDirective(
    ctx,
    {
      modelId: "openai/gpt-4.1-mini",
      personaId: "persona_1" as any,
      displayName: "Moderator",
    },
    {
      participantId: "participant_1",
      modelId: "openai/gpt-4.1-mini",
      displayName: "Analyst",
    },
    "chat_1" as any,
    "user_1",
  );

  assert.equal(directive, "Push on the weakest assumption.");
  assert.equal(fetchMock.mock.calls.length, 1);
  const [, init] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
  const body = JSON.parse(String(init.body));
  assert.equal(body.messages[0].role, "system");
  assert.match(body.messages[0].content, /Be incisive and concise/);
  assert.match(body.messages[1].content, /Ava: We should ship now/);
  assert.equal(body.max_tokens, undefined);
  assert.equal(body.include_reasoning, false);
  assert.equal(body.reasoning.effort, "minimal");
  assert.equal(
    body.response_format.json_schema.name,
    "nanthai_autonomous_moderator_directive",
  );
  fetchMock.mock.restore();
});

test("generateModeratorDirective returns deterministic fallback when model gives no content", async () => {
  const fetchMock = mock.method(globalThis, "fetch", (async () =>
    new Response(
      JSON.stringify({
        id: "gen_empty",
        choices: [{ message: { content: "" }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as any,
  );

  const ctx = {
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("count" in args) {
        return [
          { participantName: "Ava", role: "assistant", content: "We should ship now." },
          { participantName: "Ben", role: "assistant", content: "I disagree." },
        ];
      }
      return "api_key_123";
    },
  } as any;

  const directive = await generateModeratorDirective(
    ctx,
    {
      modelId: "openai/gpt-5.6-luna",
      displayName: "Moderator",
    },
    {
      participantId: "participant_1",
      modelId: "openai/gpt-4.1-mini",
      displayName: "Analyst",
    },
    "chat_1" as any,
    "user_1",
  );

  assert.match(directive ?? "", /Address the strongest unresolved point/);
  assert.doesNotMatch(directive ?? "", /Analyst/);
  assert.equal(fetchMock.mock.calls.length, 2);
  fetchMock.mock.restore();
});

test("generateModeratorDirective retries an invalid fragment with the fallback model", async () => {
  let requestCount = 0;
  const fetchMock = mock.method(globalThis, "fetch", (async () => {
    requestCount += 1;
    const content = requestCount === 1
      ? "suggests doing"
      : JSON.stringify({
          directive: "Compare the practical tradeoff before recommending the next step.",
        });
    return new Response(
      JSON.stringify({
        id: `gen_${requestCount}`,
        choices: [{ message: { content }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as any);

  const ctx = {
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("count" in args) {
        return [
          { role: "user", content: "Which option should we choose?" },
          { participantName: "Ava", role: "assistant", content: "Option A is faster." },
        ];
      }
      return "api_key_123";
    },
  } as any;

  const directive = await generateModeratorDirective(
    ctx,
    {
      modelId: "google/gemini-3.1-pro-preview",
      displayName: "Moderator",
    },
    {
      participantId: "participant_1",
      modelId: "openai/gpt-5.4",
      displayName: "Architect",
    },
    "chat_1" as any,
    "user_1",
  );

  assert.equal(
    directive,
    "Compare the practical tradeoff before recommending the next step.",
  );
  assert.equal(fetchMock.mock.calls.length, 2);
  const firstRequest = JSON.parse(String(
    (fetchMock.mock.calls[0].arguments[1] as RequestInit).body,
  ));
  const secondRequest = JSON.parse(String(
    (fetchMock.mock.calls[1].arguments[1] as RequestInit).body,
  ));
  assert.equal(firstRequest.model, "google/gemini-3.1-pro-preview");
  assert.equal(secondRequest.model, MODEL_IDS.autonomousFallback);
  fetchMock.mock.restore();
});

test("checkConsensusInternal returns false for empty context and parses YES responses", async () => {
  let recentMessages: Array<Record<string, unknown>> = [];
  const fetchMock = mock.method(globalThis, "fetch", (async () =>
    new Response(
      JSON.stringify({
        id: "gen_2",
        choices: [{ message: { content: "YES - they are converging." }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as any,
  );

  const ctx = {
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("count" in args) return recentMessages;
      return "api_key_123";
    },
  } as any;

  assert.equal(
    await checkConsensusInternal(ctx, "chat_1" as any, 2, "user_1"),
    false,
  );
  assert.equal(fetchMock.mock.calls.length, 0);

  recentMessages = [
    { participantName: "Ava", role: "assistant", content: "We agree on the plan." },
    { participantName: "Ben", role: "assistant", content: "Yes, same recommendation." },
  ];

  assert.equal(
    await checkConsensusInternal(ctx, "chat_1" as any, 2, "user_1"),
    true,
  );
  assert.equal(fetchMock.mock.calls.length, 1);
  fetchMock.mock.restore();
});
