import assert from "node:assert/strict";
import test, { mock } from "node:test";

import {
  claimMessageQueryEmbeddingLeaseHandler,
  completeMessageQueryEmbeddingHandler,
  ensureMessageQueryEmbeddingReady,
  markMessageQueryEmbeddingUsageRecordedHandler,
  primeMessageQueryEmbeddingHandler,
} from "../memory/query_embedding_handlers";

function createTableCtx() {
  const tables = {
    messageQueryEmbeddings: [] as Array<any>,
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
          return tables[tableName].find((entry) =>
            Object.entries(filters).every(([field, value]) => entry[field] === value)
          ) ?? null;
        },
        order: () => ({
          take: async (limit: number) => tables[tableName]
            .slice()
            .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
            .slice(0, limit),
        }),
      }),
    }),
    insert: async (tableName: keyof typeof tables, value: Record<string, unknown>) => {
      const doc = { _id: `${tableName}_1`, ...value };
      tables[tableName].push(doc);
      return doc._id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      for (const tableName of Object.keys(tables) as Array<keyof typeof tables>) {
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

function hashText(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return `h${(hash >>> 0).toString(16)}`;
}

test("claimMessageQueryEmbeddingLeaseHandler inserts pending row and blocks active lease", async () => {
  const { db, tables } = createTableCtx();

  const first = await claimMessageQueryEmbeddingLeaseHandler({ db } as any, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    textHash: "h1",
    leaseOwner: "owner_1",
    leaseExpiresAt: 1000,
    now: 10,
  });
  const second = await claimMessageQueryEmbeddingLeaseHandler({ db } as any, {
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
  assert.equal(tables.messageQueryEmbeddings[0]?.status, "pending");
});

test("claimMessageQueryEmbeddingLeaseHandler preserves createdAt when reclaiming a stale lease", async () => {
  const { db, tables } = createTableCtx();
  tables.messageQueryEmbeddings.push({
    _id: "messageQueryEmbeddings_1",
    messageId: "msg_1",
    userId: "user_1",
    provider: "openrouter",
    modelId: "openai/text-embedding-3-small",
    status: "pending",
    textHash: "h1",
    leaseOwner: "owner_1",
    leaseExpiresAt: 100,
    createdAt: 10,
    updatedAt: 10,
  });

  const reclaimed = await claimMessageQueryEmbeddingLeaseHandler({ db } as any, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    textHash: "h2",
    leaseOwner: "owner_2",
    leaseExpiresAt: 400,
    now: 200,
  });

  assert.deepEqual(reclaimed, { claimed: true, status: "pending" });
  assert.equal(tables.messageQueryEmbeddings[0]?.createdAt, 10);
  assert.equal(tables.messageQueryEmbeddings[0]?.updatedAt, 200);
  assert.equal(tables.messageQueryEmbeddings[0]?.textHash, "h2");
});

test("claimMessageQueryEmbeddingLeaseHandler takes over ready row with stale textHash", async () => {
  const { db, tables } = createTableCtx();
  tables.messageQueryEmbeddings.push({
    _id: "messageQueryEmbeddings_1",
    messageId: "msg_1",
    userId: "user_1",
    provider: "openrouter",
    modelId: "openai/text-embedding-3-small",
    status: "ready",
    textHash: "h_old",
    embedding: [0.1, 0.2],
    usage: { promptTokens: 5, totalTokens: 5 },
    generationId: "embed_old",
    createdAt: 10,
    updatedAt: 20,
  });

  const reclaimed = await claimMessageQueryEmbeddingLeaseHandler({ db } as any, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    textHash: "h_new",
    leaseOwner: "owner_2",
    leaseExpiresAt: 400,
    now: 200,
  });

  assert.deepEqual(reclaimed, { claimed: true, status: "pending" });
  assert.equal(tables.messageQueryEmbeddings[0]?.status, "pending");
  assert.equal(tables.messageQueryEmbeddings[0]?.textHash, "h_new");
  assert.equal(tables.messageQueryEmbeddings[0]?.embedding, undefined);
  assert.equal(tables.messageQueryEmbeddings[0]?.usage, undefined);
  assert.equal(tables.messageQueryEmbeddings[0]?.generationId, undefined);
});

test("claimMessageQueryEmbeddingLeaseHandler ignores active lease with stale textHash", async () => {
  const { db, tables } = createTableCtx();
  tables.messageQueryEmbeddings.push({
    _id: "messageQueryEmbeddings_1",
    messageId: "msg_1",
    userId: "user_1",
    provider: "openrouter",
    modelId: "openai/text-embedding-3-small",
    status: "pending",
    textHash: "h_old",
    leaseOwner: "owner_old",
    leaseExpiresAt: 1000,
    createdAt: 10,
    updatedAt: 10,
  });

  const reclaimed = await claimMessageQueryEmbeddingLeaseHandler({ db } as any, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    textHash: "h_new",
    leaseOwner: "owner_new",
    leaseExpiresAt: 1200,
    now: 200,
  });

  assert.deepEqual(reclaimed, { claimed: true, status: "pending" });
  assert.equal(tables.messageQueryEmbeddings[0]?.textHash, "h_new");
  assert.equal(tables.messageQueryEmbeddings[0]?.leaseOwner, "owner_new");
});

test("completeMessageQueryEmbeddingHandler and usage recording patch one row once", async () => {
  const { db, tables } = createTableCtx();
  tables.messageQueryEmbeddings.push({
    _id: "messageQueryEmbeddings_1",
    messageId: "msg_1",
    userId: "user_1",
    provider: "openrouter",
    modelId: "openai/text-embedding-3-small",
    status: "pending",
    textHash: "h1",
    createdAt: 1,
    updatedAt: 1,
  });

  await completeMessageQueryEmbeddingHandler({ db } as any, {
    messageId: "msg_1" as any,
    textHash: "h1",
    status: "ready",
    embedding: [0.1, 0.2],
    usage: { promptTokens: 5, totalTokens: 5 },
    generationId: "embed_1",
    now: 2,
  });

  const firstRecord = await markMessageQueryEmbeddingUsageRecordedHandler({ db } as any, {
    messageId: "msg_1" as any,
    usageRecordedAt: 3,
    usageRecordedMessageId: "assist_1" as any,
  });
  const secondRecord = await markMessageQueryEmbeddingUsageRecordedHandler({ db } as any, {
    messageId: "msg_1" as any,
    usageRecordedAt: 4,
    usageRecordedMessageId: "assist_2" as any,
  });

  assert.equal(firstRecord, true);
  assert.equal(secondRecord, false);
  assert.equal(tables.messageQueryEmbeddings[0]?.status, "ready");
  assert.deepEqual(tables.messageQueryEmbeddings[0]?.usage, {
    promptTokens: 5,
    totalTokens: 5,
  });
  assert.equal(tables.messageQueryEmbeddings[0]?.usageRecordedMessageId, "assist_1");
});

test("claimMessageQueryEmbeddingLeaseHandler clears usage marker when privacy hash changes", async () => {
  const { db, tables } = createTableCtx();
  tables.messageQueryEmbeddings.push({
    _id: "messageQueryEmbeddings_1",
    messageId: "msg_1",
    userId: "user_1",
    provider: "openrouter",
    modelId: "openai/text-embedding-3-small",
    status: "ready",
    textHash: "h_non_zdr",
    embedding: [0.1, 0.2],
    usage: { promptTokens: 5, totalTokens: 5 },
    usageRecordedAt: 10,
    usageRecordedMessageId: "assist_old",
    createdAt: 1,
    updatedAt: 10,
  });

  const claimed = await claimMessageQueryEmbeddingLeaseHandler({ db } as any, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    textHash: "h_zdr",
    leaseOwner: "owner_zdr",
    leaseExpiresAt: 200,
    now: 100,
  });

  assert.deepEqual(claimed, { claimed: true, status: "pending" });
  assert.equal(tables.messageQueryEmbeddings[0]?.usageRecordedAt, undefined);
  assert.equal(tables.messageQueryEmbeddings[0]?.usageRecordedMessageId, undefined);

  await completeMessageQueryEmbeddingHandler({ db } as any, {
    messageId: "msg_1" as any,
    textHash: "h_zdr",
    status: "ready",
    embedding: [0.3, 0.4],
    usage: { promptTokens: 7, totalTokens: 7 },
    generationId: "embed_zdr",
    now: 101,
  });

  const recorded = await markMessageQueryEmbeddingUsageRecordedHandler({ db } as any, {
    messageId: "msg_1" as any,
    usageRecordedAt: 102,
    usageRecordedMessageId: "assist_new" as any,
  });

  assert.equal(recorded, true);
  assert.equal(tables.messageQueryEmbeddings[0]?.usageRecordedMessageId, "assist_new");
});

test("completeMessageQueryEmbeddingHandler does not downgrade a ready row to failed", async () => {
  const { db, tables } = createTableCtx();
  tables.messageQueryEmbeddings.push({
    _id: "messageQueryEmbeddings_1",
    messageId: "msg_1",
    userId: "user_1",
    provider: "openrouter",
    modelId: "openai/text-embedding-3-small",
    status: "ready",
    textHash: "h1",
    embedding: [0.1, 0.2],
    usage: { promptTokens: 5, totalTokens: 5 },
    generationId: "embed_1",
    createdAt: 1,
    updatedAt: 2,
  });

  await completeMessageQueryEmbeddingHandler({ db } as any, {
    messageId: "msg_1" as any,
    textHash: "h1",
    status: "failed",
    errorCode: "embedding_wait_timeout",
    now: 3,
  });

  assert.equal(tables.messageQueryEmbeddings[0]?.status, "ready");
  assert.deepEqual(tables.messageQueryEmbeddings[0]?.embedding, [0.1, 0.2]);
  assert.equal(tables.messageQueryEmbeddings[0]?.errorCode, undefined);
  assert.equal(tables.messageQueryEmbeddings[0]?.updatedAt, 2);
});

test("completeMessageQueryEmbeddingHandler ignores stale worker textHash", async () => {
  const { db, tables } = createTableCtx();
  tables.messageQueryEmbeddings.push({
    _id: "messageQueryEmbeddings_1",
    messageId: "msg_1",
    userId: "user_1",
    provider: "openrouter",
    modelId: "openai/text-embedding-3-small",
    status: "pending",
    textHash: "h_new",
    leaseOwner: "owner_new",
    leaseExpiresAt: 1000,
    createdAt: 1,
    updatedAt: 2,
  });

  await completeMessageQueryEmbeddingHandler({ db } as any, {
    messageId: "msg_1" as any,
    textHash: "h_old",
    status: "ready",
    embedding: [0.9, 0.8],
    usage: { promptTokens: 2, totalTokens: 2 },
    generationId: "embed_stale",
    now: 3,
  });

  const row = tables.messageQueryEmbeddings[0];
  assert.equal(row?.status, "pending");
  assert.equal(row?.textHash, "h_new");
  assert.equal(row?.embedding, undefined);
  assert.equal(row?.usage, undefined);
  assert.equal(row?.generationId, undefined);
  assert.equal(row?.updatedAt, 2);
});

test("primeMessageQueryEmbeddingHandler stores ready embedding", async (t) => {
  t.after(() => {
    mock.restoreAll();
  });

  mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({
      id: "embed_1",
      data: [{ embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 7, total_tokens: 7 },
    }),
    { status: 200 },
  ));

  const { db, tables } = createTableCtx();
  const scheduled: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async (_fn: unknown, args?: Record<string, unknown>) => {
      if (args && "messageId" in args && !("userId" in args)) {
        return { _id: "msg_1", content: "hello there" };
      }
      if (args && "userId" in args) {
        return "sk-openrouter";
      }
      return null;
    },
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("leaseOwner" in args) {
        return await claimMessageQueryEmbeddingLeaseHandler({ db } as any, args as any);
      }
      if ("status" in args) {
        return await completeMessageQueryEmbeddingHandler({ db } as any, args as any);
      }
      return undefined;
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  } as any;

  await primeMessageQueryEmbeddingHandler(ctx, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    queryText: "hello there",
  });

  assert.equal(tables.messageQueryEmbeddings[0]?.status, "ready");
  assert.deepEqual(tables.messageQueryEmbeddings[0]?.embedding, [0.1, 0.2, 0.3]);
  assert.equal(scheduled.length, 0);
});

test("primeMessageQueryEmbeddingHandler sends provider.zdr when required", async (t) => {
  t.after(() => {
    mock.restoreAll();
  });

  let body: Record<string, any> | undefined;
  mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response(
      JSON.stringify({
        id: "embed_zdr",
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 7, total_tokens: 7 },
      }),
      { status: 200 },
    );
  });

  const { db, tables } = createTableCtx();
  const ctx = {
    runQuery: async (_fn: unknown, args?: Record<string, unknown>) => {
      if (args && "messageId" in args && !("userId" in args)) {
        return { _id: "msg_1", content: "hello there" };
      }
      if (args && "userId" in args) {
        return "sk-openrouter";
      }
      return null;
    },
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("leaseOwner" in args) {
        return await claimMessageQueryEmbeddingLeaseHandler({ db } as any, args as any);
      }
      if ("status" in args) {
        return await completeMessageQueryEmbeddingHandler({ db } as any, args as any);
      }
      return undefined;
    },
    scheduler: { runAfter: async () => undefined },
  } as any;

  await primeMessageQueryEmbeddingHandler(ctx, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    queryText: "hello there",
    requireZdr: true,
  });

  assert.equal(tables.messageQueryEmbeddings[0]?.status, "ready");
  assert.deepEqual(body?.provider, { sort: "latency", zdr: true });
});

test("primeMessageQueryEmbeddingHandler marks row failed when primary embedding throws", async (t) => {
  t.after(() => mock.restoreAll());

  mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });

  const { db, tables } = createTableCtx();
  const ctx = {
    runQuery: async (_fn: unknown, args?: Record<string, unknown>) => {
      if (args && "messageId" in args && !("userId" in args)) {
        return { _id: "msg_1", content: "hello there" };
      }
      if (args && "userId" in args) {
        return "sk-openrouter";
      }
      return null;
    },
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("leaseOwner" in args) {
        return await claimMessageQueryEmbeddingLeaseHandler({ db } as any, args as any);
      }
      if ("status" in args) {
        return await completeMessageQueryEmbeddingHandler({ db } as any, args as any);
      }
      return undefined;
    },
    scheduler: { runAfter: async () => undefined },
  } as any;

  await primeMessageQueryEmbeddingHandler(ctx, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    queryText: "hello there",
  });

  assert.equal(tables.messageQueryEmbeddings[0]?.status, "failed");
  assert.equal(tables.messageQueryEmbeddings[0]?.leaseOwner, undefined);
});

test("primeMessageQueryEmbeddingHandler stores a stable missing_api_key code", async () => {
  const { db, tables } = createTableCtx();
  const ctx = {
    runQuery: async (_fn: unknown, args?: Record<string, unknown>) => {
      if (args && "messageId" in args && !("userId" in args)) {
        return { _id: "msg_1", content: "hello there" };
      }
      if (args && "userId" in args) {
        return null;
      }
      return null;
    },
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("leaseOwner" in args) {
        return await claimMessageQueryEmbeddingLeaseHandler({ db } as any, args as any);
      }
      if ("status" in args) {
        return await completeMessageQueryEmbeddingHandler({ db } as any, args as any);
      }
      return undefined;
    },
    scheduler: { runAfter: async () => undefined },
  } as any;

  await primeMessageQueryEmbeddingHandler(ctx, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    queryText: "hello there",
  });

  assert.equal(tables.messageQueryEmbeddings[0]?.status, "failed");
  assert.equal(tables.messageQueryEmbeddings[0]?.errorCode, "missing_api_key");
});

test("ensureMessageQueryEmbeddingReady reuses ready row across calls", async (t) => {
  t.after(() => mock.restoreAll());

  let computeCalls = 0;
  mock.method(globalThis, "fetch", async () => {
    computeCalls += 1;
    return new Response(
      JSON.stringify({
        id: "embed_1",
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      }),
      { status: 200 },
    );
  });

  const { db } = createTableCtx();
  const ctx = {
    runQuery: async (_fn: unknown, args?: Record<string, unknown>) => {
      if (args && "messageId" in args && !("userId" in args)) {
        return await db.query("messageQueryEmbeddings").withIndex("by_message", () => null).first();
      }
      if (args && "userId" in args) {
        return "sk-openrouter";
      }
      return null;
    },
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("leaseOwner" in args) {
        return await claimMessageQueryEmbeddingLeaseHandler({ db } as any, args as any);
      }
      if ("status" in args) {
        return await completeMessageQueryEmbeddingHandler({ db } as any, args as any);
      }
      return undefined;
    },
    scheduler: { runAfter: async () => undefined },
  } as any;

  const first = await ensureMessageQueryEmbeddingReady(ctx, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    queryText: "hello there",
    leaseOwner: "owner_1",
  });
  const second = await ensureMessageQueryEmbeddingReady(ctx, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    queryText: "hello there",
    leaseOwner: "owner_2",
  });

  assert.equal(first?.status, "ready");
  assert.equal(second?.status, "ready");
  assert.equal(computeCalls, 1);
});

test("ensureMessageQueryEmbeddingReady ignores ready non-ZDR row when ZDR is required", async (t) => {
  t.after(() => mock.restoreAll());

  const queryText = "hello there";
  const nonZdrHash = hashText(queryText);
  const zdrHash = hashText(`zdr:${queryText}`);
  let computeCalls = 0;
  mock.method(globalThis, "fetch", async () => {
    computeCalls += 1;
    return new Response(
      JSON.stringify({
        id: "embed_zdr",
        data: [{ embedding: [0.4, 0.5, 0.6] }],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      }),
      { status: 200 },
    );
  });

  const { db, tables } = createTableCtx();
  tables.messageQueryEmbeddings.push({
    _id: "messageQueryEmbeddings_1",
    messageId: "msg_1",
    userId: "user_1",
    provider: "openrouter",
    modelId: "openai/text-embedding-3-small",
    status: "ready",
    textHash: nonZdrHash,
    embedding: [0.1, 0.2, 0.3],
    createdAt: 1,
    updatedAt: 2,
  });
  const ctx = {
    runQuery: async (_fn: unknown, args?: Record<string, unknown>) => {
      if (args && "messageId" in args && !("userId" in args)) {
        return await db.query("messageQueryEmbeddings").withIndex("by_message", () => null).first();
      }
      if (args && "userId" in args) {
        return "sk-openrouter";
      }
      return null;
    },
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("leaseOwner" in args) {
        return await claimMessageQueryEmbeddingLeaseHandler({ db } as any, args as any);
      }
      if ("status" in args) {
        return await completeMessageQueryEmbeddingHandler({ db } as any, args as any);
      }
      return undefined;
    },
    scheduler: { runAfter: async () => undefined },
  } as any;

  const result = await ensureMessageQueryEmbeddingReady(ctx, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    queryText,
    leaseOwner: "owner_zdr",
    requireZdr: true,
  });

  assert.equal(result?.status, "ready");
  assert.equal(result?.textHash, zdrHash);
  assert.deepEqual(result?.embedding, [0.4, 0.5, 0.6]);
  assert.equal(computeCalls, 1);
  assert.equal(tables.messageQueryEmbeddings[0]?.textHash, zdrHash);
});

test("ensureMessageQueryEmbeddingReady grants a lease within the wait timeout", async (t) => {
  t.after(() => mock.restoreAll());

  mock.method(Date, "now", () => 100_000);
  mock.method(globalThis, "fetch", async () => new Response(
    JSON.stringify({
      id: "embed_1",
      data: [{ embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 4, total_tokens: 4 },
    }),
    { status: 200 },
  ));

  const { db } = createTableCtx();
  let firstLeaseArgs: Record<string, unknown> | undefined;
  const ctx = {
    runQuery: async (_fn: unknown, args?: Record<string, unknown>) => {
      if (args && "messageId" in args && !("userId" in args)) {
        return await db.query("messageQueryEmbeddings").withIndex("by_message", () => null).first();
      }
      if (args && "userId" in args) {
        return "sk-openrouter";
      }
      return null;
    },
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("leaseOwner" in args) {
        firstLeaseArgs ??= args;
        return await claimMessageQueryEmbeddingLeaseHandler({ db } as any, args as any);
      }
      if ("status" in args) {
        return await completeMessageQueryEmbeddingHandler({ db } as any, args as any);
      }
      return undefined;
    },
    scheduler: { runAfter: async () => undefined },
  } as any;

  await ensureMessageQueryEmbeddingReady(ctx, {
    messageId: "msg_1" as any,
    userId: "user_1",
    chatId: "chat_1" as any,
    queryText: "hello there",
    leaseOwner: "owner_1",
  });

  assert.equal(firstLeaseArgs?.now, 100_000);
  assert.equal(firstLeaseArgs?.leaseExpiresAt, 115_000);
});
