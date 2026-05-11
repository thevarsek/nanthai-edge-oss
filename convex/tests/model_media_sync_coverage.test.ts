import assert from "node:assert/strict";
import test from "node:test";

import { syncImageModels, upsertImageModelsBatch } from "../models/image_sync";
import { syncVideoModels, upsertVideoModelsBatch } from "../models/video_sync";

type ModelDoc = {
  _id: string;
  modelId: string;
  name: string;
  architecture?: Record<string, unknown>;
};

function buildModelCtx(existingModels: ModelDoc[]) {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      query: (table: string) => {
        assert.equal(table, "cachedModels");
        return {
          withIndex: (_index: string, apply: (query: any) => unknown) => {
            let selectedModelId = "";
            apply({
              eq: (_field: string, modelId: string) => {
                selectedModelId = modelId;
                return {};
              },
            });
            return {
              first: async () =>
                existingModels.find((model) => model.modelId === selectedModelId) ?? null,
            };
          },
        };
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `inserted_${inserts.length}`;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  };

  return { ctx, inserts, patches };
}

test("upsertImageModelsBatch creates image-only rows and patches multimodal pricing hints", async () => {
  const { ctx, inserts, patches } = buildModelCtx([
    { _id: "model_existing", modelId: "google/gemini-image", name: "Gemini Image" },
  ]);

  const result = await (upsertImageModelsBatch as any)._handler(ctx, {
    models: [
      {
        modelId: "black-forest-labs/flux-kontext",
        imageOnly: true,
        name: "FLUX Kontext",
        provider: "black-forest-labs",
        supportedParameters: ["prompt"],
        architecture: { modality: "text+image->image" },
        pricePerImage: 0.04,
        pricingSkus: { imageToken: "0.000001", imageOutput: "0.02" },
      },
      {
        modelId: "google/gemini-image",
        imageOnly: false,
        name: "Gemini Image",
        provider: "google",
        supportedParameters: ["tools"],
        pricePerImage: 0.03,
      },
      {
        modelId: "openai/gpt-image-missing-main-sync-row",
        imageOnly: false,
        name: "GPT Image",
        provider: "openai",
        supportedParameters: [],
      },
    ],
  });

  assert.deepEqual(result, { createdOrPatched: 1, pricingOnly: 1, skipped: 1 });
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]?.table, "cachedModels");
  assert.equal(inserts[0]?.value.supportsImages, true);
  assert.equal((inserts[0]?.value.imageCapabilities as any).managedByImageSync, true);
  assert.deepEqual(patches, [
    {
      id: "model_existing",
      value: {
        imageCapabilities: {
          pricePerImage: 0.03,
          pricingSkus: undefined,
          managedByImageSync: false,
          syncedAt: (patches[0]?.value.imageCapabilities as any).syncedAt,
        },
      },
    },
  ]);
});

test("upsertVideoModelsBatch patches existing rows and creates video-only rows", async () => {
  const { ctx, inserts, patches } = buildModelCtx([
    {
      _id: "model_existing",
      modelId: "openai/sora-2",
      name: "Sora 2",
      architecture: { tokenizer: "o200k_base" },
    },
  ]);

  const textToVideoCapabilities = {
    supportedResolutions: ["720p"],
    supportedAspectRatios: ["16:9"],
    supportedDurations: [5.0],
    supportedFrameImages: [],
    supportedSizes: ["1280x720"],
    generateAudio: true,
    seed: false,
    pricingSkus: { videoTokens: "0.01" },
    pricingSkusMap: { duration_seconds: "0.01" },
    allowedPassthroughParameters: ["quality"],
    syncedAt: 123.0,
  };
  const imageToVideoCapabilities = {
    ...textToVideoCapabilities,
    supportedFrameImages: ["first_frame"],
  };

  const result = await (upsertVideoModelsBatch as any)._handler(ctx, {
    models: [
      {
        modelId: "openai/sora-2",
        name: "Sora 2",
        provider: "openai",
        videoCapabilities: textToVideoCapabilities,
      },
      {
        modelId: "google/veo-image",
        name: "Veo Image",
        provider: "google",
        videoCapabilities: imageToVideoCapabilities,
      },
    ],
  });

  assert.deepEqual(result, { patched: 1, created: 1 });
  assert.deepEqual(patches, [
    {
      id: "model_existing",
      value: {
        supportsVideo: true,
        videoCapabilities: textToVideoCapabilities,
        architecture: { tokenizer: "o200k_base", modality: "text->video" },
      },
    },
  ]);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0]?.value.supportsVideo, true);
  assert.deepEqual(inserts[0]?.value.architecture, { modality: "text+image->video" });
});

test("syncVideoModels maps OpenRouter video payloads into batch mutation args", async () => {
  const originalFetch = globalThis.fetch;
  const mutationCalls: Array<Record<string, any>> = [];

  try {
    globalThis.fetch = (async (url: string | URL) => {
      assert.equal(String(url), "https://openrouter.ai/api/v1/videos/models");
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: "openai/sora-2",
              name: "Sora 2",
              canonical_slug: "openai/sora-2",
              supported_resolutions: ["720p"],
              supported_aspect_ratios: ["16:9"],
              supported_durations: [5.0],
              supported_frame_images: null,
              supported_sizes: ["1280x720"],
              generate_audio: true,
              pricing_skus: {
                duration_seconds: "0.01",
                duration_seconds_1080p: "0.02",
              },
              allowed_passthrough_parameters: ["quality"],
            },
          ],
        }),
      } as Response;
    }) as typeof fetch;

    await (syncVideoModels as any)._handler({
      runMutation: async (_ref: unknown, args: Record<string, any>) => {
        mutationCalls.push(args);
        return { patched: 1, created: 0 };
      },
    }, {});
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(mutationCalls.length, 1);
  const model = mutationCalls[0]?.models[0];
  assert.equal(model.modelId, "openai/sora-2");
  assert.equal(model.provider, "openai");
  assert.deepEqual(model.videoCapabilities.pricingSkus, {
    videoTokens: "0.01",
    perVideoSecond: "0.01",
    perVideoSecond1080p: "0.02",
    videoTokensWithoutAudio: undefined,
  });
});

test("syncImageModels fetches endpoint SKU pricing before batching model updates", async () => {
  const originalFetch = globalThis.fetch;
  const mutationCalls: Array<Record<string, any>> = [];
  const urls: string[] = [];

  try {
    globalThis.fetch = (async (url: string | URL) => {
      const textUrl = String(url);
      urls.push(textUrl);
      if (textUrl.endsWith("output_modalities=image")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: "black-forest-labs/flux-kontext",
                name: "FLUX Kontext",
                canonical_slug: "black-forest-labs/flux-kontext",
                architecture: {
                  modality: "text+image->image",
                  tokenizer: "other",
                  instruct_type: null,
                },
                pricing: { prompt: "0.000001", completion: "0.000002" },
                supported_parameters: ["prompt"],
              },
            ],
          }),
        } as Response;
      }

      assert.equal(
        textUrl,
        "https://openrouter.ai/api/v1/models/black-forest-labs/flux-kontext/endpoints",
      );
      return {
        ok: true,
        json: async () => ({
          data: {
            endpoints: [
              {
                pricing: {
                  image_token: "0.0000005",
                  image_output: "0.03",
                },
              },
            ],
          },
        }),
      } as Response;
    }) as typeof fetch;

    await (syncImageModels as any)._handler({
      runMutation: async (_ref: unknown, args: Record<string, any>) => {
        mutationCalls.push(args);
        return { createdOrPatched: 1, pricingOnly: 0, skipped: 0 };
      },
    }, {});
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(urls, [
    "https://openrouter.ai/api/v1/models?output_modalities=image",
    "https://openrouter.ai/api/v1/models/black-forest-labs/flux-kontext/endpoints",
  ]);
  const model = mutationCalls[0]?.models[0];
  assert.equal(model.imageOnly, true);
  assert.equal(model.inputPricePer1M, 1.0);
  assert.equal(model.outputPricePer1M, 2.0);
  assert.deepEqual(model.pricingSkus, {
    imageToken: "0.0000005",
    imageOutput: "0.03",
  });
});
