import assert from "node:assert/strict";
import test from "node:test";

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
