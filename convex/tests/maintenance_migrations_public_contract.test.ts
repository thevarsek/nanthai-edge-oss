import assert from "node:assert/strict";
import test from "node:test";

import { syncBenchmarks } from "../models/artificial_analysis_sync";
import { migrateXaiModelReferences } from "../models/migrations";
import { deleteStaleToken } from "../push/mutations_internal";
import {
  backfillEmbeddingUserIds,
  repairInvalidMessagePersonas,
} from "../search/migrations";

test("migrateXaiModelReferences rewrites x-ai references and removes duplicates", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deleted: string[] = [];

  const tables: Record<string, Array<Record<string, any>>> = {
    userPreferences: [
      { _id: "prefs_1", defaultModelId: "x-ai/grok-2", memoryExtractionModelId: "openai/gpt-4.1-mini", titleModelId: "x-ai/grok-2" },
    ],
    modelSettings: [
      { _id: "setting_1", userId: "user_a", openRouterId: "x-ai/grok-2" },
      { _id: "setting_2", userId: "user_a", openRouterId: "openai/gpt-4.1-mini" },
      { _id: "setting_3", userId: "user_b", openRouterId: "x-ai/grok-2" },
    ],
    favorites: [
      { _id: "fav_1", modelIds: ["x-ai/grok-2", "anthropic/claude", "x-ai/grok-2"] },
    ],
    personas: [{ _id: "persona_1", modelId: "x-ai/grok-2" }],
    scheduledJobs: [
      {
        _id: "job_1",
        modelId: "x-ai/grok-2",
        steps: [{ prompt: "step", modelId: "x-ai/grok-2" }],
      },
    ],
    chatParticipants: [{ _id: "participant_1", modelId: "x-ai/grok-2" }],
    messages: [{ _id: "message_1", modelId: "x-ai/grok-2" }],
    generationJobs: [{ _id: "generation_1", modelId: "x-ai/grok-2" }],
    usageRecords: [{ _id: "usage_1", modelId: "x-ai/grok-2" }],
    cachedModels: [
      { _id: "cached_1", provider: "x-ai" },
      { _id: "cached_2", provider: "x-ai" },
    ],
  };

  const result = await (migrateXaiModelReferences as any)._handler(
    {
      db: {
        query: (table: string) => ({
          collect: async () => tables[table] ?? [],
          withIndex: () => ({
            collect: async () => (table === "cachedModels" ? tables.cachedModels : []),
          }),
        }),
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        },
        delete: async (id: string) => {
          deleted.push(id);
        },
      },
    } as any,
    {},
  );

  assert.deepEqual(result, {
    userPreferences: 1,
    modelSettingsPatched: 1,
    modelSettingsDeleted: 1,
    favorites: 1,
    personas: 1,
    scheduledJobs: 1,
    chatParticipants: 1,
    messages: 1,
    generationJobs: 1,
    usageRecords: 1,
    cachedModelsDeleted: 2,
  });
  assert.equal(
    patches.find((entry) => entry.id === "prefs_1")?.patch.defaultModelId,
    "openai/gpt-4.1-mini",
  );
  assert.equal(
    patches.find((entry) => entry.id === "job_1")?.patch.modelId,
    "openai/gpt-4.1-mini",
  );
  assert.ok(deleted.includes("setting_1"));
  assert.ok(deleted.includes("cached_2"));
});

test("syncBenchmarks fetches AA snapshots and applies prepared benchmark patches", async () => {
  const originalApiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  const originalFetch = globalThis.fetch;
  const mutations: Array<{ fn: unknown; args: Record<string, unknown> }> = [];

  process.env.ARTIFICIAL_ANALYSIS_API_KEY = "aa_key";
  globalThis.fetch = (async (url: string) => {
    if (url.includes("/llms/models")) {
      return {
        ok: true,
        json: async () => [{
          id: "aa_llm_1",
          slug: "gpt-4.1-mini",
          name: "GPT-4.1 Mini",
          model_creator: { slug: "openai", name: "OpenAI" },
          evaluations: { artificial_analysis_intelligence_index: 58 },
        }],
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({ data: [] }),
    } as Response;
  }) as typeof fetch;

  try {
    await (syncBenchmarks as any)._handler(
      {
        runQuery: async () => [{
          _id: "model_1",
          modelId: "openai/gpt-4.1-mini",
          name: "GPT-4.1 Mini",
          canonicalSlug: "gpt-4.1-mini",
          provider: "openai",
          inputPricePer1M: 0.4,
          outputPricePer1M: 1.6,
          contextLength: 128000,
        }],
        runMutation: async (fn: unknown, args: Record<string, unknown>) => {
          mutations.push({ fn, args });
        },
      } as any,
      {},
    );
  } finally {
    process.env.ARTIFICIAL_ANALYSIS_API_KEY = originalApiKey;
    globalThis.fetch = originalFetch;
  }

  assert.equal(mutations.length, 1);
  assert.equal(mutations[0]?.args.totalModels, 1);
  assert.equal(mutations[0]?.args.matchedCount, 1);
  assert.equal((mutations[0]?.args.patches as Array<any>).length, 1);
  assert.equal((mutations[0]?.args.patches as Array<any>)[0]?.docId, "model_1");
});

test("deleteStaleToken removes an existing device token", async () => {
  const deleted: string[] = [];

  await (deleteStaleToken as any)._handler(
    {
      db: {
        get: async () => ({ _id: "token_1", token: "abcdefgh123" }),
        delete: async (id: string) => {
          deleted.push(id);
        },
      },
    } as any,
    { tokenId: "token_1" },
  );

  assert.deepEqual(deleted, ["token_1"]);
});

test("repairInvalidMessagePersonas backfills autonomousParticipantId for legacy rows", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const result = await (repairInvalidMessagePersonas as any)._handler(
    {
      db: {
        query: (table: string) => ({
          paginate: async () => ({
            page: table === "messages"
              ? [
                  { _id: "msg_valid", participantId: "persona_1" },
                  { _id: "msg_legacy", participantId: "participant_7" },
                  { _id: "msg_none", participantId: undefined },
                ]
              : [],
            isDone: false,
            continueCursor: "cursor_2",
          }),
        }),
        get: async (id: string) =>
          id === "persona_1"
            ? { _id: "persona_1", userId: "user_1", systemPrompt: "You are helpful." }
            : null,
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        },
      },
    } as any,
    { table: "messages" },
  );

  assert.deepEqual(result, {
    repairedCount: 1,
    scannedCount: 3,
    isComplete: false,
    nextCursor: "cursor_2",
  });
  assert.deepEqual(patches, [{
    id: "msg_legacy",
    patch: { participantId: undefined, autonomousParticipantId: "participant_7" },
  }]);
});

test("backfillEmbeddingUserIds patches missing owners and skips orphans", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const result = await (backfillEmbeddingUserIds as any)._handler(
    {
      db: {
        query: () => ({
          paginate: async () => ({
            page: [
              { _id: "emb_existing", memoryId: "memory_1", userId: "user_1" },
              { _id: "emb_patch", memoryId: "memory_2" },
              { _id: "emb_orphan", memoryId: "memory_3" },
            ],
            isDone: true,
            continueCursor: null,
          }),
        }),
        get: async (id: string) =>
          id === "memory_2" ? { _id: "memory_2", userId: "user_2" } : null,
        patch: async (id: string, patch: Record<string, unknown>) => {
          patches.push({ id, patch });
        },
      },
    } as any,
    {},
  );

  assert.deepEqual(result, {
    patchedCount: 1,
    skippedCount: 2,
    scannedCount: 3,
    isComplete: true,
    nextCursor: undefined,
  });
  assert.deepEqual(patches, [{ id: "emb_patch", patch: { userId: "user_2" } }]);
});
