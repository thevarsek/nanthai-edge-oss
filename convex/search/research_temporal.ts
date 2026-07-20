export interface ResearchTemporalContext {
  referenceDate: string;
  recencySensitive: boolean;
  windowStart?: string;
  windowEnd?: string;
  searchAfterBoundary?: string;
  windowEndExclusive?: string;
  windowDays?: number;
}

const RECENCY_INTENT = /\b(latest|recent|newest|current|today|news|this (?:week|month)|past (?:week|month)|up[ -]to[ -]date)\b/i;

export function buildResearchTemporalContext(
  userQuery: string,
  now: Date = new Date(),
): ResearchTemporalContext {
  const referenceDate = isoDate(now);
  if (!RECENCY_INTENT.test(userQuery)) {
    return { referenceDate, recencySensitive: false };
  }

  const windowDays = /\b(today|last 24 hours?)\b/i.test(userQuery)
    ? 1
    : /\b(this week|past week|last 7 days?)\b/i.test(userQuery)
      ? 7
      : 30;
  const end = utcDate(referenceDate);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (windowDays - 1));
  const searchAfter = new Date(start);
  searchAfter.setUTCDate(searchAfter.getUTCDate() - 1);
  const endExclusive = new Date(end);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);

  return {
    referenceDate,
    recencySensitive: true,
    windowStart: isoDate(start),
    windowEnd: referenceDate,
    searchAfterBoundary: isoDate(searchAfter),
    windowEndExclusive: isoDate(endExclusive),
    windowDays,
  };
}

export function normalizeResearchQueryForTime(
  query: string,
  temporal: ResearchTemporalContext,
): string {
  if (
    !temporal.recencySensitive ||
    !temporal.searchAfterBoundary ||
    !temporal.windowStart ||
    !temporal.windowEnd ||
    !temporal.windowEndExclusive
  ) {
    return query.trim();
  }

  const withoutStaleOperators = query
    .replace(/\b(?:after|before):\d{4}[-/]\d{2}[-/]\d{2}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [
    withoutStaleOperators,
    `after:${temporal.searchAfterBoundary}`,
    `before:${temporal.windowEndExclusive}`,
    `Focus on sources published from ${temporal.windowStart} through ${temporal.windowEnd}.`,
  ].join(" ");
}

export function buildResearchTemporalPrompt(
  temporal: ResearchTemporalContext,
): string[] {
  const lines = [
    `Research date: ${temporal.referenceDate} (UTC).`,
    "Treat this date as authoritative; do not infer the current date from model training data.",
  ];
  if (
    temporal.recencySensitive &&
    temporal.windowStart &&
    temporal.windowEnd
  ) {
    lines.push(
      `The user's wording is recency-sensitive. The primary reporting window is ${temporal.windowStart} through ${temporal.windowEnd}, inclusive.`,
      "Search queries and the final answer must prioritize events published or occurring inside that window.",
      "Older sources may appear only as clearly labelled background and must not be presented as the latest developments.",
    );
  }
  return lines;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function utcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
