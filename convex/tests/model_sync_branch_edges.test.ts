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

test("image model sync covers failed, empty, endpoint failure, transport error, and multimodal branches", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<Record<string, any>> = [];
  try {
    globalThis.fetch = (async () => ({ ok: false, status: 500, statusText: "Nope" }) as Response) as typeof fetch;
    await (syncImageModels as any)._handler({ runMutation: async () => assert.fail("should not mutate") }, {});

    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ data: [] }) }) as Response) as typeof fetch;
    await (syncImageModels as any)._handler({ runMutation: async () => assert.fail("should not mutate") }, {});

    globalThis.fetch = (async (url: string | URL) => {
      const textUrl = String(url);
      if (textUrl.endsWith("output_modalities=image")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: "openai/gpt-image", architecture: { modality: "text+image->text+image" }, pricing: { image: "0.04" } },
              { id: "bad/provider", architecture: { modality: "text->image" }, pricing: { prompt: "bad", completion: "0" } },
              { id: "throw/provider", architecture: {}, pricing: {} },
            ],
          }),
        } as Response;
      }
      if (textUrl.includes("bad/provider")) return { ok: false } as Response;
      throw new Error("endpoint down");
    }) as typeof fetch;
    await (syncImageModels as any)._handler({
      runMutation: async (_ref: unknown, args: Record<string, any>) => {
        calls.push(args);
        return { createdOrPatched: 1, pricingOnly: 1, skipped: 1 };
      },
    }, {});
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].models[0].imageOnly, false);
  assert.equal(calls[0].models[0].pricePerImage, 0.04);
  assert.equal(calls[0].models[1].inputPricePer1M, undefined);
  assert.equal(calls[0].models[2].provider, "throw");
});
