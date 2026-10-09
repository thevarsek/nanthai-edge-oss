import { z } from "zod";
import { normalize } from "./guidance_matching";
import type { BenchmarkSyncArgs } from "./artificial_analysis_contract";

const optionalMetric = z.number().finite().nullish();
const languageModel = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  model_creator: z.object({ id: z.string(), name: z.string() }).nullable(),
  evaluations: z.object({
    artificial_analysis_intelligence_index: optionalMetric,
    artificial_analysis_coding_index: optionalMetric,
    artificial_analysis_agentic_index: optionalMetric,
  }),
  pricing: z.object({
    price_1m_input_tokens: optionalMetric,
    price_1m_output_tokens: optionalMetric,
  }),
  performance: z.object({
    median_output_tokens_per_second: optionalMetric,
    median_time_to_first_token_seconds: optionalMetric,
  }),
});
const languagePage = z.object({
  pagination: z.object({
    page: z.number().int().positive(),
    page_size: z.number().int().positive(),
    total_pages: z.number().int().positive(),
    has_more: z.boolean(),
  }),
  data: z.array(languageModel),
});
const imageSnapshot = z.object({
  data: z.array(z.object({ id: z.string(), slug: z.string(), elo: z.number().finite() })),
});

// The new API supplies creator names, not slugs. Keep the matcher's existing
// provider identifiers; these aliases are names observed in the Free catalogue.
const creatorAliases: Record<string, string> = {
  "allen-institute-for-ai": "ai2",
  "liquid-ai": "liquidai",
  microsoft: "azure",
  "z-ai": "zai",
  spacexai: "xai",
};
export function creatorSlug(name: string): string {
  const normalized = normalize(name);
  return creatorAliases[normalized] ?? normalized;
}

async function getSnapshot(path: string, apiKey: string): Promise<unknown> {
  const response = await fetch(`https://artificialanalysis.ai/api/v2/${path}`, {
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`Artificial Analysis HTTP ${response.status}`);
  return response.json();
}

export async function fetchLanguageBenchmarks(apiKey: string): Promise<BenchmarkSyncArgs["llmModels"]> {
  const models: BenchmarkSyncArgs["llmModels"] = [];
  let totalPages: number | undefined;
  for (let page = 1; ; page++) {
    const snapshot = languagePage.parse(await getSnapshot(`language/models/free?page=${page}`, apiKey));
    const pagination = snapshot.pagination;
    totalPages ??= pagination.total_pages;
    if (pagination.page !== page || pagination.total_pages !== totalPages
      || pagination.has_more !== (page < totalPages)) {
      throw new Error("Inconsistent Artificial Analysis pagination");
    }
    models.push(...snapshot.data.map((m) => ({
      externalId: m.id,
      slug: m.slug,
      aaName: m.name,
      creatorSlug: m.model_creator ? creatorSlug(m.model_creator.name) : undefined,
      creatorName: m.model_creator?.name,
      intelligenceIndex: m.evaluations.artificial_analysis_intelligence_index ?? undefined,
      codingIndex: m.evaluations.artificial_analysis_coding_index ?? undefined,
      agenticIndex: m.evaluations.artificial_analysis_agentic_index ?? undefined,
      speedTokensPerSecond: m.performance.median_output_tokens_per_second ?? undefined,
      timeToFirstTokenSeconds: m.performance.median_time_to_first_token_seconds ?? undefined,
      aaInputPricePer1M: m.pricing.price_1m_input_tokens ?? undefined,
      aaOutputPricePer1M: m.pricing.price_1m_output_tokens ?? undefined,
    })));
    if (!pagination.has_more) return models;
  }
}

export async function fetchImageBenchmarks(apiKey: string): Promise<BenchmarkSyncArgs["imageModels"]> {
  const snapshot = imageSnapshot.parse(await getSnapshot("media/text-to-image/models/free", apiKey));
  return snapshot.data.map((m) => ({ externalId: m.id, slug: m.slug, elo: m.elo }));
}
