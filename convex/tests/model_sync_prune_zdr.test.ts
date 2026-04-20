import assert from "node:assert/strict";
import test from "node:test";

import { pruneStaleModels, upsertBatch } from "../models/sync";

// -- Helpers ------------------------------------------------------------------

type FakeDoc = {
  _id: string;
  modelId: string;
  videoCapabilities?: Record<string, unknown>;
  [key: string]: unknown;
};

function buildPruneCtx(models: FakeDoc[]) {
  let docs = [...models];
  const deleted: string[] = [];
  const ctx = {
    db: {
      query: (table: string) => {
        assert.equal(table, "cachedModels");
        return {
          collect: async () => docs,
        };
      },
      delete: async (id: string) => {
        deleted.push(id);
        docs = docs.filter((d) => d._id !== id);
      },
    },
  } as any;
  return { ctx, deleted, remaining: () => docs };
}

function buildUpsertCtx(models: FakeDoc[]) {
  let docs = [...models];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      query: (table: string) => {
        assert.equal(table, "cachedModels");
        return {
          withIndex: (_index: string, apply: (query: any) => any) => {
            let selectedModelId = "";
            apply({
              eq: (_field: string, modelId: string) => {
                selectedModelId = modelId;
                return {};
              },
            });
            return {
              first: async () =>
                docs.find((d) => d.modelId === selectedModelId) ?? null,
            };
          },
        };
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      insert: async (_table: string, doc: Record<string, unknown>) => {
        inserts.push(doc);
      },
    },
  } as any;
  return { ctx, patches, inserts };
}

// -- pruneStaleModels ---------------------------------------------------------

test("pruneStaleModels deletes models not in active set", async () => {
  const { ctx, deleted } = buildPruneCtx([
    { _id: "m1", modelId: "openai/gpt-4o" },
    { _id: "m2", modelId: "anthropic/claude-3.5-sonnet" },
    { _id: "m3", modelId: "mistralai/mistral-small-3.1-24b-instruct:free" },
  ]);

  await (pruneStaleModels as any)._handler(ctx, {
    activeModelIds: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"],
  });

  assert.deepEqual(deleted, ["m3"]);
});

test("pruneStaleModels preserves video-only models with videoCapabilities", async () => {
  const { ctx, deleted } = buildPruneCtx([
    { _id: "m1", modelId: "openai/gpt-4o" },
    {
      _id: "m2",
      modelId: "openai/sora",
      videoCapabilities: { supportedResolutions: ["720p"] },
    },
    { _id: "m3", modelId: "stale/removed-model" },
  ]);

  // Only openai/gpt-4o is in the active set. openai/sora is NOT in the
  // active set but has videoCapabilities → must be preserved.
  await (pruneStaleModels as any)._handler(ctx, {
    activeModelIds: ["openai/gpt-4o"],
  });

  assert.deepEqual(deleted, ["m3"]);
});

test("pruneStaleModels is a no-op when all models are active", async () => {
  const { ctx, deleted } = buildPruneCtx([
    { _id: "m1", modelId: "openai/gpt-4o" },
    { _id: "m2", modelId: "anthropic/claude-3.5-sonnet" },
  ]);

  await (pruneStaleModels as any)._handler(ctx, {
    activeModelIds: ["openai/gpt-4o", "anthropic/claude-3.5-sonnet"],
  });

  assert.deepEqual(deleted, []);
});

test("pruneStaleModels deletes all non-video models when active set is empty", async () => {
  const { ctx, deleted } = buildPruneCtx([
    { _id: "m1", modelId: "openai/gpt-4o" },
    { _id: "m2", modelId: "anthropic/claude-3.5-sonnet" },
    {
      _id: "m3",
      modelId: "google/veo-2",
      videoCapabilities: { supportedResolutions: ["1080p"] },
    },
  ]);

  await (pruneStaleModels as any)._handler(ctx, {
    activeModelIds: [],
  });

  // Both text models deleted, video model preserved
  assert.deepEqual(deleted.sort(), ["m1", "m2"]);
});

// -- upsertBatch: hasZdrEndpoint ----------------------------------------------

test("upsertBatch sets hasZdrEndpoint on new models", async () => {
  const { ctx, inserts } = buildUpsertCtx([]);

  await (upsertBatch as any)._handler(ctx, {
    models: [
      {
        modelId: "openai/gpt-4o",
        name: "GPT-4o",
        hasZdrEndpoint: true,
      },
      {
        modelId: "mistralai/mistral-large",
        name: "Mistral Large",
        hasZdrEndpoint: false,
      },
    ],
  });

  assert.equal(inserts.length, 2);
  assert.equal(inserts[0].hasZdrEndpoint, true);
  assert.equal(inserts[1].hasZdrEndpoint, false);
});

test("upsertBatch patches hasZdrEndpoint when it changes on existing model", async () => {
  const { ctx, patches } = buildUpsertCtx([
    {
      _id: "m1",
      modelId: "openai/gpt-4o",
      name: "GPT-4o",
      hasZdrEndpoint: false,
    },
  ]);

  await (upsertBatch as any)._handler(ctx, {
    models: [
      {
        modelId: "openai/gpt-4o",
        name: "GPT-4o",
        hasZdrEndpoint: true,
      },
    ],
  });

  assert.equal(patches.length, 1);
  assert.equal(patches[0].value.hasZdrEndpoint, true);
});

test("upsertBatch skips patch when hasZdrEndpoint is unchanged", async () => {
  const { ctx, patches } = buildUpsertCtx([
    {
      _id: "m1",
      modelId: "openai/gpt-4o",
      name: "GPT-4o",
      provider: "openai",
      hasZdrEndpoint: true,
      supportsImages: false,
      supportsVideo: false,
      supportsTools: true,
      contextLength: 128000,
      maxCompletionTokens: 16384,
      inputPricePer1M: 2.5,
      outputPricePer1M: 10,
      supportedParameters: ["tools", "temperature"],
      architecture: { modality: "text+image->text" },
    },
  ]);

  await (upsertBatch as any)._handler(ctx, {
    models: [
      {
        modelId: "openai/gpt-4o",
        name: "GPT-4o",
        provider: "openai",
        hasZdrEndpoint: true,
        supportsImages: false,
        supportsVideo: false,
        supportsTools: true,
        contextLength: 128000,
        maxCompletionTokens: 16384,
        inputPricePer1M: 2.5,
        outputPricePer1M: 10,
        supportedParameters: ["tools", "temperature"],
        architecture: { modality: "text+image->text" },
      },
    ],
  });

  assert.equal(patches.length, 0, "should not patch when nothing changed");
});
