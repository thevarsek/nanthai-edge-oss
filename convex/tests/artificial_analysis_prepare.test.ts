import assert from "node:assert/strict";
import test from "node:test";

import { prepareBenchmarkUpdates } from "../models/artificial_analysis_prepare";

type CachedModelDoc = Record<string, unknown> & {
  _id: string;
  modelId: string;
  name: string;
  provider?: string;
  canonicalSlug?: string;
  contextLength?: number;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
};

const benchmarkArgs = {
  llmModels: [
    {
      externalId: "aa_1",
      slug: "gpt-4.1",
      aaName: "GPT-4.1",
      creatorSlug: "openai",
      creatorName: "OpenAI",
      intelligenceIndex: 70,
      codingIndex: 68,
      mathIndex: 65,
      agenticIndex: 72,
      speedTokensPerSecond: 90,
      timeToFirstTokenSeconds: 0.6,
      aaInputPricePer1M: 2,
      aaOutputPricePer1M: 8,
      aaBlendedPricePer1M: 10,
    },
  ],
  imageModels: [],
};

test("prepareBenchmarkUpdates returns patch payloads for matched models", () => {
  const model: CachedModelDoc = {
    _id: "model_1",
    modelId: "openai/gpt-4.1",
    name: "GPT-4.1",
    canonicalSlug: "openai/gpt-4.1",
    provider: "openai",
    contextLength: 128000,
    inputPricePer1M: 2,
    outputPricePer1M: 8,
  };

  const result = prepareBenchmarkUpdates([model], benchmarkArgs, 123);

  assert.equal(result.totalModels, 1);
  assert.equal(result.matchedCount, 1);
  assert.equal(result.patches.length, 1);
  assert.equal(result.patches[0]?.docId, "model_1");
});

test("prepareBenchmarkUpdates skips unchanged benchmark patches", () => {
  const baseModel: CachedModelDoc = {
    _id: "model_1",
    modelId: "openai/gpt-4.1",
    name: "GPT-4.1",
    canonicalSlug: "openai/gpt-4.1",
    provider: "openai",
    contextLength: 128000,
    inputPricePer1M: 2,
    outputPricePer1M: 8,
  };

  const firstPass = prepareBenchmarkUpdates([baseModel], benchmarkArgs, 123);
  assert.equal(firstPass.patches.length, 1);

  const hydratedModel = {
    ...baseModel,
    ...firstPass.patches[0]?.patch,
  };

  const secondPass = prepareBenchmarkUpdates([hydratedModel], benchmarkArgs, 456);

  assert.equal(secondPass.totalModels, 1);
  assert.equal(secondPass.matchedCount, 1);
  assert.equal(secondPass.patches.length, 0);
});
