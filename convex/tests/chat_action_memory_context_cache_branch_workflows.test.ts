import test from "node:test";
import assert from "node:assert/strict";

import { resolveMemoryContextForGeneration } from "../chat/action_memory_helpers";

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function memory(overrides: Record<string, unknown>) {
  return {
    _id: "memory_context",
    content: "User ships iOS apps with Convex.",
    memoryType: "workContext",
    retrievalMode: "contextual",
    category: "work",
    importanceScore: 0.8,
    updatedAt: 100,
    ...overrides,
  };
}

test("resolveMemoryContextForGeneration uses ready memory-context cache and attributes usage once", async () => {
  const scheduled: Array<{ args: Record<string, unknown> }> = [];
  const mutations: Array<Record<string, unknown>> = [];
  let vectorSearchCount = 0;
  const queryText = "How should I test the iOS client?";

  const ctx = {
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("userId" in args && !("messageId" in args)) {
        return [
          memory({
            _id: "memory_always",
            content: "User prefers concise responses.",
            memoryType: "responsePreference",
            retrievalMode: "alwaysOn",
          }),
        ];
      }
      if ("messageId" in args) {
        return {
          status: "ready",
          textHash: hashText(queryText),
          hydratedHits: [memory({ _id: "memory_context" })],
          usage: { promptTokens: 13, totalTokens: 13 },
          generationId: "memory_context_gen",
        };
      }
      return [];
    },
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if ("usageRecordedMessageId" in args) return true;
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, args: Record<string, unknown>) => {
        scheduled.push({ args });
      },
    },
    vectorSearch: async () => {
      vectorSearchCount += 1;
      return [];
    },
  } as any;

  const context = await resolveMemoryContextForGeneration(ctx, {
    messages: [{ _id: "msg_user" as any, role: "user", content: queryText }],
    userMessageId: "msg_user" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    assistantMessageId: "msg_assistant" as any,
  });

  assert.match(context, /User prefers concise responses\./);
  assert.match(context, /User ships iOS apps with Convex\./);
  assert.equal(vectorSearchCount, 0);
  assert.equal(mutations.some((args) => args.usageRecordedMessageId === "msg_assistant"), true);
  assert.equal(
    scheduled.some((entry) => entry.args.source === "memory_embedding_retrieve"),
    true,
  );
  assert.deepEqual(scheduled.at(-1)?.args.memoryIds, ["memory_always", "memory_context"]);
});

test("resolveMemoryContextForGeneration falls back to all contextual memories when cache failed", async () => {
  const queryText = "launch checklist";
  const ctx = {
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("userId" in args && !("messageId" in args)) {
        return [memory({ content: "User is preparing a launch checklist." })];
      }
      if ("messageId" in args) {
        return {
          status: "failed",
          textHash: hashText(queryText),
          hydratedHits: [memory({ content: "Should be ignored." })],
          errorCode: "memory_context_wait_timeout",
        };
      }
      return [];
    },
    runMutation: async () => undefined,
    scheduler: { runAfter: async () => undefined },
    vectorSearch: async () => {
      throw new Error("cache failure should not call vector search");
    },
  } as any;

  const context = await resolveMemoryContextForGeneration(ctx, {
    messages: [{ _id: "msg_user" as any, role: "user", content: queryText }],
    userMessageId: "msg_user" as any,
    userId: "user_1",
  });

  assert.match(context, /User is preparing a launch checklist\./);
  assert.doesNotMatch(context, /Should be ignored/);
});

test("resolveMemoryContextForGeneration skips retrieval for blank prompts without touching memories", async () => {
  let vectorSearchCount = 0;
  let scheduledCount = 0;
  const ctx = {
    runQuery: async () => [],
    runMutation: async () => undefined,
    scheduler: {
      runAfter: async () => {
        scheduledCount += 1;
      },
    },
    vectorSearch: async () => {
      vectorSearchCount += 1;
      return [];
    },
  } as any;

  const context = await resolveMemoryContextForGeneration(ctx, {
    messages: [{ _id: "assistant_1" as any, role: "assistant", content: "No user turn." }],
    userMessageId: "missing_user" as any,
    userId: "user_1",
  });

  assert.equal(context, "");
  assert.equal(vectorSearchCount, 0);
  assert.equal(scheduledCount, 0);
});

test("resolveMemoryContextForGeneration falls back inline and avoids duplicate usage billing", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const mutations: Array<Record<string, unknown>> = [];
  let messageRowReads = 0;
  const queryText = "inline fallback";
  const ctx = {
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("userId" in args && !("messageId" in args)) return [];
      if ("hits" in args) {
        return [memory({
          _id: "memory_inline",
          content: "User relies on inline memory fallback.",
        })];
      }
      if ("messageId" in args) {
        messageRowReads += 1;
        return messageRowReads === 1
          ? { status: "pending", textHash: hashText(queryText) }
          : {
              status: "ready",
              textHash: hashText(queryText),
              embedding: [0.1, 0.2],
              usage: { promptTokens: 5, totalTokens: 5 },
              generationId: "embedding_gen",
            };
      }
      return [];
    },
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if ("usageRecordedMessageId" in args) return false;
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
    vectorSearch: async () => [{ _id: "embedding_1", _score: 0.91 }],
  } as any;

  const context = await resolveMemoryContextForGeneration(ctx, {
    messages: [{ _id: "msg_user" as any, role: "user", content: queryText }],
    userMessageId: "msg_user" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    assistantMessageId: "msg_assistant" as any,
  });

  assert.match(context, /inline memory fallback/);
  assert.equal(mutations.some((args) => args.usageRecordedMessageId === "msg_assistant"), true);
  assert.equal(scheduled.some((args) => args.source === "memory_embedding_retrieve"), false);
  assert.deepEqual(scheduled.at(-1)?.memoryIds, ["memory_inline"]);
});
