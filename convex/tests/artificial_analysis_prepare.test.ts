import assert from "node:assert/strict";
import test from "node:test";

import { prepareBenchmarkUpdates } from "../models/artificial_analysis_prepare";
import { syncBenchmarks } from "../models/artificial_analysis_sync";

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

test("syncBenchmarks skips fetches when the API key is absent", async () => {
  const originalApiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  globalThis.fetch = (async () => {
    fetchCount += 1;
    throw new Error("fetch should not be called");
  }) as typeof fetch;

  try {
    await (syncBenchmarks as any)._handler({
      runQuery: async () => {
        throw new Error("query should not be called");
      },
      runMutation: async () => {
        throw new Error("mutation should not be called");
      },
    }, {});
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
    } else {
      process.env.ARTIFICIAL_ANALYSIS_API_KEY = originalApiKey;
    }
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCount, 0);
});

test("syncBenchmarks preserves snapshots when both endpoint responses are unusable", async () => {
  const originalApiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  const originalFetch = globalThis.fetch;
  const queried: Array<Record<string, unknown>> = [];
  const mutations: Array<Record<string, unknown>> = [];
  let fetchCount = 0;

  process.env.ARTIFICIAL_ANALYSIS_API_KEY = "aa_key";
  globalThis.fetch = (async (url: string) => {
    fetchCount += 1;
    if (url.includes("/llms/models")) {
      return {
        ok: false,
        status: 503,
        json: async () => ({ data: [] }),
      } as Response;
    }
    throw new Error("image API unavailable");
  }) as typeof fetch;

  try {
    await (syncBenchmarks as any)._handler({
      runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
        queried.push(args);
        return [];
      },
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {});
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
    } else {
      process.env.ARTIFICIAL_ANALYSIS_API_KEY = originalApiKey;
    }
    globalThis.fetch = originalFetch;
  }

  assert.equal(fetchCount, 2);
  assert.deepEqual(queried, []);
  assert.deepEqual(mutations, []);
});

test("syncBenchmarks accepts array and wrapped snapshots with nullable AA fields", async () => {
  const originalApiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  const originalFetch = globalThis.fetch;
  const mutations: Array<Record<string, unknown>> = [];

  process.env.ARTIFICIAL_ANALYSIS_API_KEY = "aa_key";
  globalThis.fetch = (async (url: string) => {
    if (url.includes("/llms/models")) {
      return {
        ok: true,
        json: async () => [{
          id: "llm_nulls",
          slug: "gpt-4.1",
          name: null,
          model_creator: {
            slug: "openai",
            name: "OpenAI",
          },
          evaluations: {
            artificial_analysis_intelligence_index: null,
            artificial_analysis_coding_index: 68,
            artificial_analysis_math_index: null,
          },
          pricing: {
            price_1m_blended_3_to_1: null,
            price_1m_input_tokens: 2,
            price_1m_output_tokens: null,
          },
          median_output_tokens_per_second: null,
          median_time_to_first_token_seconds: 0.6,
        }],
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        data: [{
          id: "image_nulls",
          slug: "imagen-4",
          elo: null,
          rank: 3,
          release_date: null,
        }],
      }),
    } as Response;
  }) as typeof fetch;

  try {
    await (syncBenchmarks as any)._handler({
      runQuery: async () => [
        {
          _id: "model_llm",
          modelId: "openai/gpt-4.1",
          name: "GPT-4.1",
          canonicalSlug: "gpt-4.1",
          provider: "openai",
          contextLength: 128000,
          inputPricePer1M: 2,
          outputPricePer1M: 8,
        },
        {
          _id: "model_image",
          modelId: "google/imagen-4",
          name: "Imagen 4",
          canonicalSlug: "imagen-4",
          provider: "google",
        },
      ],
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    }, {});
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
    } else {
      process.env.ARTIFICIAL_ANALYSIS_API_KEY = originalApiKey;
    }
    globalThis.fetch = originalFetch;
  }

  assert.equal(mutations.length, 1);
  assert.equal(mutations[0]?.totalModels, 2);
  assert.equal(mutations[0]?.matchedCount, 2);
  const patches = mutations[0]?.patches as Array<{ docId: string; patch: Record<string, unknown> }>;
  assert.equal(patches.length, 2);
  assert.ok(patches.some((entry) => entry.docId === "model_llm"));
  assert.ok(patches.some((entry) => entry.docId === "model_image"));
});
