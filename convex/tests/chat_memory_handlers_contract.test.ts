import assert from "node:assert/strict";
import test from "node:test";

import {
  detectMemoryExclusionRules,
  findDuplicateMemory,
  memoryLikelyUserFact,
  normalizeMemoryContent,
  parseMemoryExtractionPayload,
  shouldExcludeMemoryContent,
} from "../chat/actions_extract_memories_utils";
import { resolveMemoryContextForGeneration } from "../chat/action_memory_helpers";
import {
  reinforceMemoryHandler,
  supersedeMemoryHandler,
  touchMemoriesHandler,
} from "../chat/mutations_memory_lifecycle_handlers";

function buildMemoryResolutionCtx(overrides: {
  allMemories?: Array<Record<string, unknown>>;
  queryEmbedding?: Record<string, unknown> | null;
  hydratedMemories?: Array<Record<string, unknown>>;
  vectorSearchImpl?: () => Promise<Array<{ _id: string; _score: number }>>;
} = {}) {
  const scheduled: Array<{ fn: unknown; args: Record<string, unknown> }> = [];
  const mutations: Array<{ fn: unknown; args: Record<string, unknown> }> = [];
  const allMemories = overrides.allMemories ?? [];
  const queryEmbedding = overrides.queryEmbedding ?? {
    status: "ready",
    embedding: [0.1, 0.2, 0.3],
    usage: { promptTokens: 7, totalTokens: 7 },
    generationId: "embed_1",
  };
  const hydratedMemories = overrides.hydratedMemories ?? [];

  const ctx = {
    runQuery: async (_fn: unknown, args?: Record<string, unknown>) => {
      if (args && "userId" in args && !("messageId" in args) && !("hits" in args)) {
        return allMemories;
      }
      if (args && "messageId" in args && !("userId" in args)) {
        return queryEmbedding;
      }
      if (args && "hits" in args) {
        return hydratedMemories;
      }
      return null;
    },
    runMutation: async (fn: unknown, args: Record<string, unknown>) => {
      mutations.push({ fn, args });
      if ("usageRecordedMessageId" in args) {
        return true;
      }
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, fn: unknown, args: Record<string, unknown>) => {
        scheduled.push({ fn, args });
      },
    },
    vectorSearch: overrides.vectorSearchImpl ?? (async () => []),
  } as any;

  return { ctx, scheduled, mutations };
}

test("memory extraction utils normalize mixed payloads and filter invalid rows", () => {
  const parsed = parseMemoryExtractionPayload([
    "```json",
    "{",
    '  "memories": [',
    '    " User prefers concise responses ",',
    "    {",
    `      "fact": "User's name is Dino",`,
    '      "type": "profile",',
    '      "mode": "alwaysOn",',
    '      "importance": "0.8",',
    '      "confidence": "0.7",',
    '      "ttlDays": "14",',
    '      "tags": ["swift", 1, "ios"]',
    "    },",
    '    { "content": "   " }',
    "  ]",
    "}",
    "```",
  ].join("\n"));

  assert.deepEqual(parsed, [
    { content: "User prefers concise responses" },
    {
      content: "User's name is Dino",
      memoryType: "profile",
      retrievalMode: "alwaysOn",
      importanceScore: 0.8,
      confidenceScore: 0.7,
      expiresInDays: 14,
      tags: ["swift", "ios"],
      category: undefined,
    },
  ]);
});

test("memory extraction heuristics exclude contact info and keep stable user facts", () => {
  const rules = detectMemoryExclusionRules(
    "Do not store contact details in memory, especially phone and email.",
  );

  assert.deepEqual(rules, { excludePhone: true, excludeEmail: true });
  assert.equal(
    shouldExcludeMemoryContent("Reach me at dino@example.com", rules),
    true,
  );
  assert.equal(
    shouldExcludeMemoryContent("User prefers concise answers", rules),
    false,
  );
  assert.equal(memoryLikelyUserFact("User likes concise, direct responses"), true);
  assert.equal(memoryLikelyUserFact("User is exploring Rust today"), false);
  assert.equal(normalizeMemoryContent(`  - "User likes tea"  `), "User likes tea.");
  assert.equal(
    findDuplicateMemory("User prefers direct concise responses.", [
      { content: "User prefers concise direct responses." },
    ])?.content,
    "User prefers concise direct responses.",
  );
});

test("resolveMemoryContextForGeneration combines always-on and contextual memories", async () => {
  const { ctx, scheduled } = buildMemoryResolutionCtx({
    allMemories: [
      {
        _id: "memory_always",
        content: "User prefers concise responses.",
        memoryType: "responsePreference",
        retrievalMode: "alwaysOn",
        category: "writingStyle",
        importanceScore: 0.95,
      },
      {
        _id: "memory_context",
        content: "User is building an iOS app with Convex backend.",
        memoryType: "workContext",
        retrievalMode: "contextual",
        category: "work",
        importanceScore: 0.8,
        updatedAt: Date.now(),
      },
    ],
    hydratedMemories: [
      {
        _id: "memory_context",
        content: "User is building an iOS app with Convex backend.",
        memoryType: "workContext",
        retrievalMode: "contextual",
        category: "work",
        importanceScore: 0.8,
        updatedAt: Date.now(),
      },
    ],
    vectorSearchImpl: async () => [{ _id: "embedding_1", _score: 0.91 }],
  });

  const context = await resolveMemoryContextForGeneration(ctx, {
    messages: [
      { _id: "msg_1" as any, role: "assistant", content: "Previous response" },
      {
        _id: "msg_2" as any,
        role: "user",
        content: "   ",
      },
    ],
    userMessageId: "msg_2" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    assistantMessageId: "assist_1" as any,
  });

  assert.match(context, /Response preferences:/);
  assert.match(context, /User prefers concise responses\./);
  assert.match(context, /Relevant context:/);
  assert.match(context, /User is building an iOS app with Convex backend\./);
  assert.deepEqual(
    scheduled.map((entry) => entry.args),
    [
      {
        memoryIds: ["memory_always", "memory_context"],
        touchedAt: scheduled[0]?.args.touchedAt,
      },
    ],
  );
});

test("resolveMemoryContextForGeneration degrades gracefully when vector search throws", async () => {
  const { ctx } = buildMemoryResolutionCtx({
    allMemories: [
      {
        _id: "memory_always",
        content: "User prefers concise responses.",
        memoryType: "responsePreference",
        retrievalMode: "alwaysOn",
        category: "writingStyle",
        importanceScore: 0.95,
      },
      {
        _id: "memory_context",
        content: "User is building an iOS app.",
        memoryType: "workContext",
        retrievalMode: "contextual",
        category: "work",
        importanceScore: 0.8,
        updatedAt: Date.now(),
      },
    ],
    vectorSearchImpl: async () => { throw new Error("Embedding API timeout"); },
  });

  // Should NOT throw — should degrade to allMemories fallback.
  const context = await resolveMemoryContextForGeneration(ctx, {
    messages: [
      { _id: "msg_1" as any, role: "user", content: "Tell me about SwiftUI" },
    ],
    userMessageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
  });

  // Should still include always-on memories.
  assert.match(context, /User prefers concise responses\./);
  // Should fall back to contextual memories from allMemories.
  assert.match(context, /User is building an iOS app\./);
});

test("resolveMemoryContextForGeneration degrades gracefully when embedding row failed", async () => {
  const { ctx } = buildMemoryResolutionCtx({
    allMemories: [
      {
        _id: "memory_always",
        content: "User prefers concise responses.",
        memoryType: "responsePreference",
        retrievalMode: "alwaysOn",
        category: "writingStyle",
        importanceScore: 0.95,
      },
      {
        _id: "memory_context",
        content: "User is planning a launch checklist.",
        memoryType: "workContext",
        retrievalMode: "contextual",
        category: "work",
        importanceScore: 0.8,
        updatedAt: Date.now(),
      },
    ],
    queryEmbedding: { status: "failed", errorCode: "primary_embedding_failed" },
  });

  const context = await resolveMemoryContextForGeneration(ctx, {
    messages: [{ _id: "msg_1" as any, role: "user", content: "launch tasks" }],
    userMessageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
  });

  assert.match(context, /User prefers concise responses\./);
  assert.match(context, /User is planning a launch checklist\./);
});

test("resolveMemoryContextForGeneration tolerates partial hydration results", async () => {
  const { ctx, scheduled } = buildMemoryResolutionCtx({
    allMemories: [
      {
        _id: "memory_always",
        content: "User prefers concise responses.",
        memoryType: "responsePreference",
        retrievalMode: "alwaysOn",
        category: "writingStyle",
        importanceScore: 0.95,
      },
      {
        _id: "memory_context",
        content: "User works on iOS builds.",
        memoryType: "workContext",
        retrievalMode: "contextual",
        category: "work",
        importanceScore: 0.7,
        updatedAt: Date.now(),
      },
    ],
    hydratedMemories: [],
    vectorSearchImpl: async () => [{ _id: "embedding_1", _score: 0.9 }],
  });

  const context = await resolveMemoryContextForGeneration(ctx, {
    messages: [{ _id: "msg_1" as any, role: "user", content: "iOS build help" }],
    userMessageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
  });

  assert.match(context, /User works on iOS builds\./);
  assert.deepEqual((scheduled.at(-1) as any).args.memoryIds, ["memory_always", "memory_context"]);
});

test("resolveMemoryContextForGeneration respects persona visibility filters", async () => {
  const { ctx } = buildMemoryResolutionCtx({
    allMemories: [
      {
        _id: "memory_hidden",
        content: "Hidden memory.",
        memoryType: "profile",
        retrievalMode: "alwaysOn",
        category: "identity",
        personaIds: ["persona_hidden"],
        importanceScore: 0.9,
      },
      {
        _id: "memory_visible",
        content: "Visible memory.",
        memoryType: "profile",
        retrievalMode: "alwaysOn",
        category: "identity",
        personaIds: ["persona_1"],
        importanceScore: 0.9,
      },
    ],
    queryEmbedding: { status: "failed", errorCode: "empty_query" },
  });

  const context = await resolveMemoryContextForGeneration(ctx, {
    messages: [{ _id: "msg_1" as any, role: "user", content: "who am i" }],
    userMessageId: "msg_1" as any,
    userId: "user_1",
    personaId: "persona_1" as any,
    chatId: "chat_1" as any,
  });

  assert.match(context, /Visible memory\./);
  assert.doesNotMatch(context, /Hidden memory\./);
});

test("reinforceMemoryHandler promotes eligible transient memories and upgrades stronger scores", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  await reinforceMemoryHandler({
    db: {
      get: async () => ({
        _id: "memory_1",
        memoryType: "transient",
        reinforcementCount: 1,
        importanceScore: 0.4,
        confidenceScore: 0.5,
        expiresAt: 10,
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  } as any, {
    memoryId: "memory_1" as any,
    reinforcedAt: 50,
    candidateMemoryType: "workContext",
    candidateImportanceScore: 0.9,
    candidateConfidenceScore: 0.95,
    candidateExpiresAt: 200,
  });

  assert.deepEqual(patches, [{
    id: "memory_1",
    patch: {
      reinforcementCount: 2,
      lastReinforcedAt: 50,
      updatedAt: 50,
      importanceScore: 0.9,
      confidenceScore: 0.95,
      memoryType: "workContext",
      expiresAt: 200,
    },
  }]);
});

test("supersedeMemoryHandler and touchMemoriesHandler patch only active target memories", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const memories = new Map<string, Record<string, unknown>>([
    ["memory_1", { _id: "memory_1" }],
    ["touch_ok", { _id: "touch_ok", accessCount: 2 }],
    ["touch_pending", { _id: "touch_pending", isPending: true }],
    ["touch_superseded", { _id: "touch_superseded", isSuperseded: true }],
  ]);

  await supersedeMemoryHandler({
    db: {
      get: async (id: string) => memories.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  } as any, {
    memoryId: "memory_1" as any,
    supersededAt: 123,
    supersededByMemoryId: "memory_2" as any,
  });

  await touchMemoriesHandler({
    db: {
      get: async (id: string) => memories.get(id) ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  } as any, {
    memoryIds: [
      "touch_ok" as any,
      "touch_ok" as any,
      "touch_pending" as any,
      "touch_superseded" as any,
    ],
    touchedAt: 999,
  });

  assert.deepEqual(patches, [
    {
      id: "memory_1",
      patch: {
        isSuperseded: true,
        supersededByMemoryId: "memory_2",
        supersededAt: 123,
        expiresAt: 123,
        updatedAt: 123,
      },
    },
    {
      id: "touch_ok",
      patch: {
        accessCount: 3,
        lastAccessedAt: 999,
        updatedAt: 999,
      },
    },
  ]);
});
