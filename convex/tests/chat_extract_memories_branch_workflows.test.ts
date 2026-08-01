import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { getFunctionName } from "convex/server";

import { internal } from "../_generated/api";
import { extractMemoriesHandler } from "../chat/actions_extract_memories_handler";

function sseResponse(content: string, includeGenerationId = false) {
  const firstEvent: Record<string, unknown> = {
    choices: [{ delta: { content } }],
  };
  if (includeGenerationId) firstEvent.id = "memory_generation_1";
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => [
      `data: ${JSON.stringify(firstEvent)}`,
      `data: ${JSON.stringify({
        choices: [{ finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
  } as any;
}

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    chatId: "chat_1" as any,
    userMessageContent: "Please remember the durable details I shared.",
    userMessageId: "message_user_1" as any,
    assistantContent: "Noted.",
    userId: "user_1",
    ...overrides,
  };
}

function refs() {
  return {
    getUserMemories: getFunctionName(internal.chat.queries.getUserMemories),
    getUserPreferences: getFunctionName(internal.chat.queries.getUserPreferences),
    getUserApiKey: getFunctionName(internal.scheduledJobs.queries.getEncryptedUserApiKey),
    createMemory: getFunctionName(internal.chat.mutations.createMemory),
    enqueueMemoryEmbedding: getFunctionName(
      internal.execution.workload_queues.enqueueMemoryEmbedding,
    ),
    isChatWritable: getFunctionName(internal.chat.post_process_guard.isChatWritable),
  };
}

function analyticsForOperation(
  scheduled: Array<Record<string, unknown>>,
  operation: string,
) {
  return scheduled.filter((entry) =>
    (entry.properties as Record<string, unknown> | undefined)?.operation === operation
  );
}

test("extractMemoriesHandler keeps processing around invalid candidates and creates bounded memories", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => sseResponse(JSON.stringify([
    { content: "" },
    { content: `User ${"prefers detailed planning ".repeat(20)}` },
    { content: "Assistant should explain every tool call." },
    {
      content: "User works as a platform architect",
      evidenceQuote: "I work as a platform architect",
      evidenceKind: "explicitFact",
      durability: "ongoing",
      category: "work",
      memoryType: "work_context",
      retrievalMode: "contextual",
      expiresInDays: 10,
      tags: ["work"],
    },
  ]))) as any;

  const names = refs();
  const created: Record<string, unknown>[] = [];
  const enqueuedEmbeddings: Record<string, unknown>[] = [];
  const scheduled: Record<string, unknown>[] = [];

  await extractMemoriesHandler({
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === names.isChatWritable) return true;
      if (name === names.getUserMemories) return [];
      if (name === names.getUserPreferences) return {};
      if (name === names.getUserApiKey) return "sk-test";
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      if (getFunctionName(ref as any) === names.createMemory) {
        created.push(args);
        return "memory_work_1";
      }
      if (getFunctionName(ref as any) === names.enqueueMemoryEmbedding) {
        enqueuedEmbeddings.push(args);
        return "memory_embedding_work_1";
      }
      return null;
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  } as any, baseArgs({
    isPending: true,
    userMessageContent: "I work as a platform architect.",
  }));

  assert.equal(created.length, 1);
  assert.equal(created[0].memoryType, "workContext");
  assert.equal(created[0].isPending, true);
  assert.equal(typeof created[0].expiresAt, "number");
  assert.deepEqual(
    scheduled.filter((entry) => entry.source === "memory_extraction").map((entry) => entry.source),
    ["memory_extraction"],
  );
  assert.deepEqual(enqueuedEmbeddings, [{
    memoryId: "memory_work_1",
    content: "User works as a platform architect.",
  }]);
  const memoryAnalytics = analyticsForOperation(scheduled, "memory_extraction");
  assert.deepEqual(
    memoryAnalytics.map((entry) => entry.event),
    ["backend_ai_operation_started", "backend_ai_operation_completed"],
  );
  assert.equal((memoryAnalytics[1]?.properties as Record<string, unknown>).created_memory_count, 1);
  assert.equal((memoryAnalytics[1]?.properties as Record<string, unknown>).skipped_candidate_count, 2);
});

test("extractMemoriesHandler skips duplicate content even when the matched row has no id", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => sseResponse(JSON.stringify([
    {
      content: "User prefers concise answers",
      evidenceQuote: "I prefer concise answers",
      evidenceKind: "explicitPreference",
      durability: "durable",
      category: "preferences",
      memoryType: "preference",
      importanceScore: 0.9,
      confidenceScore: 0.9,
    },
  ]))) as any;

  const names = refs();
  const mutationCalls: string[] = [];

  await extractMemoriesHandler({
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === names.isChatWritable) return true;
      if (name === names.getUserMemories) {
        return [{ content: "User prefers concise answers." }];
      }
      if (name === names.getUserPreferences) return {};
      if (name === names.getUserApiKey) return "sk-test";
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown) => {
      mutationCalls.push(getFunctionName(ref as any));
      return "memory_unexpected";
    },
    scheduler: { runAfter: async () => {} },
  } as any, baseArgs({ userMessageContent: "I prefer concise answers." }));

  assert.deepEqual(mutationCalls, []);
});

test("explicit multilingual remember requests use deterministic score floors", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => sseResponse(JSON.stringify([{
    content: "Preferisco risposte concise e dirette in ogni conversazione",
    evidenceQuote: "preferisco risposte concise e dirette in ogni conversazione",
    evidenceKind: "explicitPreference",
    durability: "durable",
    category: "preferences",
    memoryType: "profile",
    importanceScore: 0.4,
    confidenceScore: 0.6,
  }]))) as any;

  const names = refs();
  const created: Record<string, unknown>[] = [];
  await extractMemoriesHandler({
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === names.isChatWritable) return true;
      if (name === names.getUserMemories) return [];
      if (name === names.getUserPreferences) return {};
      if (name === names.getUserApiKey) return "sk-test";
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      if (getFunctionName(ref as any) === names.createMemory) created.push(args);
      return "memory_explicit_1";
    },
    scheduler: { runAfter: async () => {} },
  } as any, baseArgs({
    userMessageContent:
      "Ricorda questa preferenza globale: preferisco risposte concise e dirette in ogni conversazione.",
  }));

  assert.equal(created.length, 1);
  assert.equal(created[0]?.importanceScore, 0.8);
  assert.equal(created[0]?.confidenceScore, 0.8);
  assert.equal(created[0]?.retrievalMode, "alwaysOn");
});

test("extractMemoriesHandler swallows model and persistence failures", async (t) => {
  t.after(() => mock.restoreAll());
  const names = refs();

  await extractMemoriesHandler({
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === names.isChatWritable) return true;
      if (name === names.getUserMemories) return [];
      if (name === names.getUserPreferences) return {};
      if (name === names.getUserApiKey) throw new Error("secret unavailable");
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async () => {
      throw new Error("mutation should not run");
    },
    scheduler: { runAfter: async () => {} },
  } as any, baseArgs());

  mock.restoreAll();
  mock.method(globalThis, "fetch", async () => sseResponse(JSON.stringify([
    {
      content: "User lives in Lisbon",
      evidenceQuote: "I live in Lisbon",
      evidenceKind: "explicitFact",
      durability: "durable",
      category: "identity",
      memoryType: "profile",
      importanceScore: 0.9,
      confidenceScore: 0.9,
    },
  ]))) as any;

  await extractMemoriesHandler({
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === names.isChatWritable) return true;
      if (name === names.getUserMemories) return [];
      if (name === names.getUserPreferences) return {};
      if (name === names.getUserApiKey) return "sk-test";
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async () => {
      throw new Error("write unavailable");
    },
    scheduler: { runAfter: async () => {} },
  } as any, baseArgs({ userMessageContent: "I live in Lisbon." }));

  assert.ok(true);
});

test("extractMemoriesHandler handles empty extraction responses without writes", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => sseResponse("[]")) as any;

  const names = refs();
  const scheduled: Record<string, unknown>[] = [];

  await extractMemoriesHandler({
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as any);
      if (name === names.isChatWritable) return true;
      if (name === names.getUserMemories) return [];
      if (name === names.getUserPreferences) return {};
      if (name === names.getUserApiKey) return "sk-test";
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async () => {
      throw new Error("no memory should be written");
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  } as any, baseArgs());

  assert.deepEqual(
    scheduled.filter((entry) => entry.source).map((entry) => entry.source),
    ["memory_extraction"],
  );
  const memoryAnalytics = analyticsForOperation(scheduled, "memory_extraction");
  assert.deepEqual(
    memoryAnalytics.map((entry) => entry.event),
    ["backend_ai_operation_started", "backend_ai_operation_completed"],
  );
  assert.equal((memoryAnalytics[1]?.properties as Record<string, unknown>).raw_candidate_count, 0);
});
