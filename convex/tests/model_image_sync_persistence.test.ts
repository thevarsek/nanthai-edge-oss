import assert from "node:assert/strict";
import test from "node:test";
import {
  pruneStaleImageModels,
  upsertImageModelsBatch,
} from "../models/image_sync";
import { prepareImageModel } from "../models/image_sync_contract";
import {
  gptImageEndpoints,
  gptImageModel,
} from "./support/model_image_sync_fixtures.test";

type TestFunction = {
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

test("image upsert creates exclusive rows and preserves main-owned chat fields", async () => {
  const prepared = prepareImageModel(gptImageModel, gptImageEndpoints);
  const records = [{
    _id: "existing_1",
    modelId: "google/gemini-image",
    name: "Main catalog name",
    supportsTools: true,
    supportedParameters: ["tools"],
    architecture: { tokenizer: "Gemini", modality: "text->text+image" },
  }];
  const inserts: Array<Record<string, unknown>> = [];
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      query: () => ({
        withIndex: (_name: string, apply: (query: {
          eq: (_field: string, value: string) => unknown;
        }) => unknown) => {
          let modelId = "";
          apply({
            eq: (_field, value) => {
              modelId = value;
              return undefined;
            },
          });
          return {
            first: async () => records.find((record) =>
              record.modelId === modelId
            ) ?? null,
          };
        },
      }),
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
      },
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  };
  const multimodal = {
    ...prepared,
    modelId: "google/gemini-image",
    name: "Image API name",
    imageOnly: false,
    architecture: { modality: "text+image->text+image" },
  };

  const result = await (upsertImageModelsBatch as unknown as TestFunction)
    ._handler(ctx, { models: [prepared, multimodal] }) as {
      upserted: number;
      created: number;
    };

  assert.deepEqual(result, { upserted: 2, created: 1 });
  assert.equal(inserts[0]?.modelId, "openai/gpt-image-2");
  assert.equal(
    (inserts[0]?.imageCapabilities as Record<string, unknown>)
      .managedByImageSync,
    true,
  );
  assert.equal(patches[0]?.name, undefined);
  assert.equal(patches[0]?.supportedParameters, undefined);
  assert.equal(patches[0]?.supportsTools, undefined);
  assert.equal(patches[0]?.supportsImages, true);
});

test("image-only upsert reclaims legacy rows for image sync ownership", async () => {
  const prepared = prepareImageModel(gptImageModel, gptImageEndpoints);
  const legacy = {
    _id: "legacy_image_1",
    modelId: prepared.modelId,
    name: "Legacy catalog name",
    imageCapabilities: { managedByImageSync: false },
    architecture: { modality: "text->image" },
  };
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      query: () => ({
        withIndex: (_name: string, apply: (query: {
          eq: (_field: string, value: string) => unknown;
        }) => unknown) => {
          apply({ eq: () => undefined });
          return { first: async () => legacy };
        },
      }),
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  };

  await (upsertImageModelsBatch as unknown as TestFunction)._handler(ctx, {
    models: [prepared],
  });

  const capabilities = patches[0]?.imageCapabilities as Record<string, unknown>;
  assert.equal(capabilities.managedByImageSync, true);
  assert.equal(patches[0]?.name, "OpenAI: GPT Image 2");
});

test("image prune deletes only stale image-owned image-only rows", async () => {
  const deleted: string[] = [];
  const patched: string[] = [];
  const records = [
    {
      _id: "active_owned",
      modelId: "openai/gpt-image-2",
      architecture: { modality: "text+image->image" },
      imageCapabilities: { managedByImageSync: true },
    },
    {
      _id: "stale_owned",
      modelId: "sourceful/riverflow-v2-max-preview",
      architecture: { modality: "text->image" },
      imageCapabilities: { managedByImageSync: true },
    },
    {
      _id: "stale_shared",
      modelId: "google/gemini-2.5-flash-image-preview",
      architecture: { modality: "text+image->text+image" },
      imageCapabilities: { managedByImageSync: false },
    },
    {
      _id: "stale_main_owned",
      modelId: "sourceful/riverflow-v2-standard-preview",
      architecture: { modality: "text->image" },
      imageCapabilities: { managedByImageSync: false },
    },
  ];
  const ctx = {
    db: {
      query: () => ({ collect: async () => records }),
      delete: async (id: string) => deleted.push(id),
      patch: async (id: string) => patched.push(id),
    },
  };

  const result = await (pruneStaleImageModels as unknown as TestFunction)
    ._handler(ctx, {
      activeModelIds: ["openai/gpt-image-2"],
      unavailableModelIds: [],
    });

  assert.deepEqual(result, { deleted: 2, deactivated: 1 });
  assert.deepEqual(deleted, ["stale_owned", "stale_main_owned"]);
  assert.deepEqual(patched, ["stale_shared"]);
});

test("image prune deactivates a main-catalog hybrid with authoritative zero endpoints", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const records = [{
    _id: "main_hybrid",
    modelId: "openrouter/auto",
    supportsImages: true,
    architecture: { modality: "text+image->text+image" },
  }];
  const ctx = {
    db: {
      query: () => ({ collect: async () => records }),
      delete: async () => assert.fail("hybrid row should be deactivated"),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  };

  const result = await (pruneStaleImageModels as unknown as TestFunction)
    ._handler(ctx, {
      activeModelIds: [],
      unavailableModelIds: ["openrouter/auto"],
    });

  assert.deepEqual(result, { deleted: 0, deactivated: 1 });
  assert.equal(patches[0]?.id, "main_hybrid");
  assert.equal(patches[0]?.value.supportsImages, false);
  assert.equal(
    (patches[0]?.value.imageCapabilities as Record<string, unknown>).isAvailable,
    false,
  );
  assert.equal(
    (patches[0]?.value.architecture as Record<string, unknown>).modality,
    "text+image->text",
  );
});

test("image price summary uses the highest resolution variant", () => {
  const model = prepareImageModel({
    ...gptImageModel,
    id: "example/variant-priced-image",
  }, {
    endpoints: [{
      provider_slug: "example",
      pricing: [
        { billable: "output_image", unit: "image", cost_usd: 0.13 },
        { billable: "output_image", unit: "image", cost_usd: 0.15, variant: "2k" },
        { billable: "output_image", unit: "image", cost_usd: 0.17, variant: "4k" },
      ],
    }],
  });

  assert.equal(model.imageCapabilities.pricePerImage, 0.17);
  assert.deepEqual(
    model.imageCapabilities.pricing.map((line) => line.costUsd),
    [0.13, 0.15, 0.17],
  );
});
