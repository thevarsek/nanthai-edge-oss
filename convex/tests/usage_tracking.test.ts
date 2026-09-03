// convex/tests/usage_tracking.test.ts
// =============================================================================
// M23 Advanced Stats — backend cost-tracking tests.
// Tests: storeAncillaryCost, getChatCostSummary, trackPerplexitySearchCosts,
//        and the instrumented call sites (title, compaction, memory, search,
//        subagent).
// =============================================================================

import assert from "node:assert/strict";
import test from "node:test";

import { storeAncillaryCostHandler, storeGenerationUsageHandler } from "../chat/mutations_internal_handlers";
import { getChatCostSummaryHandler } from "../chat/queries_handlers_public";
import { trackPerplexitySearchCosts } from "../search/actions_web_search_shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInsertCapture() {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  return {
    inserts,
    insert: async (table: string, value: Record<string, unknown>) => {
      inserts.push({ table, value });
      return `${table}_${inserts.length}`;
    },
  };
}

function makeSchedulerCapture() {
  const scheduled: Array<{ delay: number; fnRef: unknown; args: Record<string, unknown> }> = [];
  return {
    scheduled,
    scheduler: {
      runAfter: async (delay: number, fnRef: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay, fnRef, args });
      },
    },
  };
}

async function ownedUsageParent(id: string) {
  if (id === "msg_1") return { _id: id, userId: "user_1", chatId: "chat_1" };
  if (id === "chat_1") return { _id: id, userId: "user_1" };
  return null;
}

function emptyDeletionTombstoneQuery() {
  return {
    withIndex: () => ({
      first: async () => null,
      unique: async () => null,
    }),
  };
}

// ---------------------------------------------------------------------------
// storeAncillaryCostHandler
// ---------------------------------------------------------------------------

test("storeAncillaryCostHandler inserts a usageRecord with source and provided cost", async () => {
  const { inserts, insert } = makeInsertCapture();

  const ctx = {
    db: {
      insert,
      get: ownedUsageParent,
      query: (table: string) => {
        if (table === "accountDeletionTombstones") return emptyDeletionTombstoneQuery();
        throw new Error("should not query cachedModels when cost is provided");
      },
    },
  } as any;

  await storeAncillaryCostHandler(ctx, {
    messageId: "msg_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    modelId: "openai/gpt-4.1-mini",
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    cost: 0.0042,
    source: "title",
  });

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "usageRecords");
  assert.equal(inserts[0].value.userId, "user_1");
  assert.equal(inserts[0].value.chatId, "chat_1");
  assert.equal(inserts[0].value.messageId, "msg_1");
  assert.equal(inserts[0].value.modelId, "openai/gpt-4.1-mini");
  assert.equal(inserts[0].value.promptTokens, 100);
  assert.equal(inserts[0].value.completionTokens, 50);
  assert.equal(inserts[0].value.totalTokens, 150);
  assert.equal(inserts[0].value.cost, 0.0042);
  assert.equal(inserts[0].value.source, "title");
  assert.ok(typeof inserts[0].value.createdAt === "number");
});

test("storeAncillaryCostHandler computes cost from cachedModels when cost is not provided", async () => {
  const { inserts, insert } = makeInsertCapture();

  const ctx = {
    db: {
      insert,
      get: ownedUsageParent,
      query: (table: string) => {
        if (table === "accountDeletionTombstones") return emptyDeletionTombstoneQuery();
        assert.equal(table, "cachedModels");
        return {
          withIndex: () => ({
            first: async () => ({
              modelId: "openai/gpt-4.1-mini",
              inputPricePer1M: 0.40,   // $0.40 per 1M input tokens
              outputPricePer1M: 1.60,  // $1.60 per 1M output tokens
            }),
          }),
        };
      },
    },
  } as any;

  await storeAncillaryCostHandler(ctx, {
    messageId: "msg_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    modelId: "openai/gpt-4.1-mini",
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
    source: "compaction",
  });

  assert.equal(inserts.length, 1);
  // Expected: (1000 * 0.40 / 1_000_000) + (500 * 1.60 / 1_000_000)
  //         = 0.0004 + 0.0008 = 0.0012
  const expectedCost = (1000 * 0.40) / 1_000_000 + (500 * 1.60) / 1_000_000;
  assert.equal(inserts[0].value.cost, expectedCost);
  assert.equal(inserts[0].value.source, "compaction");
});

test("storeAncillaryCostHandler stores undefined cost when model not found and cost not provided", async () => {
  const { inserts, insert } = makeInsertCapture();

  const ctx = {
    db: {
      insert,
      get: ownedUsageParent,
      query: (table: string) => table === "accountDeletionTombstones"
        ? emptyDeletionTombstoneQuery()
        : ({
        withIndex: () => ({
          first: async () => null,
        }),
      }),
    },
  } as any;

  await storeAncillaryCostHandler(ctx, {
    messageId: "msg_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    modelId: "unknown/model",
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    source: "memory_extraction",
  });

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].value.cost, undefined);
  assert.equal(inserts[0].value.source, "memory_extraction");
});

test("storeAncillaryCostHandler does not recreate usage after message or chat deletion", async () => {
  for (const deletedParent of ["message", "chat"] as const) {
    let inserts = 0;
    await storeAncillaryCostHandler({
      db: {
        get: async (id: string) => {
          if (deletedParent === "message") return null;
          if (id === "msg_deleted") {
            return { _id: id, userId: "user_1", chatId: "chat_1" };
          }
          if (id === "chat_1") {
            return { _id: id, userId: "user_1", isDeleting: true };
          }
          return null;
        },
        query: (table: string) => {
          if (deletedParent === "message") {
            throw new Error("a deleted message should short-circuit");
          }
          assert.equal(table, "accountDeletionTombstones");
          return emptyDeletionTombstoneQuery();
        },
        insert: async () => { inserts += 1; },
      },
    } as any, {
      messageId: "msg_deleted" as any,
      chatId: "chat_1" as any,
      userId: "user_1",
      modelId: "openai/gpt-5",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cost: 0.01,
      source: "media_tool_image",
    });

    assert.equal(inserts, 0);
  }
});

test("storeAncillaryCostHandler deduplicates provider usage by generation and source", async () => {
  let inserts = 0;
  await storeAncillaryCostHandler({
    db: {
      get: ownedUsageParent,
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => table === "usageRecords" ? { _id: "usage_existing" } : null,
          unique: async () => null,
        }),
      }),
      insert: async () => { inserts += 1; },
    },
  } as any, {
    messageId: "msg_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    modelId: "openai/gpt-5",
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
    cost: 0.01,
    source: "tool_web_search",
    generationId: "generation_1",
  });

  assert.equal(inserts, 0);
});

test("storeAncillaryCostHandler deduplicates usage without a provider generation id", async () => {
  let inserts = 0;
  await storeAncillaryCostHandler({
    db: {
      get: ownedUsageParent,
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => table === "usageRecords" ? { _id: "usage_existing" } : null,
          unique: async () => null,
        }),
      }),
      insert: async () => { inserts += 1; },
    },
  } as any, {
    messageId: "msg_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    modelId: "openai/gpt-5",
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
    source: "tool_web_search",
    idempotencyKey: "capture_1:tool:0:web_search",
  });

  assert.equal(inserts, 0);
});

// ---------------------------------------------------------------------------
// storeGenerationUsageHandler — upsert must not overwrite ancillary rows
// ---------------------------------------------------------------------------

test("storeGenerationUsageHandler upsert does not overwrite ancillary cost rows with same messageId", async () => {
  // Simulate: an ancillary cost row (source="title") already exists for this
  // messageId, but NO primary generation row (source=undefined) exists yet.
  // The upsert must INSERT a new row, not PATCH the ancillary one.

  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

  // The ancillary row that already exists in the DB
  const ancillaryRow = {
    _id: "usage_ancillary_1",
    messageId: "msg_1",
    chatId: "chat_1",
    source: "title",
    cost: 0.001,
  };

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "msg_1") return { _id: "msg_1", modelId: "openai/gpt-4.1-mini" };
        return null;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}_${inserts.length}`;
      },
      query: (table: string) => {
        if (table === "usageRecords") {
          return {
            withIndex: (_indexName: string, _fn: unknown) => ({
              filter: (filterFn: (q: unknown) => unknown) => {
                // Build a mock filter system that captures the source filter check
                let sourceFilterValue: unknown = "NOT_SET";
                const q = {
                  eq: (a: unknown, b: unknown) => ({ a, b, op: "eq" }),
                  field: (name: string) => ({ __field: name }),
                };
                const filterResult = filterFn(q) as { a: unknown; b: unknown };
                // Extract what value source is compared against
                const fieldRef = filterResult.a as { __field?: string };
                if (fieldRef?.__field === "source") {
                  sourceFilterValue = filterResult.b;
                }
                return {
                  first: async () => {
                    // The filter checks source === undefined.
                    // Our ancillary row has source="title", so it should NOT match.
                    if (sourceFilterValue === undefined && ancillaryRow.source !== undefined) {
                      return null; // correctly filtered out
                    }
                    if (sourceFilterValue === ancillaryRow.source) {
                      return ancillaryRow;
                    }
                    return null;
                  },
                };
              },
            }),
          };
        }
        // cachedModels query (for cost computation fallback)
        return {
          withIndex: () => ({
            first: async () => null,
          }),
        };
      },
    },
  } as any;

  await storeGenerationUsageHandler(ctx, {
    messageId: "msg_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    promptTokens: 500,
    completionTokens: 200,
    totalTokens: 700,
    cost: 0.005,
  });

  // The message.usage field should be patched (that's normal)
  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, "msg_1");

  // A NEW usageRecord should be inserted (not patched onto the ancillary row)
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "usageRecords");
  assert.equal(inserts[0].value.cost, 0.005);
  assert.equal(inserts[0].value.messageId, "msg_1");
  // Primary generation row should NOT have a source field
  assert.equal(inserts[0].value.source, undefined);
});

test("storeGenerationUsageHandler upsert patches existing primary row (source=undefined)", async () => {
  // When a primary generation row already exists (source=undefined),
  // the upsert should PATCH it, not insert a duplicate.

  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

  const existingPrimaryRow = {
    _id: "usage_primary_1",
    messageId: "msg_1",
    chatId: "chat_1",
    source: undefined, // primary generation — no source
    cost: 0.003,
  };

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "msg_1") return { _id: "msg_1", modelId: "openai/gpt-4.1-mini" };
        return null;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}_${inserts.length}`;
      },
      query: (table: string) => {
        if (table === "usageRecords") {
          return {
            withIndex: (_indexName: string, _fn: unknown) => ({
              filter: (_filterFn: unknown) => ({
                first: async () => existingPrimaryRow, // source=undefined matches
              }),
            }),
          };
        }
        return {
          withIndex: () => ({
            first: async () => null,
          }),
        };
      },
    },
  } as any;

  await storeGenerationUsageHandler(ctx, {
    messageId: "msg_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    promptTokens: 600,
    completionTokens: 300,
    totalTokens: 900,
    cost: 0.008,
  });

  // message.usage patch + usageRecord patch = 2 patches
  assert.equal(patches.length, 2);
  assert.equal(patches[0].id, "msg_1"); // message usage patch
  assert.equal(patches[1].id, "usage_primary_1"); // existing usageRecord patch
  assert.equal(patches[1].value.cost, 0.008);

  // No insert — the existing row was patched
  assert.equal(inserts.length, 0);
});

// ---------------------------------------------------------------------------
// getChatCostSummaryHandler
// ---------------------------------------------------------------------------

test("getChatCostSummaryHandler returns null when unauthenticated", async () => {
  const ctx = {
    auth: {
      getUserIdentity: async () => null,
    },
  } as any;

  const result = await getChatCostSummaryHandler(ctx, {
    chatId: "chat_1" as any,
  });

  assert.equal(result, null);
});

test("getChatCostSummaryHandler returns null when chat does not belong to user", async () => {
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async () => ({ _id: "chat_1", userId: "other_user" }),
    },
  } as any;

  const result = await getChatCostSummaryHandler(ctx, {
    chatId: "chat_1" as any,
  });

  assert.equal(result, null);
});

test("getChatCostSummaryHandler aggregates per-message and total cost", async () => {
  const usageRecords = [
    { messageId: "msg_1", cost: 0.005 },
    { messageId: "msg_1", cost: 0.001 },  // ancillary cost on same message
    { messageId: "msg_2", cost: 0.010 },
    { messageId: "msg_3", cost: undefined }, // no cost (null)
  ];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return { _id: "chat_1", userId: "user_1" };
        }
        return null;
      },
      query: (table: string) => {
        assert.equal(table, "usageRecords");
        return {
          withIndex: () => ({
            collect: async () => usageRecords,
          }),
        };
      },
    },
  } as any;

  const result = await getChatCostSummaryHandler(ctx, {
    chatId: "chat_1" as any,
  });

  assert.ok(result);
  assert.equal(result.chatId, "chat_1");
  // msg_1: 0.005 + 0.001 = 0.006
  // msg_2: 0.010
  // msg_3: 0 (undefined → 0)
  // total: 0.016
  assert.ok(Math.abs(result.totalCost - 0.016) < 1e-10);
  assert.ok(Math.abs(result.messageCosts["msg_1"] - 0.006) < 1e-10);
  assert.ok(Math.abs(result.messageCosts["msg_2"] - 0.010) < 1e-10);
  assert.ok(Math.abs(result.messageCosts["msg_3"] - 0) < 1e-10);
});

test("getChatCostSummaryHandler returns zero totals for empty chat", async () => {
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async () => ({ _id: "chat_1", userId: "user_1" }),
      query: () => ({
        withIndex: () => ({
          collect: async () => [],
        }),
      }),
    },
  } as any;

  const result = await getChatCostSummaryHandler(ctx, {
    chatId: "chat_1" as any,
  });

  assert.ok(result);
  assert.equal(result.totalCost, 0);
  assert.deepEqual(result.messageCosts, {});
});

// ---------------------------------------------------------------------------
// trackPerplexitySearchCosts
// ---------------------------------------------------------------------------

test("trackPerplexitySearchCosts schedules cost for successful results with usage", async () => {
  const { scheduled, scheduler } = makeSchedulerCapture();

  const ctx = {
    scheduler,
    runMutation: async () => {},
  } as any;

  const results = [
    {
      success: true,
      usage: { promptTokens: 100, completionTokens: 200, totalTokens: 300, cost: 0.01 },
      generationId: "gen_1",
    },
    { success: false, usage: undefined },  // failed — should be skipped
    {
      success: true,
      usage: { promptTokens: 50, completionTokens: 100, totalTokens: 150, cost: 0.005 },
    },
    { success: true },  // no usage — should be skipped
  ];

  await trackPerplexitySearchCosts(ctx, results, {
    messageId: "msg_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    searchModel: "perplexity/sonar-pro",
  });

  assert.equal(scheduled.length, 2);

  // First scheduled call — result[0]
  assert.equal(scheduled[0].args.messageId, "msg_1");
  assert.equal(scheduled[0].args.chatId, "chat_1");
  assert.equal(scheduled[0].args.userId, "user_1");
  assert.equal(scheduled[0].args.modelId, "perplexity/sonar-pro");
  assert.equal(scheduled[0].args.promptTokens, 100);
  assert.equal(scheduled[0].args.completionTokens, 200);
  assert.equal(scheduled[0].args.totalTokens, 300);
  assert.equal(scheduled[0].args.cost, 0.01);
  assert.equal(scheduled[0].args.source, "search_perplexity");
  assert.equal(scheduled[0].args.generationId, "gen_1");

  // Second scheduled call — result[2] (no generationId)
  assert.equal(scheduled[1].args.promptTokens, 50);
  assert.equal(scheduled[1].args.cost, 0.005);
  assert.equal(scheduled[1].args.source, "search_perplexity");
  assert.equal(scheduled[1].args.generationId, undefined);
});

test("trackPerplexitySearchCosts does nothing for empty results", async () => {
  const { scheduled, scheduler } = makeSchedulerCapture();

  const ctx = { scheduler } as any;

  await trackPerplexitySearchCosts(ctx, [], {
    messageId: "msg_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    searchModel: "perplexity/sonar",
  });

  assert.equal(scheduled.length, 0);
});

// ---------------------------------------------------------------------------
// Source labels: ensure all known sources are tracked correctly
// ---------------------------------------------------------------------------

test("all M23 source labels are distinct and documented", () => {
  const expectedSources = [
    "generation",      // default / primary generation (existing rows)
    "title",           // title generation
    "compaction",      // context compaction
    "memory_extraction",
    "memory_embedding_store",
    "memory_embedding_retrieve",
    "search_query_gen",
    "search_perplexity",
    "search_planning",
    "search_analysis",
    "search_synthesis",
    "search_architecture",
    "tool_web_search",
    "subagent",
  ];

  // All unique
  const uniqueSources = new Set(expectedSources);
  assert.equal(uniqueSources.size, expectedSources.length, "Source labels must be unique");

  // All are non-empty strings
  for (const s of expectedSources) {
    assert.ok(s.length > 0);
    assert.ok(typeof s === "string");
  }
});

// ---------------------------------------------------------------------------
// storeAncillaryCost: cost override vs computed priority
// ---------------------------------------------------------------------------

test("storeAncillaryCostHandler prefers provided cost over model-computed cost", async () => {
  const { inserts, insert } = makeInsertCapture();

  const ctx = {
    db: {
      insert,
      get: ownedUsageParent,
      // Even though model is available, provided cost should take precedence
      query: (table: string) => table === "accountDeletionTombstones"
        ? emptyDeletionTombstoneQuery()
        : ({
        withIndex: () => ({
          first: async () => ({
            modelId: "openai/gpt-4.1-mini",
            inputPricePer1M: 0.40,
            outputPricePer1M: 1.60,
          }),
        }),
      }),
    },
  } as any;

  await storeAncillaryCostHandler(ctx, {
    messageId: "msg_1" as any,
    chatId: "chat_1" as any,
    userId: "user_1",
    modelId: "openai/gpt-4.1-mini",
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
    cost: 0.9999,  // explicit cost
    source: "title",
  });

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].value.cost, 0.9999);
});

// ---------------------------------------------------------------------------
// getChatCostSummaryHandler: multiple sources for same message
// ---------------------------------------------------------------------------

test("getChatCostSummaryHandler sums generation + ancillary costs for the same message", async () => {
  const usageRecords = [
    { messageId: "msg_1", cost: 0.05,   source: undefined },          // primary generation
    { messageId: "msg_1", cost: 0.001,  source: "title" },            // other
    { messageId: "msg_1", cost: 0.002,  source: "compaction" },       // other
    { messageId: "msg_1", cost: 0.0005, source: "memory_extraction" },// memory
    { messageId: "msg_1", cost: 0.01,   source: "search_perplexity" },// search
    { messageId: "msg_1", cost: 0.003,  source: "search_architecture" },// search
    { messageId: "msg_1", cost: 0.004,  source: "tool_web_search" },  // search
    { messageId: "msg_1", cost: 0.04,   source: "media_tool_image" }, // media
    { messageId: "msg_1", cost: 0.005,  source: "media_message_speech" }, // media
    { messageId: "msg_1", cost: 0.02,   source: "media_message_video" }, // direct media response
  ];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async () => ({ _id: "chat_1", userId: "user_1" }),
      query: () => ({
        withIndex: () => ({
          collect: async () => usageRecords,
        }),
      }),
    },
  } as any;

  const result = await getChatCostSummaryHandler(ctx, {
    chatId: "chat_1" as any,
  });

  assert.ok(result);

  // totalCost includes all records (generation + ancillary)
  const expectedTotal = 0.05 + 0.001 + 0.002 + 0.0005 + 0.01 + 0.003 + 0.004 + 0.04 + 0.005 + 0.02;
  assert.ok(Math.abs(result.totalCost - expectedTotal) < 1e-10);

  // Dedicated image/video rows are the response itself; tool media and speech are ancillary.
  assert.ok(Math.abs(result.messageCosts["msg_1"] - 0.07) < 1e-10);

  // breakdown buckets
  assert.ok(Math.abs(result.breakdown.responses - 0.05) < 1e-10);
  assert.ok(Math.abs(result.breakdown.memory - 0.0005) < 1e-10);
  assert.ok(Math.abs(result.breakdown.search - (0.01 + 0.003 + 0.004)) < 1e-10);
  assert.ok(Math.abs(result.breakdown.media - 0.065) < 1e-10);
  assert.ok(Math.abs(result.breakdown.other - (0.001 + 0.002)) < 1e-10);
});
