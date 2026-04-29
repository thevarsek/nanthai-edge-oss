/**
 * Build a prompt to generate diverse search queries from a user query.
 */
export function buildQueryGenerationPrompt(
  userQuery: string,
  count: number,
): string {
  return [
    `Generate exactly ${count} diverse search queries to thoroughly research the following topic.`,
    "Each query should approach the topic from a different angle (e.g., definitions, recent developments, expert opinions, comparisons, practical applications).",
    "Return ONLY a JSON array of strings, no other text.",
    "",
    `Topic: ${userQuery}`,
  ].join("\n");
}

/**
 * Parse generated queries from a model response.
 * Handles both JSON array and line-separated formats.
 */
export function parseGeneratedQueries(
  response: string,
  fallbackQuery: string,
  expectedCount: number,
): string[] {
  let parsedQueries: string[] = [];

  try {
    // Try JSON array first
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length > 0) {
        parsedQueries = parsed
          .filter((q: unknown) => typeof q === "string" && q.trim().length > 0)
          .slice(0, expectedCount);
      }
    }
  } catch {
    // Fall through to line parsing
  }

  if (parsedQueries.length === 0) {
    // Try line-separated
    const lines = response
      .split("\n")
      .map((l) => l.replace(/^\d+[.)]\s*/, "").trim())
      .filter((l) => l.length > 10);
    parsedQueries = lines.slice(0, expectedCount);
  }

  return normalizeQueries(parsedQueries, fallbackQuery, expectedCount);
}

function normalizeQueries(
  rawQueries: string[],
  fallbackQuery: string,
  expectedCount: number,
): string[] {
  const normalized = rawQueries
    .map((q) => q.trim())
    .filter((q) => q.length > 0);

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const query of normalized) {
    const key = query.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(query);
    }
    if (unique.length >= expectedCount) {
      break;
    }
  }

  if (unique.length === 0) {
    unique.push(fallbackQuery);
    seen.add(fallbackQuery.toLowerCase());
  }

  const expansionSuffixes = [
    "latest developments",
    "expert analysis",
    "practical applications",
    "comparisons and alternatives",
    "risks and limitations",
    "case studies",
  ];

  let suffixIndex = 0;
  while (unique.length < expectedCount) {
    const suffix = expansionSuffixes[suffixIndex % expansionSuffixes.length];
    const suffixRound = Math.floor(suffixIndex / expansionSuffixes.length);
    const candidate = suffixRound === 0
      ? `${fallbackQuery} ${suffix}`
      : `${fallbackQuery} ${suffix} ${suffixRound + 1}`;
    const key = candidate.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
    suffixIndex += 1;
  }

  return unique.slice(0, expectedCount);
}
