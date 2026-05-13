import assert from "node:assert/strict";
import test from "node:test";

import {
  getModel,
  listModels,
  listModelsInternalForSync,
  listModelSummaries,
} from "../models/queries";

function queryFor(rows: Array<Record<string, any>>) {
  return {
    withIndex: (_index: string, apply?: (q: any) => unknown) => {
      let provider: string | undefined;
      let modelId: string | undefined;
      const q = {
        eq: (field: string, value: string) => {
          if (field === "provider") provider = value;
          if (field === "modelId") modelId = value;
          return q;
        },
      };
      apply?.(q);
      return {
        collect: async () => rows.filter((row) => provider === undefined || row.provider === provider),
        first: async () => rows.find((row) => row.modelId === modelId) ?? null,
      };
    },
    take: async (count: number) => rows.slice(0, count),
    collect: async () => rows,
  };
}

const rows = [
  {
    _id: "model_text",
    modelId: "openai/gpt-5:free",
    name: "GPT",
    description: "Text model",
    provider: "openai",
    contextLength: 128_000,
    outputPricePer1M: 2,
    supportedParameters: ["reasoning"],
    supportsImages: false,
    supportsTools: true,
    derivedGuidance: {
      labels: ["general"],
      primaryLabel: "general",
      supportedIntents: ["chat"],
      scores: { chat: 1 },
      ranks: { chat: 1 },
      totalRanked: 1,
    },
  },
  {
    _id: "model_google",
    modelId: "google/gemini-small",
    name: "Gemini",
    provider: "google",
    contextLength: 32_000,
    outputPricePer1M: 1,
    supportedParameters: [],
  },
  {
    _id: "model_image",
    modelId: "black-forest-labs/flux",
    name: "Flux",
    provider: "bfl",
    contextLength: 4_000,
    outputPricePer1M: 100,
    supportsImages: true,
    architecture: { modality: "text->image" },
    imageCapabilities: {
      pricePerImage: 0.04,
      pricingSkus: { imageToken: "0.00001", imageOutput: "0.02" },
    },
  },
  {
    _id: "model_video",
    modelId: "openai/sora",
    name: "Sora",
    provider: "openai",
    supportsVideo: true,
    videoCapabilities: {
      supportedFrameImages: ["first_frame"],
      pricingSkus: {
        videoTokens: "0.01",
        videoTokensWithoutAudio: "0.005",
        perVideoSecond: "0.1",
        perVideoSecond1080p: "0.2",
      },
      pricingSkusMap: { duration_seconds: "0.1" },
    },
  },
  {
    _id: "model_short",
    modelId: "tiny/model",
    name: "Tiny",
    provider: "openai",
    contextLength: 8_000,
    outputPricePer1M: 1,
  },
];

test("model queries filter eligibility and hydrate summary-only capability fields", async () => {
  const ctx = { db: { query: () => queryFor(rows) } } as any;

  const all = await (listModels as any)._handler(ctx, {});
  const google = await (listModels as any)._handler(ctx, { provider: "google" });
  const summaries = await (listModelSummaries as any)._handler(ctx, {});

  assert.deepEqual(all.map((model: any) => model.modelId), [
    "openai/gpt-5:free",
    "google/gemini-small",
    "black-forest-labs/flux",
    "openai/sora",
  ]);
  assert.deepEqual(google.map((model: any) => model.modelId), ["google/gemini-small"]);
  assert.equal(summaries.find((model: any) => model.modelId === "openai/gpt-5:free").isFree, true);
  assert.equal(summaries.find((model: any) => model.modelId === "openai/gpt-5:free").hasReasoning, true);
  assert.deepEqual(summaries.find((model: any) => model.modelId === "openai/sora").supportedFrameImages, ["first_frame"]);
  assert.equal(summaries.find((model: any) => model.modelId === "openai/sora").videoPricing.perVideoSecond1080p, 0.2);
  assert.equal(summaries.find((model: any) => model.modelId === "black-forest-labs/flux").imagePricing.perImageOutput, 0.02);
  assert.equal(summaries.some((model: any) => model.modelId === "tiny/model"), false);
});

test("getModel and internal sync list preserve raw rows", async () => {
  const ctx = { db: { query: () => queryFor(rows) } } as any;

  const found = await (getModel as any)._handler(ctx, { modelId: "tiny/model" });
  const missing = await (getModel as any)._handler(ctx, { modelId: "missing/model" });
  const raw = await (listModelsInternalForSync as any)._handler(ctx, {});

  assert.equal(found?.modelId, "tiny/model");
  assert.equal(missing, null);
  assert.equal(raw.length, rows.length);
});
