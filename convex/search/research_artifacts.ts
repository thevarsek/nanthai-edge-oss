import type { SearchResult } from "./helpers";

export type ResearchQuery = {
  query: string;
  rationale?: string;
  targetConcepts?: string[];
  gapAddressed?: string;
};

export type ResearchPlanningArtifact = {
  paperType: string;
  discipline?: string;
  audience?: string;
  citationStyle?: string;
  researchQuestion: string;
  scope: {
    inScope: string[];
    outOfScope: string[];
    assumptions: string[];
  };
  keyConcepts: Array<{ concept: string; synonyms: string[] }>;
  inclusionCriteria: string[];
  exclusionCriteria: string[];
  plan: string;
  queries: ResearchQuery[];
};

export type ResearchAnalysisArtifact = {
  coverageSummary: string;
  evidenceGaps: string[];
  contradictionGaps: string[];
  methodologyGaps: string[];
  populationOrContextGaps: string[];
  followUpQueries: ResearchQuery[];
};

export function parsePlanningArtifact(content: string, fallbackQuery: string, breadth: number): ResearchPlanningArtifact {
  const parsed = parseJsonObject(content);
  const plan = stringOr(parsed?.plan, `Direct research on: ${fallbackQuery}`);
  const queries = clampQueries(parsed?.queries, breadth);
  const normalizedQueries = queries.length > 0 ? queries : [{ query: fallbackQuery, rationale: "Fallback query from user topic" }];

  return {
    paperType: stringOr(parsed?.paperType, "unknown"),
    discipline: optionalString(parsed?.discipline),
    audience: optionalString(parsed?.audience),
    citationStyle: stringOr(parsed?.citationStyle, "markdown_links"),
    researchQuestion: stringOr(parsed?.researchQuestion, fallbackQuery),
    scope: {
      inScope: stringArray((parsed?.scope as Record<string, unknown> | undefined)?.inScope),
      outOfScope: stringArray((parsed?.scope as Record<string, unknown> | undefined)?.outOfScope),
      assumptions: stringArray((parsed?.scope as Record<string, unknown> | undefined)?.assumptions),
    },
    keyConcepts: Array.isArray(parsed?.keyConcepts) ? parsed.keyConcepts.map(normalizeConcept).filter(Boolean) as Array<{ concept: string; synonyms: string[] }> : [],
    inclusionCriteria: stringArray(parsed?.inclusionCriteria),
    exclusionCriteria: stringArray(parsed?.exclusionCriteria),
    plan,
    queries: normalizedQueries,
  };
}

export function parseAnalysisArtifact(content: string, fallbackQuery: string, breadth: number): ResearchAnalysisArtifact {
  const parsed = parseJsonObject(content);
  const rawQueries = parsed?.followUpQueries ?? parsed?.queries;
  const queries = clampQueries(rawQueries, breadth);
  return {
    coverageSummary: stringOr(parsed?.coverageSummary ?? parsed?.gaps, "Could not parse gap analysis; performing general follow-up search."),
    evidenceGaps: stringArray(parsed?.evidenceGaps ?? parsed?.gaps),
    contradictionGaps: stringArray(parsed?.contradictionGaps),
    methodologyGaps: stringArray(parsed?.methodologyGaps),
    populationOrContextGaps: stringArray(parsed?.populationOrContextGaps),
    followUpQueries: queries.length > 0
      ? queries
      : [{ query: `More details about: ${fallbackQuery}`, rationale: "Fallback query after malformed gap analysis" }],
  };
}

export function parseStructuredArtifact(content: string, fallback: Record<string, unknown>): Record<string, unknown> {
  const parsed = parseJsonObject(content);
  if (parsed) return parsed;
  return content.trim().length > 0 ? { ...fallback, rawText: content.trim() } : fallback;
}

export function extractQueryStrings(value: unknown): string[] {
  return clampQueries(value, Number.MAX_SAFE_INTEGER).map((query) => query.query);
}

export function summarizeSearchResults(results: SearchResult[], maxContentLength: number): string {
  return results
    .filter((r) => r.success)
    .map((r, i) => {
      const citations = r.citations.length > 0
        ? `\nSources: ${r.citations.map((c, j) => `[${j + 1}] ${c}`).join(", ")}`
        : "";
      return `[Result ${i + 1}] Query: "${r.query}"\n${r.content.slice(0, maxContentLength)}${citations}`;
    })
    .join("\n\n---\n\n");
}

function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function clampQueries(value: unknown, breadth: number): ResearchQuery[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const queries: ResearchQuery[] = [];
  for (const item of value) {
    const query = typeof item === "string"
      ? item.trim()
      : typeof item === "object" && item !== null && typeof (item as { query?: unknown }).query === "string"
        ? (item as { query: string }).query.trim()
        : "";
    if (!query || seen.has(query.toLowerCase())) continue;
    seen.add(query.toLowerCase());
    queries.push({
      query,
      rationale: typeof item === "object" && item !== null ? optionalString((item as { rationale?: unknown }).rationale) : undefined,
      targetConcepts: typeof item === "object" && item !== null ? stringArray((item as { targetConcepts?: unknown }).targetConcepts) : undefined,
      gapAddressed: typeof item === "object" && item !== null ? optionalString((item as { gapAddressed?: unknown }).gapAddressed) : undefined,
    });
    if (queries.length >= breadth) break;
  }
  return queries;
}

function normalizeConcept(value: unknown): { concept: string; synonyms: string[] } | null {
  if (typeof value !== "object" || value === null) return null;
  const concept = optionalString((value as { concept?: unknown }).concept);
  return concept ? { concept, synonyms: stringArray((value as { synonyms?: unknown }).synonyms) } : null;
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return value.trim().length > 0 ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
