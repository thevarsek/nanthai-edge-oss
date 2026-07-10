import assert from "node:assert/strict";
import test from "node:test";

import { syncImageModels } from "../models/image_sync";
import { syncVideoModels } from "../models/video_sync";

test("video model sync covers failed, empty, array payload, and alternate pricing SKU branches", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, any>> = [];
  try {
    globalThis.fetch = (async () => ({ ok: false, status: 503, statusText: "Unavailable" }) as Response) as typeof fetch;
    await (syncVideoModels as any)._handler({ runMutation: async () => assert.fail("should not mutate") }, {});

    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ data: [] }) }) as Response) as typeof fetch;
    await (syncVideoModels as any)._handler({ runMutation: async () => assert.fail("should not mutate") }, {});

    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => [{
        id: "google/veo",
        supported_frame_images: ["first_frame"],
        pricing_skus: {
          duration_seconds_with_audio: "0.11",
          duration_seconds_without_audio: "0.07",
          duration_seconds_with_audio_720p: "0.12",
          duration_seconds_with_audio_4k: "0.18",
        },
      }],
    }) as Response) as typeof fetch;
    await (syncVideoModels as any)._handler({
      runMutation: async (_ref: unknown, args: Record<string, any>) => {
        calls.push(args);
        return { patched: 0, created: 1 };
      },
    }, {});
  } finally {
    globalThis.fetch = originalFetch;
  }

  const capabilities = calls[0].models[0].videoCapabilities;
  assert.deepEqual(capabilities.pricingSkus, {
    videoTokens: "0.11",
    videoTokensWithoutAudio: "0.07",
    perVideoSecond: "0.12",
    perVideoSecond1080p: "0.18",
  });
  assert.deepEqual(capabilities.supportedFrameImages, ["first_frame"]);
});

test("image model sync uses dedicated discovery and preserves failed enrichments", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, any>> = [];
  try {
    globalThis.fetch = (async () => ({ ok: false, status: 500, statusText: "Nope" }) as Response) as typeof fetch;
    await (syncImageModels as any)._handler({ runMutation: async () => assert.fail("should not mutate") }, {});

    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ data: [] }) }) as Response) as typeof fetch;
    await (syncImageModels as any)._handler({ runMutation: async () => assert.fail("should not mutate") }, {});

    globalThis.fetch = (async (url: string | URL) => {
      const textUrl = String(url);
      if (textUrl.endsWith("/images/models")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                id: "openai/gpt-image",
                architecture: {
                  input_modalities: ["text", "image"],
                  output_modalities: ["text", "image"],
                },
              },
              { id: "bad/provider" },
              { id: "throw/provider" },
            ],
          }),
        } as Response;
      }
      if (textUrl.includes("openai/gpt-image")) {
        return {
          ok: true,
          json: async () => ({
            endpoints: [{
              pricing: [{
                billable: "output_image",
                unit: "image",
                cost_usd: 0.04,
              }],
            }],
          }),
        } as Response;
      }
      if (textUrl.includes("bad/provider")) return { ok: false } as Response;
      throw new Error("endpoint down");
    }) as typeof fetch;
    await (syncImageModels as any)._handler({
      runMutation: async (_ref: unknown, args: Record<string, any>) => {
        calls.push(args);
        if ("activeModelIds" in args) return { deleted: 0 };
        return { upserted: args.models.length, created: 1 };
      },
    }, {});
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 2);
  assert.equal(calls[0].models[0].imageOnly, false);
  assert.equal(calls[0].models[0].imageCapabilities.pricePerImage, 0.04);
  assert.deepEqual(calls[1].activeModelIds, [
    "openai/gpt-image",
    "bad/provider",
    "throw/provider",
  ]);
});
