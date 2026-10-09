import assert from "node:assert/strict";
import test from "node:test";
import { syncBenchmarks } from "../models/artificial_analysis_sync";
import { creatorSlug, fetchLanguageBenchmarks } from "../models/artificial_analysis_api";
import type { BenchmarkPatch } from "../models/artificial_analysis_prepare";

const languageRow = (slug = "gpt-4.1") => ({
  id: slug, slug, name: "GPT-4.1", model_creator: { id: "creator", name: "OpenAI" },
  evaluations: { artificial_analysis_intelligence_index: null, artificial_analysis_coding_index: 68,
    artificial_analysis_agentic_index: 42 },
  pricing: { price_1m_input_tokens: 2, price_1m_output_tokens: null },
  performance: { median_output_tokens_per_second: null, median_time_to_first_token_seconds: 0.6 },
});
const pageResponse = (page: number, totalPages: number, data: unknown[] = [languageRow()]) => Response.json({
  tier: "free", intelligence_index_version: 4,
  pagination: { page, page_size: 200, total_pages: totalPages, has_more: page < totalPages }, data,
});
const imageResponse = () => Response.json({ tier: "free", data: [{ id: "image", slug: "imagen-4", elo: 1123 }] });
const models = [
  { _id: "llm", modelId: "openai/gpt-4.1", name: "GPT-4.1", provider: "openai",
    inputPricePer1M: 2, outputPricePer1M: 8, contextLength: 128000 },
  { _id: "image", modelId: "google/imagen-4", name: "Imagen 4", provider: "google" },
  { _id: "manual", modelId: "openai/o4-mini", name: "o4 mini", provider: "openai",
    benchmarkLlm: { intelligenceIndex: 77 }, derivedGuidance: { scores: { coding: 80 } } },
];
type Applied = { patches: BenchmarkPatch[]; matchedCount: number; totalModels: number };
type TestContext = {
  runQuery: () => Promise<typeof models>;
  runMutation: (_fn: unknown, args: Applied) => Promise<void>;
};
const handler = (syncBenchmarks as unknown as { _handler: (ctx: TestContext, args: object) => Promise<void> })._handler;
async function runSync(fetcher: typeof fetch, key: string | null = "test-key") {
  const oldKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  const oldFetch = globalThis.fetch;
  const applied: Applied[] = [];
  let queries = 0;
  if (key === null) delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
  else process.env.ARTIFICIAL_ANALYSIS_API_KEY = key;
  globalThis.fetch = fetcher;
  try {
    await handler({ runQuery: async () => { queries++; return models; },
      runMutation: async (_fn, args) => { applied.push(args); } }, {});
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.ARTIFICIAL_ANALYSIS_API_KEY;
    else process.env.ARTIFICIAL_ANALYSIS_API_KEY = oldKey;
  }
  return { applied, queries };
}

test("Free sync follows every language page and preserves nullable/absent metrics", async () => {
  const paths: string[] = [];
  const result = await runSync(async (input, init) => {
    assert.equal((init?.headers as Record<string, string>)["x-api-key"], "test-key");
    const url = new URL(String(input)); paths.push(url.pathname + url.search);
    if (url.pathname.includes("/language/")) {
      const page = Number(url.searchParams.get("page"));
      return pageResponse(page, 4, [languageRow(page === 4 ? "gpt-4.1" : `unmatched-${page}`)]);
    }
    return imageResponse();
  });
  assert.equal(paths.length, 5);
  assert.ok(paths.includes("/api/v2/language/models/free?page=4"));
  assert.ok(paths.includes("/api/v2/media/text-to-image/models/free"));
  const patches = result.applied[0].patches;
  assert.deepEqual(patches.map((p) => p.docId), ["llm", "image"]);
  const llm = patches[0].patch.benchmarkLlm as Record<string, unknown>;
  assert.equal(llm.codingIndex, 68); assert.equal(llm.agenticIndex, 42);
  assert.equal(llm.timeToFirstTokenSeconds, 0.6); assert.equal(llm.creatorSlug, "openai");
  for (const field of ["intelligenceIndex", "mathIndex", "aaBlendedPricePer1M", "speedTokensPerSecond", "aaOutputPricePer1M"]) {
    assert.equal(llm[field], undefined);
  }
  const media = patches[1].patch.benchmarkMedia as { textToImage: Record<string, unknown> };
  assert.equal(media.textToImage.elo, 1123);
  assert.equal(media.textToImage.rank, undefined); assert.equal(media.textToImage.releaseDate, undefined);
});

for (const failure of ["http", "json", "schema", "pagination"]) {
  test(`failed later language page (${failure}) preserves language/manual snapshots while images update`, async () => {
    const result = await runSync(async (input) => {
      const url = new URL(String(input));
      if (!url.pathname.includes("/language/")) return imageResponse();
      if (url.searchParams.get("page") === "1") return pageResponse(1, 2);
      if (failure === "http") return new Response("unavailable", { status: 503 });
      if (failure === "json") return new Response("invalid json");
      if (failure === "schema") return Response.json({ data: [] });
      return pageResponse(1, 2);
    });
    assert.deepEqual(result.applied[0].patches.map((p) => p.docId), ["image"]);
  });
}

test("failed image category preserves its snapshot while language updates", async () => {
  const result = await runSync(async (input) => String(input).includes("/language/")
    ? pageResponse(1, 1) : Promise.reject(new Error("unavailable")));
  assert.deepEqual(result.applied[0].patches.map((p) => p.docId), ["llm"]);
});

test("both categories unavailable cause no catalogue read or writes", async () => {
  const result = await runSync(async () => new Response("unavailable", { status: 403 }));
  assert.equal(result.queries, 0); assert.deepEqual(result.applied, []);
});

test("missing API key causes no network or database work", async () => {
  const result = await runSync(async () => { throw new Error("unexpected fetch"); }, null);
  assert.equal(result.queries, 0); assert.deepEqual(result.applied, []);
});

test("creator names retain the matching provider crosswalk", () => {
  for (const [name, expected] of Object.entries({ "OpenAI": "openai", "Z AI": "zai", "SpaceXAI": "xai",
    "Liquid AI": "liquidai", "Allen Institute for AI": "ai2", "Microsoft": "azure", "Kimi": "kimi" })) {
    assert.equal(creatorSlug(name), expected);
  }
});

test("nullable creator is accepted without guessing a provider", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => pageResponse(1, 1, [{ ...languageRow(), model_creator: null }]);
  try {
    const [model] = await fetchLanguageBenchmarks("test-key");
    assert.equal(model.creatorSlug, undefined);
  } finally { globalThis.fetch = oldFetch; }
});
