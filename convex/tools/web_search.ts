import { callOpenRouterNonStreaming, resolvePerplexityCitations } from "../lib/openrouter";
import { MODEL_IDS } from "../lib/model_constants";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { withZdrProvider } from "../lib/openrouter_zdr";
import { createTool } from "./registry";

const DEFAULT_WEB_SEARCH_RESULTS = 5;
const MAX_WEB_SEARCH_RESULTS = 10;

function normalizeMaxResults(value: unknown): number {
  const numeric = Number(value ?? DEFAULT_WEB_SEARCH_RESULTS);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DEFAULT_WEB_SEARCH_RESULTS;
  }
  return Math.min(MAX_WEB_SEARCH_RESULTS, Math.max(1, Math.round(numeric)));
}

export const webSearch = createTool({
  name: "web_search",
  description:
    "Search the live web through OpenRouter's web plugin and return a concise, source-backed result. " +
    "Use this when current information or external sources would materially improve the answer.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The web search query to run.",
      },
      max_results: {
        type: "integer",
        minimum: 1,
        maximum: MAX_WEB_SEARCH_RESULTS,
        default: DEFAULT_WEB_SEARCH_RESULTS,
        description: "Number of web results to request from OpenRouter. Defaults to 5, max 10.",
      },
    },
    required: ["query"],
  },
  execute: async (toolCtx, args) => {
    const query = String(args.query ?? "").trim();
    if (!query) {
      return { success: false, data: null, error: "Missing required field: query." };
    }

    const apiKey = await getRequiredUserOpenRouterApiKey(toolCtx.ctx, toolCtx.userId);
    const modelId = toolCtx.modelId?.trim() || MODEL_IDS.appDefault;
    const maxResults = normalizeMaxResults(args.max_results);

    const result = await callOpenRouterNonStreaming(
      apiKey,
      modelId,
      [
        {
          role: "system",
          content:
            "You are a concise web research assistant. Use the web results to answer the query. " +
            "Prioritize current, source-backed facts and include inline citation markers where useful.",
        },
        { role: "user", content: query },
      ],
      withZdrProvider(
        {
          temperature: 0.2,
          plugins: [{ id: "web", max_results: maxResults }],
        },
        toolCtx.requireZdr === true,
      ),
      { retryOnUnsupportedParam: false },
    );

    const resolvedContent = resolvePerplexityCitations(
      result.content,
      result.annotations,
    );
    const citations = result.annotations
      .map((annotation) => annotation.url_citation.url)
      .filter((url) => url.length > 0);

    return {
      success: true,
      data: {
        query,
        content: resolvedContent,
        citations,
        annotations: result.annotations,
        generationId: result.generationId,
      },
      artifactData: {
        query,
        content: resolvedContent,
        citations,
        annotations: result.annotations,
        usage: result.usage,
        finishReason: result.finishReason,
        generationId: result.generationId,
        modelId,
        requireZdr: toolCtx.requireZdr === true,
      },
    };
  },
});
