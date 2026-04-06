import assert from "node:assert/strict";
import test from "node:test";

import {
  purgeUserMemoriesBatchHandler,
  purgeUserMemoriesHandler,
  storeEmbeddingHandler,
} from "../memory/operations_internal_handlers";

test("storeEmbeddingHandler patches an existing embedding row", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  await storeEmbeddingHandler({
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "embedding_1", memoryId: "memory_1" }),
        }),
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      insert: async () => {
        throw new Error("insert should not run");
      },
    },
  } as any, {
    memoryId: "memory_1" as any,
    userId: "user_1",
    embedding: [0.1, 0.2],
  });

  assert.deepEqual(patches, [{
    id: "embedding_1",
    patch: { embedding: [0.1, 0.2], userId: "user_1" },
  }]);
});

test("storeEmbeddingHandler inserts when the embedding row is missing", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

  await storeEmbeddingHandler({
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => null,
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
      },
    },
  } as any, {
    memoryId: "memory_1" as any,
    userId: "user_1",
    embedding: [0.3, 0.4],
  });

  assert.deepEqual(inserts, [{
    table: "memoryEmbeddings",
    value: {
      memoryId: "memory_1",
      userId: "user_1",
      embedding: [0.3, 0.4],
    },
  }]);
});

test("purgeUserMemoriesBatchHandler deletes embeddings before memories", async () => {
  const deleted: string[] = [];

  const count = await purgeUserMemoriesBatchHandler({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () =>
            table === "memories"
              ? [{ _id: "memory_1" }, { _id: "memory_2" }]
              : [],
          first: async () =>
            table === "memoryEmbeddings"
              ? { _id: `embedding_for_${deleted.length === 0 ? "memory_1" : "memory_2"}` }
              : null,
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
  } as any, {
    userId: "user_1",
  });

  assert.equal(count, 2);
  assert.deepEqual(deleted, [
    "embedding_for_memory_1",
    "memory_1",
    "embedding_for_memory_2",
    "memory_2",
  ]);
});

test("purgeUserMemoriesHandler loops until the batch mutation falls below the batch size", async () => {
  let calls = 0;

  await purgeUserMemoriesHandler({
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      calls += 1;
      assert.equal(args.userId, "user_1");
      return calls === 1 ? 200 : 17;
    },
  } as any, {
    userId: "user_1",
  });

  assert.equal(calls, 2);
});
