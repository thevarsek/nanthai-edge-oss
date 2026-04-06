import assert from "node:assert/strict";
import test from "node:test";

import { applyBenchmarks } from "../models/artificial_analysis_apply";
import { prepareBenchmarkUpdates } from "../models/artificial_analysis_prepare";
import { applyUseCases } from "../models/openrouter_usecase_sync";

type CachedModelDoc = Record<string, unknown> & {
  _id: string;
  modelId: string;
  name: string;
  provider?: string;
  canonicalSlug?: string;
  contextLength?: number;
  inputPricePer1M?: number;
  outputPricePer1M?: number;
  openRouterUseCases?: Array<Record<string, unknown>>;
};

function buildBenchmarksCtx(models: CachedModelDoc[]) {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      query: (table: string) => {
        assert.equal(table, "cachedModels");
        return {
          collect: async () => models,
        };
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  } as any;
  return { ctx, patches };
}

function buildUseCasesCtx(models: CachedModelDoc[]) {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
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
                models.find((model) => model.modelId === selectedModelId) ?? null,
            };
          },
          collect: async () => models,
        };
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  } as any;
  return { ctx, patches };
}

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

test("prepareBenchmarkUpdates skips patch when derived guidance is unchanged", () => {
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

  const firstRun = prepareBenchmarkUpdates([baseModel], benchmarkArgs, 123);
  assert.equal(firstRun.patches.length, 1);

  const hydratedModel = {
    ...baseModel,
    ...firstRun.patches[0].patch,
  };

  const secondRun = prepareBenchmarkUpdates([hydratedModel], benchmarkArgs, 456);
  assert.equal(secondRun.patches.length, 0);
});

test("prepareBenchmarkUpdates patches when derived guidance changes", () => {
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

  const firstRun = prepareBenchmarkUpdates([baseModel], benchmarkArgs, 123);
  const hydratedModel = {
    ...baseModel,
    ...firstRun.patches[0].patch,
  };

  const updatedArgs = {
    ...benchmarkArgs,
    llmModels: [
      {
        ...benchmarkArgs.llmModels[0],
        intelligenceIndex: 95,
      },
    ],
  };

  const secondRun = prepareBenchmarkUpdates([hydratedModel], updatedArgs, 456);
  assert.equal(secondRun.patches.length, 1);
});

test("applyBenchmarks applies prepared patches", async () => {
  const ctx = buildBenchmarksCtx([]);

  await (applyBenchmarks as any)._handler(ctx.ctx, {
    matchedCount: 1,
    totalModels: 3,
    patches: [
      {
        docId: "model_1",
        patch: {
          derivedGuidance: { primaryLabel: "Fast" },
        },
      },
    ],
  });

  assert.deepEqual(ctx.patches, [
    {
      id: "model_1",
      value: { derivedGuidance: { primaryLabel: "Fast" } },
    },
  ]);
});

test("applyUseCases skips patch when use case hints are unchanged", async () => {
  const baseModel: CachedModelDoc = {
    _id: "model_1",
    modelId: "openai/gpt-4.1",
    name: "GPT-4.1",
  };

  const args = {
    results: [
      {
        category: "programming",
        modelIds: ["openai/gpt-4.1"],
      },
    ],
  };

  const firstRun = buildUseCasesCtx([baseModel]);
  await (applyUseCases as any)._handler(firstRun.ctx, args);
  assert.equal(firstRun.patches.length, 1);

  const hydratedModel = {
    ...baseModel,
    ...firstRun.patches[0].value,
  };

  const secondRun = buildUseCasesCtx([hydratedModel]);
  await (applyUseCases as any)._handler(secondRun.ctx, args);
  assert.equal(secondRun.patches.length, 0);
});

test("applyUseCases patches when use case hints change", async () => {
  const baseModel: CachedModelDoc = {
    _id: "model_1",
    modelId: "openai/gpt-4.1",
    name: "GPT-4.1",
    openRouterUseCases: [
      {
        category: "programming",
        returnedRank: 1,
        syncedAt: 1,
      },
    ],
  };

  const ctx = buildUseCasesCtx([baseModel]);
  await (applyUseCases as any)._handler(ctx.ctx, {
    results: [
      {
        category: "science",
        modelIds: ["openai/gpt-4.1"],
      },
    ],
  });

  assert.equal(ctx.patches.length, 1);
  assert.deepEqual(ctx.patches[0].value.openRouterUseCases, [
    {
      category: "science",
      returnedRank: 1,
      syncedAt: (ctx.patches[0].value.openRouterUseCases as Array<Record<string, unknown>>)[0].syncedAt,
    },
  ]);
});
