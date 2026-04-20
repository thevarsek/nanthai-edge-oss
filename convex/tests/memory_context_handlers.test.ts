import assert from "node:assert/strict";
import test from "node:test";

import {
  claimMessageMemoryContextLeaseHandler,
  completeMessageMemoryContextHandler,
  ensureMessageMemoryContextReady,
  getMessageMemoryContextHandler,
  markMessageMemoryContextUsageRecordedHandler,
} from "../memory/memory_context_handlers";

// -----------------------------------------------------------------------------
// Local copy of the djb2-ish hashText used inside memory_context_handlers. The
// handler doesn't export it, but ensureMessageMemoryContextReady hashes the
// query text internally, so the test harness needs to seed rows with the same
// hash to simulate "cache hit" states.
// -----------------------------------------------------------------------------
function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

function createTableCtx() {
  const tables = {
    messageMemoryContexts: [] as Array<any>,
  };

  const db = {
    query: (tableName: keyof typeof tables) => ({
      withIndex: (_indexName?: string, builder?: (query: any) => any) => ({
        first: async () => {
          const filters: Record<string, unknown> = {};
          if (builder) {
            const query = {
              eq(field: string, value: unknown) {
                filters[field] = value;
                return query;
              },
            };
            builder(query);
          }
          return (
            tables[tableName].find((entry) =>
              Object.entries(filters).every(
                ([field, value]) => entry[field] === value,
              ),
            ) ?? null
          );
        },
      }),
    }),
    insert: async (
      tableName: keyof typeof tables,
      value: Record<string, unknown>,
    ) => {
      const doc = { _id: `${tableName}_${tables[tableName].length + 1}`, ...value };
      tables[tableName].push(doc);
      return doc._id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      for (const tableName of Object.keys(tables) as Array<
        keyof typeof tables
      >) {
        const row = tables[tableName].find((entry) => entry._id === id);
        if (row) {
          Object.assign(row, value);
          return;
        }
      }
    },
  };

  return { tables, db };
}

// -----------------------------------------------------------------------------
// Lease claim
// -----------------------------------------------------------------------------

test("claimMessageMemoryContextLeaseHandler inserts pending row and blocks active lease", async () => {
  const { db, tables } = createTableCtx();

  const first = await claimMessageMemoryContextLeaseHandler({ db } as any, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    textHash: "h1",
    leaseOwner: "owner_1",
    leaseExpiresAt: 1000,
    now: 10,
  });
  const second = await claimMessageMemoryContextLeaseHandler({ db } as any, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    textHash: "h1",
    leaseOwner: "owner_2",
    leaseExpiresAt: 1000,
    now: 11,
  });

  assert.deepEqual(first, { claimed: true, status: "pending" });
  assert.deepEqual(second, { claimed: false, status: "pending" });
  assert.equal(tables.messageMemoryContexts[0]?.status, "pending");
  assert.equal(tables.messageMemoryContexts[0]?.leaseOwner, "owner_1");
});

test("claimMessageMemoryContextLeaseHandler returns ready without mutating on matching hash", async () => {
  const { db, tables } = createTableCtx();
  tables.messageMemoryContexts.push({
    _id: "messageMemoryContexts_1",
    messageId: "msg_1",
    userId: "user_1",
    status: "ready",
    textHash: "h1",
    hydratedHits: [{ memoryId: "mem_1", score: 0.9 }],
    memoryQueryText: "hello",
    createdAt: 1,
    updatedAt: 2,
  });

  const result = await claimMessageMemoryContextLeaseHandler({ db } as any, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    textHash: "h1",
    leaseOwner: "owner_1",
    leaseExpiresAt: 1000,
    now: 100,
  });

  assert.deepEqual(result, { claimed: false, status: "ready" });
  assert.deepEqual(tables.messageMemoryContexts[0]?.hydratedHits, [
    { memoryId: "mem_1", score: 0.9 },
  ]);
  assert.equal(tables.messageMemoryContexts[0]?.updatedAt, 2);
});

test("claimMessageMemoryContextLeaseHandler takes over a stale textHash and clears payload", async () => {
  const { db, tables } = createTableCtx();
  tables.messageMemoryContexts.push({
    _id: "messageMemoryContexts_1",
    messageId: "msg_1",
    userId: "user_1",
    status: "ready",
    textHash: "h_old",
    hydratedHits: [{ memoryId: "mem_1", score: 0.9 }],
    memoryQueryText: "old text",
    usage: { promptTokens: 5, totalTokens: 5 },
    generationId: "gen_old",
    createdAt: 1,
    updatedAt: 2,
  });

  const reclaimed = await claimMessageMemoryContextLeaseHandler({ db } as any, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    textHash: "h_new",
    leaseOwner: "owner_2",
    leaseExpiresAt: 400,
    now: 200,
  });

  assert.deepEqual(reclaimed, { claimed: true, status: "pending" });
  assert.equal(tables.messageMemoryContexts[0]?.status, "pending");
  assert.equal(tables.messageMemoryContexts[0]?.textHash, "h_new");
  assert.equal(tables.messageMemoryContexts[0]?.hydratedHits, undefined);
  assert.equal(tables.messageMemoryContexts[0]?.memoryQueryText, undefined);
  assert.equal(tables.messageMemoryContexts[0]?.usage, undefined);
  assert.equal(tables.messageMemoryContexts[0]?.generationId, undefined);
  assert.equal(tables.messageMemoryContexts[0]?.updatedAt, 200);
});

test("claimMessageMemoryContextLeaseHandler takes over an expired lease", async () => {
  const { db, tables } = createTableCtx();
  tables.messageMemoryContexts.push({
    _id: "messageMemoryContexts_1",
    messageId: "msg_1",
    userId: "user_1",
    status: "pending",
    textHash: "h1",
    leaseOwner: "owner_1",
    leaseExpiresAt: 100,
    createdAt: 1,
    updatedAt: 1,
  });

  const reclaimed = await claimMessageMemoryContextLeaseHandler({ db } as any, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    textHash: "h1",
    leaseOwner: "owner_2",
    leaseExpiresAt: 600,
    now: 500, // past prior lease expiry
  });

  assert.deepEqual(reclaimed, { claimed: true, status: "pending" });
  assert.equal(tables.messageMemoryContexts[0]?.leaseOwner, "owner_2");
  assert.equal(tables.messageMemoryContexts[0]?.leaseExpiresAt, 600);
});

// -----------------------------------------------------------------------------
// Complete
// -----------------------------------------------------------------------------

test("completeMessageMemoryContextHandler stores ready payload and clears lease", async () => {
  const { db, tables } = createTableCtx();
  tables.messageMemoryContexts.push({
    _id: "messageMemoryContexts_1",
    messageId: "msg_1",
    userId: "user_1",
    status: "pending",
    textHash: "h1",
    leaseOwner: "owner_1",
    leaseExpiresAt: 500,
    createdAt: 1,
    updatedAt: 1,
  });

  await completeMessageMemoryContextHandler({ db } as any, {
    messageId: "msg_1" as any,
    status: "ready",
    hydratedHits: [{ memoryId: "mem_1", score: 0.91 }],
    memoryQueryText: "hello there",
    usage: { promptTokens: 7, totalTokens: 7 },
    generationId: "embed_1",
    now: 3,
  });

  const row = tables.messageMemoryContexts[0];
  assert.equal(row?.status, "ready");
  assert.deepEqual(row?.hydratedHits, [{ memoryId: "mem_1", score: 0.91 }]);
  assert.equal(row?.memoryQueryText, "hello there");
  assert.equal(row?.generationId, "embed_1");
  assert.equal(row?.leaseOwner, undefined);
  assert.equal(row?.leaseExpiresAt, undefined);
  assert.equal(row?.errorCode, undefined);
  assert.equal(row?.updatedAt, 3);
});

test("completeMessageMemoryContextHandler does not downgrade a ready row to failed", async () => {
  const { db, tables } = createTableCtx();
  tables.messageMemoryContexts.push({
    _id: "messageMemoryContexts_1",
    messageId: "msg_1",
    userId: "user_1",
    status: "ready",
    textHash: "h1",
    hydratedHits: [{ memoryId: "mem_1", score: 0.91 }],
    usage: { promptTokens: 7, totalTokens: 7 },
    generationId: "embed_1",
    createdAt: 1,
    updatedAt: 2,
  });

  await completeMessageMemoryContextHandler({ db } as any, {
    messageId: "msg_1" as any,
    status: "failed",
    errorCode: "memory_context_wait_timeout",
    now: 10,
  });

  const row = tables.messageMemoryContexts[0];
  assert.equal(row?.status, "ready");
  assert.deepEqual(row?.hydratedHits, [{ memoryId: "mem_1", score: 0.91 }]);
  assert.equal(row?.errorCode, undefined);
  assert.equal(row?.updatedAt, 2);
});

test("completeMessageMemoryContextHandler stores failure code and clears payload fields", async () => {
  const { db, tables } = createTableCtx();
  tables.messageMemoryContexts.push({
    _id: "messageMemoryContexts_1",
    messageId: "msg_1",
    userId: "user_1",
    status: "pending",
    textHash: "h1",
    leaseOwner: "owner_1",
    leaseExpiresAt: 500,
    createdAt: 1,
    updatedAt: 1,
  });

  await completeMessageMemoryContextHandler({ db } as any, {
    messageId: "msg_1" as any,
    status: "failed",
    errorCode: "embedding_not_ready",
    now: 5,
  });

  const row = tables.messageMemoryContexts[0];
  assert.equal(row?.status, "failed");
  assert.equal(row?.errorCode, "embedding_not_ready");
  assert.equal(row?.hydratedHits, undefined);
  assert.equal(row?.memoryQueryText, undefined);
  assert.equal(row?.usage, undefined);
  assert.equal(row?.leaseOwner, undefined);
});

// -----------------------------------------------------------------------------
// Usage billing guard
// -----------------------------------------------------------------------------

test("markMessageMemoryContextUsageRecordedHandler records usage exactly once", async () => {
  const { db, tables } = createTableCtx();
  tables.messageMemoryContexts.push({
    _id: "messageMemoryContexts_1",
    messageId: "msg_1",
    userId: "user_1",
    status: "ready",
    textHash: "h1",
    hydratedHits: [],
    usage: { promptTokens: 7, totalTokens: 7 },
    generationId: "embed_1",
    createdAt: 1,
    updatedAt: 2,
  });

  const firstRecord = await markMessageMemoryContextUsageRecordedHandler(
    { db } as any,
    {
      messageId: "msg_1" as any,
      usageRecordedAt: 10,
      usageRecordedMessageId: "assist_1" as any,
    },
  );
  const secondRecord = await markMessageMemoryContextUsageRecordedHandler(
    { db } as any,
    {
      messageId: "msg_1" as any,
      usageRecordedAt: 20,
      usageRecordedMessageId: "assist_2" as any,
    },
  );

  assert.equal(firstRecord, true);
  assert.equal(secondRecord, false);
  assert.equal(tables.messageMemoryContexts[0]?.usageRecordedMessageId, "assist_1");
  assert.equal(tables.messageMemoryContexts[0]?.usageRecordedAt, 10);
});

test("markMessageMemoryContextUsageRecordedHandler returns false when usage absent", async () => {
  const { db, tables } = createTableCtx();
  tables.messageMemoryContexts.push({
    _id: "messageMemoryContexts_1",
    messageId: "msg_1",
    userId: "user_1",
    status: "failed",
    textHash: "h1",
    errorCode: "embedding_not_ready",
    createdAt: 1,
    updatedAt: 2,
  });

  const result = await markMessageMemoryContextUsageRecordedHandler(
    { db } as any,
    {
      messageId: "msg_1" as any,
      usageRecordedAt: 10,
      usageRecordedMessageId: "assist_1" as any,
    },
  );

  assert.equal(result, false);
});

// -----------------------------------------------------------------------------
// Query handler
// -----------------------------------------------------------------------------

test("getMessageMemoryContextHandler returns null when row is missing", async () => {
  const { db } = createTableCtx();
  const result = await getMessageMemoryContextHandler({ db } as any, {
    messageId: "msg_missing" as any,
  });
  assert.equal(result, null);
});

// -----------------------------------------------------------------------------
// ensureMessageMemoryContextReady: cache-hit short-circuit
// -----------------------------------------------------------------------------

test("ensureMessageMemoryContextReady returns ready row when textHash matches (no compute)", async () => {
  const { db, tables } = createTableCtx();
  const queryText = "what did we talk about";
  tables.messageMemoryContexts.push({
    _id: "messageMemoryContexts_1",
    messageId: "msg_1",
    userId: "user_1",
    status: "ready",
    textHash: hashText(queryText),
    hydratedHits: [{ memoryId: "mem_1", score: 0.92 }],
    memoryQueryText: queryText,
    usage: { promptTokens: 7, totalTokens: 7 },
    generationId: "embed_1",
    createdAt: 1,
    updatedAt: 2,
  });

  let computeCalled = false;
  const ctx = {
    runQuery: async (_fn: unknown, args?: Record<string, unknown>) => {
      if (args && "messageId" in args) {
        return await getMessageMemoryContextHandler({ db } as any, args as any);
      }
      return null;
    },
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("leaseOwner" in args) {
        return await claimMessageMemoryContextLeaseHandler(
          { db } as any,
          args as any,
        );
      }
      if ("status" in args) {
        return await completeMessageMemoryContextHandler(
          { db } as any,
          args as any,
        );
      }
      return undefined;
    },
    scheduler: { runAfter: async () => undefined },
    vectorSearch: async () => {
      computeCalled = true;
      return [];
    },
  } as any;

  const result = await ensureMessageMemoryContextReady(ctx, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    queryText,
    leaseOwner: "owner_consumer",
  });

  assert.equal(result?.status, "ready");
  assert.deepEqual(result?.hydratedHits, [{ memoryId: "mem_1", score: 0.92 }]);
  assert.equal(computeCalled, false, "vectorSearch must not be called on cache hit");
});

test("ensureMessageMemoryContextReady ignores a ready row with stale textHash", async () => {
  const { db, tables } = createTableCtx();
  const oldText = "old text";
  const newText = "new text entirely";
  tables.messageMemoryContexts.push({
    _id: "messageMemoryContexts_1",
    messageId: "msg_1",
    userId: "user_1",
    status: "ready",
    textHash: hashText(oldText),
    hydratedHits: [{ memoryId: "mem_stale", score: 0.5 }],
    memoryQueryText: oldText,
    createdAt: 1,
    updatedAt: 2,
  });

  // Drive claim: stale hash must trigger takeover. We short-circuit the
  // full compute by having the lease claim succeed and then simulating
  // the consumer's compute writing a new ready row (so ensureReady returns
  // the fresh row on its next poll).
  let claimCount = 0;
  const ctx = {
    runQuery: async (_fn: unknown, args?: Record<string, unknown>) => {
      if (args && "messageId" in args) {
        return await getMessageMemoryContextHandler({ db } as any, args as any);
      }
      return null;
    },
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("leaseOwner" in args) {
        claimCount += 1;
        const result = await claimMessageMemoryContextLeaseHandler(
          { db } as any,
          args as any,
        );
        // After the consumer claims the stale row, short-circuit compute by
        // writing a ready row under the NEW hash. This simulates a fast
        // successful compute.
        if (result.claimed && claimCount === 1) {
          await completeMessageMemoryContextHandler({ db } as any, {
            messageId: "msg_1" as any,
            status: "ready",
            hydratedHits: [{ memoryId: "mem_fresh", score: 0.81 }],
            memoryQueryText: newText,
            now: 100,
          });
        }
        return result;
      }
      if ("status" in args) {
        return await completeMessageMemoryContextHandler(
          { db } as any,
          args as any,
        );
      }
      return undefined;
    },
    scheduler: { runAfter: async () => undefined },
    vectorSearch: async () => [],
  } as any;

  const result = await ensureMessageMemoryContextReady(ctx, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    queryText: newText,
    leaseOwner: "owner_consumer",
  });

  assert.equal(result?.status, "ready");
  assert.deepEqual(result?.hydratedHits, [{ memoryId: "mem_fresh", score: 0.81 }]);
  assert.equal(result?.textHash, hashText(newText));
});
