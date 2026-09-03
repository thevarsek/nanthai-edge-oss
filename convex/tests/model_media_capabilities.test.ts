import assert from "node:assert/strict";
import test from "node:test";

import type { QueryCtx } from "../_generated/server";
import { getModelCapabilitiesHandler } from "../chat/queries_handlers_internal";
import {
  projectMediaCapabilities,
  projectModelMediaContract,
} from "../models/media_capabilities";
import { getModel, listModels, listModelSummaries } from "../models/queries";

type TestFunction = {
  _handler: (ctx: unknown, args: unknown) => Promise<unknown>;
};

const unavailableHybrid = {
  _id: "hybrid_unavailable",
  modelId: "example/hybrid",
  name: "Hybrid",
  provider: "example",
  contextLength: 128_000,
  supportsImages: true,
  supportsVideo: false,
  supportedParameters: [],
  architecture: { modality: "text+image->text+image" },
  imageCapabilities: {
    isAvailable: false,
    supportedParameters: { n: { type: "range", min: 1, max: 4 } },
    supportsStreaming: true,
    managedByImageSync: false,
    syncedAt: 1,
  },
  lastSyncedAt: 1,
};

function queryFor(row: typeof unavailableHybrid) {
  return {
    withIndex: (
      _index: string,
      apply: (query: { eq: (_field: string, _value: string) => unknown }) => unknown,
    ) => {
      apply({ eq: () => undefined });
      return {
        collect: async () => [row],
        first: async () => row,
      };
    },
    take: async () => [row],
  };
}

test("media capability projection exposes image and video arrays consistently", () => {
  const mediaCapabilities = projectMediaCapabilities({
    supportsImages: true,
    imageCapabilities: {
      isAvailable: true,
      supportedParameters: {
        n: { type: "range", min: 1, max: 10 },
        aspect_ratio: { values: ["1:1", "16:9", "1:1"] },
        resolution: { values: ["1K", "2K"] },
        size: { values: ["1024x1024"] },
        quality: { values: ["low", "high"] },
        background: { values: ["opaque", "transparent"] },
        output_format: { values: ["png", "webp"] },
        output_compression: { type: "range", min: 0, max: 100 },
      },
      maxInputReferences: 16,
      supportsStreaming: true,
    },
    videoCapabilities: {
      supportedResolutions: ["720p", "1080p", "720p"],
      supportedAspectRatios: ["16:9", "9:16"],
      supportedDurations: [5, 10, 5],
      supportedFrameImages: ["first_frame"],
      generateAudio: true,
      seed: false,
    },
    modelId: "microsoft/mai-voice-2",
    supportedVoices: ["en-US-Harper:MAI-Voice-2"],
    architecture: { modality: "text->speech" },
  });

  assert.deepEqual(mediaCapabilities.image, {
    counts: [],
    countMin: 1,
    countMax: 10,
    aspectRatios: ["1:1", "16:9"],
    resolutions: ["1K", "2K"],
    sizes: ["1024x1024"],
    qualities: ["low", "high"],
    backgrounds: ["opaque", "transparent"],
    outputFormats: ["png", "webp"],
    supportsOutputCompression: true,
    outputCompressionMin: 0,
    outputCompressionMax: 100,
    maxInputReferences: 16,
    supportsStreaming: true,
  });
  assert.deepEqual(mediaCapabilities.video, {
    resolutions: ["720p", "1080p"],
    aspectRatios: ["16:9", "9:16"],
    durations: [5, 10],
    frameImages: ["first_frame"],
    supportsAudio: true,
    supportsSeed: false,
  });
  assert.deepEqual(mediaCapabilities.speech, {
    voices: ["en-US-Harper:MAI-Voice-2"],
    outputFormats: ["mp3", "pcm"],
    supportsSpeed: true,
    speedMin: 0.5,
    speedMax: 2,
    supportsInstructions: false,
    supportsStyle: true,
    styleDegreeMin: 0.01,
    styleDegreeMax: 2,
  });
});

test("media capability projection preserves discrete image counts", () => {
  const mediaCapabilities = projectMediaCapabilities({
    imageCapabilities: {
      isAvailable: true,
      supportedParameters: {
        n: { type: "enum", values: ["4", "1", "4", "invalid"] },
      },
    },
  });

  assert.deepEqual(mediaCapabilities.image, {
    counts: [1, 4],
    countMin: 1,
    countMax: 4,
    aspectRatios: [],
    resolutions: [],
    sizes: [],
    qualities: [],
    backgrounds: [],
    outputFormats: [],
    supportsOutputCompression: false,
    outputCompressionMin: undefined,
    outputCompressionMax: undefined,
    maxInputReferences: undefined,
    supportsStreaming: false,
  });
});

test("explicit image unavailability overrides raw hybrid metadata everywhere", async () => {
  const projected = projectModelMediaContract(unavailableHybrid);
  assert.equal(projected.supportsImages, false);
  assert.equal(projected.architecture?.modality, "text+image->text");
  assert.equal(projected.mediaCapabilities.image, undefined);

  const ctx = { db: { query: () => queryFor(unavailableHybrid) } };
  const listed = await (listModels as unknown as TestFunction)._handler(ctx, {}) as Array<{
    supportsImages?: boolean;
    mediaCapabilities: { image?: unknown };
  }>;
  const summaries = await (listModelSummaries as unknown as TestFunction)
    ._handler(ctx, {}) as Array<{
      supportsImages?: boolean;
      imagePricing?: unknown;
      mediaCapabilities: { image?: unknown };
    }>;
  const detailed = await (getModel as unknown as TestFunction)
    ._handler(ctx, { modelId: unavailableHybrid.modelId }) as {
      supportsImages?: boolean;
      mediaCapabilities: { image?: unknown };
    };
  const capabilities = await getModelCapabilitiesHandler(
    ctx as unknown as QueryCtx,
    { modelId: unavailableHybrid.modelId },
  );

  assert.equal(listed[0]?.supportsImages, false);
  assert.equal(listed[0]?.mediaCapabilities.image, undefined);
  assert.equal(summaries[0]?.supportsImages, false);
  assert.equal(summaries[0]?.imagePricing, undefined);
  assert.equal(summaries[0]?.mediaCapabilities.image, undefined);
  assert.equal(detailed.supportsImages, false);
  assert.equal(detailed.mediaCapabilities.image, undefined);
  assert.equal(capabilities?.hasImageGeneration, false);
  assert.equal(capabilities?.imageCapabilities, undefined);
});
