import { ConvexError } from "convex/values";
// convex/search/helpers.ts
// =============================================================================
// Shared search helpers for M9 — Internet Search.
//
// - resolveComplexityPreset: Maps complexity (1-3) to model/breadth/depth.
// - executePerplexitySearch: Parallel Perplexity API calls via Promise.allSettled.
// - buildSearchSynthesisPrompt: Injects <search_results> into synthesis context.
// - CITATION_SYSTEM_PROMPT_SUFFIX: Appended for Normal Search citation formatting.
// =============================================================================

import {
  OPENROUTER_API_URL,
  HTTP_REFERER,
  X_TITLE,
  REQUEST_TIMEOUT_MS,
} from "../lib/openrouter_constants";
import {
  MODEL_IDS,
  OPENROUTER_DEFAULT_PROVIDER_SORT,
} from "../lib/model_constants";

export const SEARCH_TRANSFORMS = ["middle-out"];

// -- Complexity Presets -------------------------------------------------------

export interface ComplexityPreset {
  searchModel: string;
  breadth: number;
  depth: number;
  queryGen: "none" | "per-participant";
}

const SEARCH_COMPLEXITY_MAX_TOKENS: Record<number, number> = {
  1: 4096,
  2: 6144,
  3: 8000,
};

const SEARCH_MODEL_MAX_TOKENS: Record<string, number> = {
  [MODEL_IDS.searchPerplexity.thorough]: 8000,
  [MODEL_IDS.searchPerplexity.comprehensive]: 8000,
};

export function resolveSearchMaxTokens(
  _mode: "web" | "paper",
  complexity: number,
  searchModel?: string,
): number {
  const clamped = Math.max(1, Math.min(3, Math.round(complexity)));
  const desired = SEARCH_COMPLEXITY_MAX_TOKENS[clamped] ?? 6144;
  const modelCap = searchModel ? SEARCH_MODEL_MAX_TOKENS[searchModel] : undefined;
  return modelCap ? Math.min(desired, modelCap) : desired;
}

const WEB_PRESETS: Record<number, ComplexityPreset> = {
  1: {
    searchModel: MODEL_IDS.searchPerplexity.quick,
    breadth: 1,
    depth: 0,
    queryGen: "none",
  },
  2: {
    searchModel: MODEL_IDS.searchPerplexity.thorough,
    breadth: 3,
    depth: 0,
    queryGen: "per-participant",
  },
  3: {
    searchModel: MODEL_IDS.searchPerplexity.comprehensive,
    breadth: 5,
    depth: 0,
    queryGen: "per-participant",
  },
};

const PAPER_PRESETS: Record<number, ComplexityPreset> = {
  1: {
    searchModel: MODEL_IDS.searchPerplexity.quick,
    breadth: 2,
    depth: 1,
    queryGen: "per-participant",
  },
  2: {
    searchModel: MODEL_IDS.searchPerplexity.thorough,
    breadth: 3,
    depth: 2,
    queryGen: "per-participant",
  },
  3: {
    searchModel: MODEL_IDS.searchPerplexity.comprehensive,
    breadth: 5,
    depth: 3,
    queryGen: "per-participant",
  },
};

export function resolveComplexityPreset(
  mode: "web" | "paper",
  complexity: number,
): ComplexityPreset {
  const clamped = Math.max(1, Math.min(3, Math.round(complexity)));
  const presets = mode === "paper" ? PAPER_PRESETS : WEB_PRESETS;
  return presets[clamped];
}

// -- Perplexity Search Execution ----------------------------------------------

export interface SearchResult {
  query: string;
  content: string;
  citations: string[];
  success: boolean;
  error?: string;
  // M23: Usage from Perplexity for cost tracking.
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
  };
  generationId?: string;
}

/**
 * Execute parallel Perplexity searches via OpenRouter.
 * Uses Promise.allSettled so partial failure is OK.
 */
export async function executePerplexitySearch(
  queries: string[],
  searchModel: string,
  apiKey: string,
  options: { maxTokens?: number; requireZdr?: boolean } = {},
): Promise<SearchResult[]> {
  const results = await Promise.allSettled(
    queries.map((query) => callPerplexity(query, searchModel, apiKey, options)),
  );

  const mappedResults = results.map((result, i) => {
    if (result.status === "fulfilled") {
      return {
        query: queries[i],
        content: result.value.content,
        citations: result.value.citations,
        success: true,
        usage: result.value.usage,
        generationId: result.value.generationId,
      };
    }
    return {
      query: queries[i],
      content: "",
      citations: [],
      success: false,
      error: result.reason instanceof Error
        ? result.reason.message
        : "Unknown search error",
    };
  });

  if (
    options.requireZdr === true &&
    mappedResults.length > 0 &&
    mappedResults.every((result) => !result.success)
  ) {
    throw new ConvexError({
      code: "ZDR_SEARCH_UNAVAILABLE" as const,
      message:
        `Search is unavailable with Zero Data Retention for ${searchModel}. ` +
        "Please choose a ZDR-compatible search model or turn off ZDR.",
      failures: mappedResults.map((result) => ({
        query: result.query,
        error: result.error ?? "Unknown search error",
      })),
    });
  }

  return mappedResults;
}

export async function executeSinglePerplexitySearch(
  query: string,
  searchModel: string,
  apiKey: string,
  options: { maxTokens?: number; requireZdr?: boolean } = {},
): Promise<SearchResult> {
  try {
    const result = await callPerplexity(query, searchModel, apiKey, options);
    return {
      query,
      content: result.content,
      citations: result.citations,
      success: true,
      usage: result.usage,
      generationId: result.generationId,
    };
  } catch (error) {
    return {
      query,
      content: "",
      citations: [],
      success: false,
      error: error instanceof Error ? error.message : "Unknown search error",
    };
  }
}

interface PerplexityResponse {
  content: string;
  citations: string[];
  // M23: Usage from the Perplexity/OpenRouter response for cost tracking.
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
  };
  generationId?: string;
}

function buildPerplexityProvider(
  requireZdr: boolean,
  stripSoftProviderRouting: boolean,
): Record<string, unknown> | undefined {
  const provider: Record<string, unknown> = stripSoftProviderRouting
    ? {}
    : {
        ...(OPENROUTER_DEFAULT_PROVIDER_SORT ?? {}),
      };
  if (requireZdr) provider.zdr = true;
  return Object.keys(provider).length > 0 ? provider : undefined;
}

async function callPerplexity(
  query: string,
  model: string,
  apiKey: string,
  options: { maxTokens?: number; requireZdr?: boolean } = {},
): Promise<PerplexityResponse> {
  // Perplexity models have native web search — they always search, that's their
  // purpose.  Adding the `openrouter:web_search` server tool causes a 404
  // ("No endpoints found that support tool use").  Only inject the server tool
  // for non-Perplexity models that need it.
  const isPerplexityModel = model.startsWith("perplexity/");
  const maxTokens = options.maxTokens ?? 5120;
  const buildBody = (stripSoftProviderRouting: boolean): Record<string, unknown> => {
    const provider = buildPerplexityProvider(
      options.requireZdr === true,
      stripSoftProviderRouting,
    );
    return {
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a web research assistant. Return dense research notes, not a narrative essay. " +
            "Prioritize source-backed claims, named studies, concrete numbers, counterpoints, limitations, and direct URLs. " +
            "Avoid generic background prose and repetition. Include ALL source URLs as inline clickable markdown links: [Source Title](https://url). " +
            "Place citations near the claims they support — do not group them at the end.",
        },
        { role: "user", content: query },
      ],
      stream: false,
      temperature: 0.3,
      max_tokens: maxTokens,
      // Non-Perplexity models: add server tool so they can search the web.
      // Perplexity models: omit tools — they search natively and reject the
      // tools parameter with a 404.
      //
      // NOTE: This branch is currently dead code — all search models are
      // Perplexity (`model_constants.searchPerplexity`). If a non-Perplexity
      // model is added, verify that `openrouter:web_search` as the sole server
      // tool reliably triggers a search. Server tools are executed by OpenRouter
      // transparently (not via the model's tool-call mechanism), so
      // `tool_choice` does not apply. If the model skips searching, the system
      // prompt's instruction to "include ALL source URLs" is the only lever —
      // consider switching to a model with native search instead.
      ...(isPerplexityModel
        ? {}
        : {
            tools: [
              {
                type: "openrouter:web_search",
                parameters: { max_results: 5, max_total_results: 25 },
              },
            ],
          }),
      ...(provider ? { provider } : {}),
    };
  };

  try {
    let responseText = "";
    let strippedProviderOnce = false;
    while (true) {
      const body = buildBody(strippedProviderOnce);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const response = await fetch(OPENROUTER_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${apiKey}`,
            "HTTP-Referer": HTTP_REFERER,
            "X-Title": X_TITLE,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        responseText = await response.text();

        if (!response.ok) {
          if (
            response.status === 404 &&
            !strippedProviderOnce &&
            /no endpoints found/i.test(responseText)
          ) {
            strippedProviderOnce = true;
            continue;
          }
          throw new ConvexError({
            code: "INTERNAL_ERROR" as const,
            message: `Perplexity API error (${response.status}): ${responseText.slice(0, 300)}`,
          });
        }
      } finally {
        clearTimeout(timeout);
      }
      break;
    }

    const parsed = JSON.parse(responseText);
    const message = parsed?.choices?.[0]?.message;
    const rawContent: string = message?.content ?? "";

    // OpenRouter/Perplexity returns citations as message.annotations
    // (array of { type: "url_citation", url_citation: { url, title } }),
    // NOT as a top-level `citations` array.
    const annotations: Array<{
      type: string;
      url_citation?: { url: string; title?: string };
    }> = message?.annotations ?? [];

    const citationUrls: string[] = annotations
      .filter(
        (a): a is { type: "url_citation"; url_citation: { url: string; title?: string } } =>
          a.type === "url_citation" && !!a.url_citation?.url,
      )
      .map((a) => a.url_citation.url);

    // Build a lookup from 1-based citation index to URL + title.
    const citationMap = new Map<number, { url: string; title: string }>();
    annotations
      .filter(
        (a): a is { type: "url_citation"; url_citation: { url: string; title?: string } } =>
          a.type === "url_citation" && !!a.url_citation?.url,
      )
      .forEach((a, i) => {
        citationMap.set(i + 1, {
          url: a.url_citation.url,
          title: a.url_citation.title ?? a.url_citation.url,
        });
      });

    // Resolve inline [N] references to markdown links so the synthesis
    // model receives fully-resolved source URLs instead of opaque numbers.
    let content = rawContent.replace(
      /\[(\d+)\]/g,
      (_match, numStr) => {
        const num = parseInt(numStr, 10);
        const cite = citationMap.get(num);
        if (cite) {
          return `[${num}. ${cite.title}](${cite.url})`;
        }
        return _match; // leave unrecognized references untouched
      },
    );

    // Ensure a space before each resolved citation link so it doesn't
    // glue to adjacent text and consecutive citations get separated.
    content = content.replace(
      /(\S)(\[\d+\. )/g,
      (_m, before: string, link: string) => `${before} ${link}`,
    );

    const citations: string[] = citationUrls;

    // M23: Parse usage from Perplexity response for cost tracking.
    const rawUsage = parsed?.usage;
    const usage = rawUsage
      ? {
          promptTokens: rawUsage.prompt_tokens ?? 0,
          completionTokens: rawUsage.completion_tokens ?? 0,
          totalTokens: rawUsage.total_tokens ?? 0,
          cost: typeof rawUsage.cost === "number" ? rawUsage.cost : undefined,
        }
      : undefined;

    return { content, citations, usage, generationId: parsed?.id ?? undefined };
  } catch (error) {
    if (error instanceof ConvexError) throw error;

    const errObj = (error ?? {}) as {
      name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const errName = typeof errObj.name === "string" ? errObj.name : undefined;
    const errMessage =
      typeof errObj.message === "string" ? errObj.message : undefined;
    const cause = errObj.cause != null ? String(errObj.cause) : undefined;

    if (errName === "AbortError") {
      console.error("[perplexity:search] timeout", {
        model,
        timeoutMs: REQUEST_TIMEOUT_MS,
      });
      throw new Error(
        `Perplexity search timeout after ${REQUEST_TIMEOUT_MS}ms for model ${model}${cause ? `: ${cause}` : ""}`,
      );
    }

    if (errMessage === "fetch failed") {
      console.error("[perplexity:search] fetch failed", {
        model,
        error: errMessage,
        ...(cause ? { cause } : {}),
      });
      const fetchErr = new Error(
        `Perplexity search fetch failed for model ${model}${cause ? `: ${cause}` : ""}`,
      );
      (fetchErr as NodeJS.ErrnoException).cause = cause;
      throw fetchErr;
    }

    throw error;
  }
}

// -- Search Synthesis Prompt --------------------------------------------------

/**
 * Build a system prompt suffix that injects search results for synthesis.
 */
export function buildSearchSynthesisPrompt(
  searchResults: SearchResult[],
): string {
  const successfulResults = searchResults.filter((r) => r.success);
  if (successfulResults.length === 0) {
    return "No search results were found. Answer based on your existing knowledge and note that search failed.";
  }

  const blocks = successfulResults.map((r, i) => {
    const citationBlock = r.citations.length > 0
      ? `\nSources: ${r.citations.map((c, j) => `[${j + 1}] ${c}`).join(", ")}`
      : "";
    return `<result query="${r.query}" index="${i + 1}">\n${r.content}${citationBlock}\n</result>`;
  });

  return [
    "<search_results>",
    ...blocks,
    "</search_results>",
    "",
    "Use the search results above to provide a comprehensive, well-sourced answer.",
    "You MUST cite every source URL from the search results as a clickable markdown link: [Source Title](https://url).",
    "Place each citation inline near the claim it supports — do NOT group citations at the end.",
    "If search results are insufficient, supplement with your knowledge but clearly note what comes from search vs. your knowledge.",
  ].join("\n");
}

// -- Citation System Prompt Suffix (Normal Search / Path B) -------------------

export const CITATION_SYSTEM_PROMPT_SUFFIX = [
  "",
  "IMPORTANT — Web search is enabled for this request. Your response will include information retrieved from the web.",
  "You MUST cite every web source you reference using clickable markdown links: [Source Title](https://url).",
  "Integrate citations naturally within the text near the claims they support — do NOT group them at the end.",
  "If multiple sources support a claim, cite all of them inline.",
].join("\n");

// -- Query generation helpers -------------------------------------------------

export {
  buildQueryGenerationPrompt,
  parseGeneratedQueries,
} from "./query_generation_helpers";

// -- Research Paper Prompts ---------------------------------------------------

export {
  extractQueryStrings,
  parseAnalysisArtifact,
  parsePlanningArtifact,
  parseStructuredArtifact,
  summarizeSearchResults,
} from "./research_artifacts";
export {
  buildPaperArchitecturePrompt,
  buildPaperGenerationSystemPrompt,
  buildResearchAnalysisPrompt,
  buildResearchPlanningPrompt,
  buildResearchSynthesisPrompt,
} from "./research_prompts";
