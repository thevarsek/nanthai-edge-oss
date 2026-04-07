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
import { MODEL_IDS } from "../lib/model_constants";

export const SEARCH_TRANSFORMS = ["middle-out"];

// -- Complexity Presets -------------------------------------------------------

export interface ComplexityPreset {
  searchModel: string;
  breadth: number;
  depth: number;
  queryGen: "none" | "per-participant";
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
): Promise<SearchResult[]> {
  const results = await Promise.allSettled(
    queries.map((query) => callPerplexity(query, searchModel, apiKey)),
  );

  return results.map((result, i) => {
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

async function callPerplexity(
  query: string,
  model: string,
  apiKey: string,
): Promise<PerplexityResponse> {
  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You are a web research assistant. Include ALL source URLs as inline clickable markdown links: [Source Title](https://url). " +
          "Place citations near the claims they support — do not group them at the end.",
      },
      { role: "user", content: query },
    ],
    stream: false,
    temperature: 0.3,
    max_tokens: 5120,
  };

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

    if (!response.ok) {
      const errorText = await response.text();
      throw new ConvexError({
        code: "INTERNAL_ERROR" as const,
        message: `Perplexity API error (${response.status}): ${errorText.slice(0, 300)}`,
      });
    }

    const parsed = await response.json();
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
  } finally {
    clearTimeout(timeout);
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

export function buildResearchPlanningPrompt(
  userQuery: string,
  breadth: number,
): string {
  return [
    `You are a research planning assistant. Create a research plan for the following topic and generate ${breadth} diverse, specific search queries.`,
    "",
    "Return your response as a JSON object with this exact structure:",
    '{ "plan": "Brief research plan outline", "queries": ["query1", "query2", ...] }',
    "",
    `Topic: ${userQuery}`,
  ].join("\n");
}

export function buildResearchAnalysisPrompt(
  priorResults: string,
  breadth: number,
): string {
  return [
    "You are a research analyst. Analyze the following search results and identify gaps in the current research.",
    `Generate ${breadth} follow-up search queries to fill those gaps.`,
    "",
    "Return your response as a JSON object with this exact structure:",
    '{ "gaps": "Summary of identified gaps", "queries": ["query1", "query2", ...] }',
    "",
    "Current research results:",
    priorResults,
  ].join("\n");
}

export function buildResearchSynthesisPrompt(
  allResults: string,
): string {
  return [
    "You are a research synthesizer. Analyze ALL the following search results and create a structured research summary.",
    "",
    "Return your response as a JSON object with this exact structure:",
    '{ "findings": "Comprehensive structured summary of all findings", "sources": ["source1", "source2", ...] }',
    "",
    "All research results:",
    allResults,
  ].join("\n");
}

export function buildPaperGenerationSystemPrompt(
  synthesisData: string,
): string {
  return [
    "You are a research paper writer. Using the synthesized research findings below, write a comprehensive, well-structured research paper.",
    "",
    "Guidelines:",
    "- Use clear section headers (## for main sections, ### for subsections)",
    "- Include an executive summary at the top",
    "- Cite sources as clickable markdown links: [Source Title](https://url)",
    "- Present findings objectively with supporting evidence",
    "- Include a conclusion section summarizing key insights",
    "- Use professional, academic-quality writing",
    "",
    "Research findings:",
    synthesisData,
  ].join("\n");
}
