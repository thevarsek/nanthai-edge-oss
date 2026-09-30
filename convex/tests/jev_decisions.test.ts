import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { callJevDecisions, choiceQuestion, parseDecisionResponse, type DecisionResult } from "../decisions/client";
import { discussionDecisionRequest, projectDiscussionDecision } from "../autonomous/decision_policy";
import { memoryDecisionRequest, projectMemoryDecision, reconciliationCandidates } from "../memory/decision_policy";
import { speakerDecisionRequest, projectSpeakerDecision } from "../collaboration/scheduler_jev";
import type { SchedulerPolicyInput } from "../collaboration/scheduler_policy";
import type { Id } from "../_generated/dataModel";
import { tryJevDecision } from "../decisions/service";

const questions = { category: choiceQuestion("Classify state.text.", { yes: "Supported", no: "Unsupported" }) };
function response(answers: Record<string, string>): DecisionResult {
  return { answers: Object.fromEntries(Object.entries(answers).map(([key, choice]) => [key, { type: "choice", choice }])), modelId: "typesafe/jev-1.13-20260917", durationMs: 5 };
}
function payload() {
  return { id: "gen-dec-test", model: "typesafe/jev-1.13-20260917", provider: "TypeSafe", answers: { category: { type: "choice", choice: "yes", confidence: 0.8 } }, usage: { input_tokens: 14.0, output_tokens: 2.0, cost: 0.00001 } };
}

test("Decisions validates typed answers and preserves actual/unknown cost", () => {
  const result = parseDecisionResponse(payload(), questions);
  assert.equal(result.requestId, "gen-dec-test");
  assert.equal(result.usage?.cost, 0.00001);
  assert.equal(parseDecisionResponse({ ...payload(), usage: { input_tokens: 14, output_tokens: 2 } }, questions).usage?.cost, undefined);
  for (const malformed of [
    { ...payload(), model: "another/model" },
    { ...payload(), answers: {} },
    { ...payload(), answers: { category: { type: "choice", choice: "invented" } } },
    { ...payload(), answers: { category: { type: "choice", choice: "yes", confidence: 2 } } },
    { ...payload(), usage: { input_tokens: -1, output_tokens: 0 } },
  ]) assert.throws(() => parseDecisionResponse(malformed, questions));
  assert.throws(() => parseDecisionResponse({ ...payload(), answers: { category: { type: "score", score: 4 } } }, { category: { type: "score", instructions: "Evaluate state.text.", criteria: ["Low", "High"] } }));
});

test("Decisions uses the alpha endpoint and ZDR provider routing, with no retry", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { model: string; provider: { zdr: boolean } };
    assert.equal(body.model, "typesafe/jev-1.13");
    assert.equal(body.provider.zdr, true);
    return new Response(JSON.stringify(payload()), { status: 200 });
  });
  try {
    assert.equal((await callJevDecisions("test-key", { state: { text: "Synthetic" }, questions }, { requireZdr: true })).usage?.cost, 0.00001);
    assert.equal(String(fetchMock.mock.calls[0].arguments[0]), "https://openrouter.ai/api/alpha/decisions");
    fetchMock.mock.mockImplementation(async () => new Response("Private provider failure", { status: 503 }));
    await assert.rejects(callJevDecisions("test-key", { state: {}, questions }), /http_503/);
    assert.equal(fetchMock.mock.calls.length, 2);
    fetchMock.mock.mockImplementation(async () => { throw new DOMException("Timed out", "TimeoutError"); });
    await assert.rejects(callJevDecisions("test-key", { state: {}, questions }), /timeout/);
  } finally { fetchMock.mock.restore(); }
});

test("discussion projection distinguishes agreement, stalled disagreement, progress and uncertainty", () => {
  const answers = { agreement: "yes", disagreement: "no", repetition: "no", missing_evidence: "no", unanswered: "no", new_progress: "no" };
  assert.equal(Object.keys(discussionDecisionRequest({}).questions).length, 6);
  assert.equal(projectDiscussionDecision(response(answers)), "consensus");
  assert.equal(projectDiscussionDecision(response({ ...answers, disagreement: "yes" })), null);
  assert.equal(projectDiscussionDecision(response({ ...answers, agreement: "no", disagreement: "yes", repetition: "yes" })), "stalled");
  assert.equal(projectDiscussionDecision(response({ ...answers, agreement: "no", repetition: "yes", unanswered: "yes" })), "continue");
  assert.equal(projectDiscussionDecision(response({ ...answers, missing_evidence: "uncertain" })), null);
});

test("memory projection reconciles meaning and rejects ambiguous targets; candidate selection preserves lifecycle/scope", () => {
  const candidates = [{ _id: "old", content: "Prefers brief answers", memoryType: "responsePreference", updatedAt: 1 }];
  assert.equal(Object.keys(memoryDecisionRequest("Prefers concise answers", "Keep it brief", candidates).questions).length, 2);
  assert.equal(projectMemoryDecision(response({ admission: "fact", relation_0: "equivalent" }), candidates)?.action, "reinforce");
  assert.equal(projectMemoryDecision(response({ admission: "fact", relation_0: "supersedes" }), candidates)?.action, "supersede");
  assert.equal(projectMemoryDecision(response({ admission: "fact", relation_0: "separate" }), candidates)?.action, "add");
  assert.equal(projectMemoryDecision(response({ admission: "forget", relation_0: "equivalent" }), candidates)?.action, "forget");
  assert.equal(projectMemoryDecision(response({ admission: "fact", relation_0: "equivalent", relation_1: "supersedes" }), [...candidates, { ...candidates[0], _id: "second" }]), null);
  assert.deepEqual(reconciliationCandidates([
    ...candidates, { ...candidates[0], _id: "pending", isPending: true },
    { ...candidates[0], _id: "private", scopeType: "selectedPersonas", personaIds: ["persona"] },
    { ...candidates[0], _id: "disabled", retrievalMode: "disabled" },
    { ...candidates[0], _id: "expired", expiresAt: 0 },
  ], "concise").map((memory) => memory._id), ["old"]);
});

function schedulerInput(): SchedulerPolicyInput {
  return { wave: 1, frontierMessageIds: ["human" as Id<"messages">], participants: [
    { participantId: "writer" as Id<"chatParticipants">, displayName: "Writer", modelId: "openai/gpt-5.6-luna" },
    { participantId: "failed" as Id<"chatParticipants">, displayName: "Reviewer", modelId: "openai/gpt-5.6-luna" },
  ], failedParticipantIds: ["failed" as Id<"chatParticipants">], previousSpeakerIds: [], mentionedParticipantIds: [],
    recentMessages: [{ id: "human" as Id<"messages">, role: "user", speaker: "User", content: "Write a summary" }], remainingMessageBudget: 1, deadlineReached: false };
}

test("speaker projection preserves the human floor, eligible participants, budget and exact frontier", () => {
  const input = schedulerInput();
  assert.equal(Object.keys(speakerDecisionRequest(input).questions).length, 3);
  const answers = { speaker_0: "answer_human", reply_0_0: "reply", primary: "writer" };
  assert.deepEqual(projectSpeakerDecision(input, response(answers)).selections.map((s) => [s.participantId, s.replyToMessageIds]), [["writer", ["human"]]]);
  assert.throws(() => projectSpeakerDecision(input, response({ ...answers, reply_0_0: "none" })), /missing_reply_target/);
  assert.throws(() => projectSpeakerDecision(input, response({ ...answers, speaker_0: "quiet" })), /contradictory_primary/);
  assert.throws(() => projectSpeakerDecision(input, response({ ...answers, speaker_0: "uncertain" })), /uncertain_speaker/);
});

test("eligible provider fallback is automatic, with no release feature flags", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(payload()), { status: 200 }));
  try {
    const args = { state: {}, questions, useCase: "memory" as const, apiKey: "test-key", userId: "test-user", chatId: "test-chat" as Id<"chats">, requireZdr: false };
    assert.equal((await tryJevDecision({}, args))?.requestId, "gen-dec-test");
    fetchMock.mock.mockImplementation(async () => new Response("Unavailable", { status: 503 }));
    assert.equal(await tryJevDecision({}, args), null);
    assert.equal(fetchMock.mock.calls.length, 2);
  } finally { fetchMock.mock.restore(); }
});

test("malformed answers still record available billed usage without a Generations lookup", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ ...payload(), answers: {} }), { status: 200 }));
  const recorded: Record<string, unknown>[] = [];
  const ctx = { runMutation: async (_ref: unknown, args: Record<string, unknown>) => { recorded.push(args); } } as unknown as Parameters<typeof tryJevDecision>[0];
  try {
    const value = await tryJevDecision(ctx, { state: {}, questions, useCase: "discussion", apiKey: "test-key", userId: "user", chatId: "chat" as Id<"chats">, messageId: "message" as Id<"messages">, requireZdr: true });
    assert.equal(value, null);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].cost, 0.00001);
    assert.equal(recorded[0].idempotencyKey, "jev:gen-dec-test");
    assert.equal(recorded[0].generationId, undefined);
  } finally { fetchMock.mock.restore(); }
});


test("Decisions with unknown cost never borrow cached chat-model pricing", async () => {
  const { storeAncillaryCostHandler } = await import("../chat/mutations_internal_handlers");
  const inserted: Array<Record<string, unknown>> = [];
  const ctx = { db: {
    get: async (id: string) => id === "message" ? { _id: id, userId: "user", chatId: "chat" } : { _id: id, userId: "user" },
    query: (table: string) => { assert.equal(table, "accountDeletionTombstones"); return { withIndex: () => ({ unique: async () => null }) }; },
    insert: async (_table: string, value: Record<string, unknown>) => { inserted.push(value); return "usage"; },
  } } as unknown as import("../_generated/server").MutationCtx;
  await storeAncillaryCostHandler(ctx, { userId: "user", chatId: "chat" as import("../_generated/dataModel").Id<"chats">, messageId: "message" as import("../_generated/dataModel").Id<"messages">, modelId: "typesafe/jev-1.13", promptTokens: 1, completionTokens: 1, totalTokens: 2, source: "jev_memory" });
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].cost, undefined);
});

test("moderator and consensus helper usage keeps paid fallback calls attributable", async () => {
  const { recordAutonomousHelperUsage } = await import("../autonomous/helper_usage");
  const writes: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async () => ({ messageId: "message" }),
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => { writes.push(args); },
  } as unknown as import("../_generated/server").ActionCtx;
  const args = { userId: "user", chatId: "chat" as import("../_generated/dataModel").Id<"chats">, modelId: "primary", source: "autonomous_moderator" as const };
  const result = { content: "A sentence", modelId: "fallback", generationId: "gen-paid-fallback", usage: { promptTokens: 5, completionTokens: 2, totalTokens: 7, cost: 0.001 } } as import("../lib/openrouter_types").NonStreamResult;
  await recordAutonomousHelperUsage(ctx, args, result);
  assert.equal(writes[0].modelId, "fallback");
  assert.equal(writes[0].cost, 0.001);
  assert.equal(writes[0].generationId, "gen-paid-fallback");
  assert.equal(writes[0].source, "autonomous_moderator");
  await recordAutonomousHelperUsage({ ...ctx, runMutation: async () => { throw new Error("write unavailable"); } }, args, result);
});
