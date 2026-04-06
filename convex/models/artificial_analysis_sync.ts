// convex/models/artificial_analysis_sync.ts
// =============================================================================
// Sync Artificial Analysis benchmark data and merge with cached models.
//
// Endpoints:
//   - GET https://artificialanalysis.ai/api/v2/data/llms/models   (LLM benchmarks)
//   - GET https://artificialanalysis.ai/api/v2/data/media/text-to-image  (Image benchmarks)
//
// Env var: ARTIFICIAL_ANALYSIS_API_KEY (server-side only)
// Cadence: daily at 2:00 UTC via cron
// =============================================================================

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { prepareBenchmarkUpdates } from "./artificial_analysis_prepare";

// -- AA API response types (match actual nested response structure) ------------

interface AaLlmModel {
  id: string;
  name?: string;
  slug: string;
  model_creator?: {
    id?: string;
    name?: string;
    slug?: string;
  };
  evaluations?: {
    artificial_analysis_intelligence_index?: number;
    artificial_analysis_coding_index?: number;
    artificial_analysis_math_index?: number;
    // Individual benchmark scores (not used for primary scoring)
    mmlu_pro?: number;
    gpqa?: number;
    hle?: number;
    livecodebench?: number;
    scicode?: number;
    math_500?: number;
    aime?: number;
  };
  pricing?: {
    price_1m_blended_3_to_1?: number;
    price_1m_input_tokens?: number;
    price_1m_output_tokens?: number;
  };
  median_output_tokens_per_second?: number;
  median_time_to_first_token_seconds?: number;
}

interface AaImageModel {
  id: string;
  slug: string;
  model_creator?: {
    id?: string;
    name?: string;
    slug?: string;
  };
  elo?: number;
  rank?: number;
  release_date?: string;
}

// -- Main sync action ---------------------------------------------------------

export const syncBenchmarks = internalAction({
  args: {},
  handler: async (ctx) => {
    const apiKey = process.env.ARTIFICIAL_ANALYSIS_API_KEY;
    if (!apiKey) {
      console.warn("ARTIFICIAL_ANALYSIS_API_KEY not set — skipping benchmark sync");
      return;
    }

    const headers = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    };

    // Fetch LLM and image benchmarks in parallel
    const [llmResult, imageResult] = await Promise.allSettled([
      fetch("https://artificialanalysis.ai/api/v2/data/llms/models", { headers }),
      fetch("https://artificialanalysis.ai/api/v2/data/media/text-to-image", { headers }),
    ]);

    let llmModels: AaLlmModel[] = [];
    let imageModels: AaImageModel[] = [];

    if (llmResult.status === "fulfilled" && llmResult.value.ok) {
      const data = await llmResult.value.json();
      llmModels = Array.isArray(data) ? data : (data.data ?? []);
      console.log(`AA LLM sync: fetched ${llmModels.length} models`);
    } else {
      const reason =
        llmResult.status === "rejected"
          ? llmResult.reason
          : `${(llmResult as PromiseFulfilledResult<Response>).value.status}`;
      console.error(`AA LLM fetch failed: ${reason} — keeping last snapshot`);
    }

    if (imageResult.status === "fulfilled" && imageResult.value.ok) {
      const data = await imageResult.value.json();
      imageModels = Array.isArray(data) ? data : (data.data ?? []);
      console.log(`AA Image sync: fetched ${imageModels.length} models`);
    } else {
      const reason =
        imageResult.status === "rejected"
          ? imageResult.reason
          : `${(imageResult as PromiseFulfilledResult<Response>).value.status}`;
      console.error(`AA Image fetch failed: ${reason} — keeping last snapshot`);
    }

    if (llmModels.length === 0 && imageModels.length === 0) {
      console.warn("No AA data fetched — preserving existing guidance");
      return;
    }

    // Helper: coerce null → undefined (AA API returns explicit nulls)
    const num = (v: number | null | undefined): number | undefined =>
      v != null ? v : undefined;
    const str = (v: string | null | undefined): string | undefined =>
      v != null ? v : undefined;

    const allModels = await ctx.runQuery(internal.models.queries.listModelsInternalForSync, {});
    const prepared = prepareBenchmarkUpdates(allModels, {
      llmModels: llmModels.map((m) => ({
        externalId: String(m.id),
        slug: m.slug,
        aaName: str(m.name),
        creatorSlug: str(m.model_creator?.slug),
        creatorName: str(m.model_creator?.name),
        intelligenceIndex: num(m.evaluations?.artificial_analysis_intelligence_index),
        codingIndex: num(m.evaluations?.artificial_analysis_coding_index),
        mathIndex: num(m.evaluations?.artificial_analysis_math_index),
        speedTokensPerSecond: num(m.median_output_tokens_per_second),
        timeToFirstTokenSeconds: num(m.median_time_to_first_token_seconds),
        aaInputPricePer1M: num(m.pricing?.price_1m_input_tokens),
        aaOutputPricePer1M: num(m.pricing?.price_1m_output_tokens),
        aaBlendedPricePer1M: num(m.pricing?.price_1m_blended_3_to_1),
      })),
      imageModels: imageModels.map((m) => ({
        externalId: String(m.id),
        slug: m.slug,
        elo: num(m.elo),
        rank: num(m.rank),
        releaseDate: str(m.release_date),
      })),
    }, Date.now());

    await ctx.runMutation(internal.models.artificial_analysis_apply.applyBenchmarks, {
      matchedCount: prepared.matchedCount,
      totalModels: prepared.totalModels,
      patches: prepared.patches.map((entry) => ({
        docId: entry.docId as any,
        patch: entry.patch,
      })),
    });
  },
});

