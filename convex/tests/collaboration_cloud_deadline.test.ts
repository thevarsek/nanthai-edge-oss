import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { ActionCtx, QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { decideSpeakers } from "../collaboration/scheduler_action";
import { getSchedulerContext } from "../collaboration/scheduler_context";
import { encryptSecret, userApiKeySecretContext } from "../lib/secret_crypto";
import { OPENROUTER_ACTION_BUDGET_MS } from "../lib/openrouter_constants";

const startedAt = 1_000_000;
const deadlineAt = startedAt + 15 * 60_000;
type SchedulerArgs = { exchangeId: Id<"collaborationExchanges">; wave: number };
const args: SchedulerArgs = { exchangeId: "exchange" as Id<"collaborationExchanges">, wave: 2 };
const actionHandler = (decideSpeakers as unknown as {
  _handler: (ctx: ActionCtx, args: SchedulerArgs) => Promise<{ selections: unknown[] }>;
})._handler;
const contextHandler = (getSchedulerContext as unknown as {
  _handler: (ctx: QueryCtx, args: SchedulerArgs) => Promise<unknown>;
})._handler;

async function fixture(t: test.TestContext, elapsedMs: number) {
  const previousKey = process.env.CONVEX_SECRET_ENCRYPTION_KEY;
  process.env.CONVEX_SECRET_ENCRYPTION_KEY = "collaboration-deadline-test-key";
  t.after(() => {
    if (previousKey === undefined) delete process.env.CONVEX_SECRET_ENCRYPTION_KEY;
    else process.env.CONVEX_SECRET_ENCRYPTION_KEY = previousKey;
  });
  const encrypted = await encryptSecret("test-only-provider-key", userApiKeySecretContext("user"));
  let now = startedAt + elapsedMs;
  t.mock.method(Date, "now", () => now);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timeouts: number[] = [];
  const scheduleTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((callback: () => void, milliseconds: number) => {
    timeouts.push(milliseconds);
    return scheduleTimeout(callback, milliseconds);
  }) as typeof setTimeout);
  t.mock.method(AbortSignal, "timeout", (milliseconds: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
    return controller.signal;
  });
  const db = createStatefulMockCtx({
    collaborationExchanges: [{
      _id: args.exchangeId, chatId: "chat", userId: "user", initiatingMessageId: "human",
      currentWave: 2, frontierMessageIds: ["human"], publishedMessageCount: 1,
      bounds: { deadlineAt, maxParticipantMessages: 8 }, failedParticipantIds: [], activeParticipantIds: [],
      mentionedParticipantIds: [],
      participantSnapshot: [{ participantId: "participant", displayName: "Peer", modelId: "openai/gpt-6-luna" }],
    }],
    messages: [{ _id: "human", chatId: "chat", role: "user", content: "Continue", status: "completed", parentMessageIds: [] }],
    collaborationDecisions: [], personas: [],
  }) as unknown as QueryCtx;
  const ctx = { runQuery: async (ref: unknown) => {
    const name = getFunctionName(ref as never);
    if (name.endsWith(":getSchedulerContext")) return contextHandler(db, args);
    if (name.endsWith(":getEncryptedUserApiKey")) return encrypted;
    if (name.endsWith(":getUserPreferences")) return {};
    throw new Error(`Unexpected query ${name}`);
  } } as unknown as ActionCtx;
  return { ctx, timeouts, advance: (milliseconds: number) => {
    now += milliseconds;
    t.mock.timers.tick(milliseconds);
  } };
}

function jevResponse(): Response {
  return new Response(JSON.stringify({ model: "typesafe/jev-1.13", answers: {
    speaker_0: { type: "choice", choice: "answer_human" },
    reply_0_0: { type: "choice", choice: "reply" },
    primary: { type: "choice", choice: "participant" },
  } }), { status: 200 });
}

function fallbackResponse(): Response {
  return new Response(JSON.stringify({ model: "openai/gpt-6-luna", choices: [{
    message: { content: JSON.stringify({ selections: [{ participantId: "participant",
      replyToMessageIds: ["human"], reasonCode: "answer_human" }], diagnosticCategory: "continue" }) },
    finish_reason: "stop",
  }] }), { status: 200 });
}

function stallUntilAbort(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    assert.ok(init?.signal);
    init.signal.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });
}

test("fresh cloud scheduler retains JEV's existing twenty-second cap", async (t) => {
  const state = await fixture(t, 0);
  const fetchMock = t.mock.method(globalThis, "fetch", async () => jevResponse());
  assert.equal((await actionHandler(state.ctx, args)).selections.length, 1);
  assert.deepEqual(state.timeouts, [20_000]);
  assert.equal(fetchMock.mock.calls.length, 1);
});

test("fresh cloud scheduler fallback retains the existing nine-minute provider cap", async (t) => {
  const state = await fixture(t, 0);
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) =>
    String(url).includes("/alpha/decisions") ? new Response("Unavailable", { status: 503 }) : fallbackResponse());
  assert.equal((await actionHandler(state.ctx, args)).selections.length, 1);
  assert.deepEqual(state.timeouts, [20_000, OPENROUTER_ACTION_BUDGET_MS]);
});

test("late-wave JEV spends only the remaining budget and cannot start fallback after expiry", async (t) => {
  const state = await fixture(t, 15 * 60_000 - 5_000);
  let ready: () => void = () => {};
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const fetchMock = t.mock.method(globalThis, "fetch", (_url: string | URL | Request, init?: RequestInit) => {
    ready();
    return stallUntilAbort(init);
  });
  const result = actionHandler(state.ctx, args);
  const rejected = assert.rejects(result, /COLLABORATION_BARRIER_TIMEOUT/);
  await started;
  state.advance(5_000);
  await rejected;
  assert.deepEqual(state.timeouts, [5_000]);
  assert.equal(fetchMock.mock.calls.length, 1);
});

test("late-wave stalled cloud fallback stops at the persisted exchange deadline", async (t) => {
  const state = await fixture(t, 14 * 60_000);
  let ready: () => void = () => {};
  const started = new Promise<void>((resolve) => { ready = resolve; });
  const fetchMock = t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/alpha/decisions")) return new Response("Unavailable", { status: 503 });
    ready();
    return stallUntilAbort(init);
  });
  const rejected = assert.rejects(actionHandler(state.ctx, args), /COLLABORATION_BARRIER_TIMEOUT/);
  await started;
  assert.deepEqual(state.timeouts, [20_000, 60_000]);
  state.advance(60_000);
  await rejected;
  assert.equal(fetchMock.mock.calls.length, 2);
});

test("slow credential lookup cannot launch cloud scheduling after the exchange deadline", async (t) => {
  const state = await fixture(t, 15 * 60_000 - 1_000);
  const originalQuery = state.ctx.runQuery;
  t.mock.method(state.ctx, "runQuery", async (ref: unknown) => {
    const result = await originalQuery(ref as never);
    if (getFunctionName(ref as never).endsWith(":getUserPreferences")) state.advance(1_000);
    return result;
  });
  const fetchMock = t.mock.method(globalThis, "fetch", async () => jevResponse());
  await assert.rejects(actionHandler(state.ctx, args), /COLLABORATION_BARRIER_TIMEOUT/);
  assert.equal(fetchMock.mock.calls.length, 0);
});
