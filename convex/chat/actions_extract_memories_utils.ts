export type ExtractedMemory = {
  content: string;
  category?: string;
  memoryType?: string;
  retrievalMode?: string;
  importanceScore?: number;
  confidenceScore?: number;
  expiresInDays?: number;
  tags?: string[];
};

export interface MemoryExclusionRules {
  excludePhone: boolean;
  excludeEmail: boolean;
}

const TRANSIENT_OR_META_PATTERNS: RegExp[] = [
  /\b(might|maybe|possibly|probably|for now|right now|today|tonight|tomorrow|this week|this month|recently|just)\b/i,
  /\b(asked about|asking about|talking about|discussing|debugging|troubleshooting)\b/i,
  /\b(in this chat|in this conversation|topic changed|conversation moved)\b/i,
  /\b(error|stack trace|timeout|crash|failed request|authentication required|not working)\b/i,
];

const EXPLORATORY_INTENT_PATTERNS: RegExp[] = [
  /\b(interested in|interest in|thinking about|considering|curious about|looking into|exploring|trying out|experimenting with)\b/i,
];

const STABLE_PREFERENCE_HINTS: RegExp[] = [
  /\b(love|loves|loved|like|likes|enjoy|enjoys|prefer|prefers|favorite|hobby|passion|passionate|always|usually|for years|long[- ]term)\b/i,
  /\b(my wife|my husband|my partner|my son|my daughter|my kids|my family)\b/i,
];

function normalizeExtractedMemory(item: unknown): ExtractedMemory | null {
  if (typeof item === "string") {
    const content = item.trim();
    return content.length > 0 ? { content } : null;
  }
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const candidate = [record.content, record.fact, record.memory, record.text].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (typeof candidate !== "string") return null;
  const category =
    typeof record.category === "string" && record.category.trim().length > 0
      ? record.category.trim()
      : undefined;

  const memoryType =
    typeof record.memoryType === "string" && record.memoryType.trim().length > 0
      ? record.memoryType.trim()
      : typeof record.type === "string" && record.type.trim().length > 0
        ? record.type.trim()
        : typeof record.kind === "string" && record.kind.trim().length > 0
          ? record.kind.trim()
          : undefined;

  const retrievalMode =
    typeof record.retrievalMode === "string" && record.retrievalMode.trim().length > 0
      ? record.retrievalMode.trim()
      : typeof record.mode === "string" && record.mode.trim().length > 0
        ? record.mode.trim()
        : undefined;

  const asNumber = (value: unknown): number | undefined => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
  };

  const importanceRaw =
    asNumber(record.importanceScore) ??
    asNumber(record.importance) ??
    asNumber(record.salience);

  const confidenceRaw =
    asNumber(record.confidenceScore) ??
    asNumber(record.confidence);

  const expiresInDaysRaw =
    asNumber(record.expiresInDays) ??
    asNumber(record.ttlDays) ??
    asNumber(record.validForDays);

  const tags =
    Array.isArray(record.tags)
      ? record.tags.filter((value): value is string => typeof value === "string")
      : undefined;

  return {
    content: candidate.trim(),
    category,
    memoryType,
    retrievalMode,
    importanceScore: importanceRaw,
    confidenceScore: confidenceRaw,
    expiresInDays: expiresInDaysRaw,
    tags,
  };
}

function parseCandidateItems(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return [];
  const record = parsed as Record<string, unknown>;
  for (const key of ["memories", "facts", "items", "results", "data"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [parsed];
}

export function parseMemoryExtractionPayload(jsonText: string): ExtractedMemory[] {
  let cleaned = jsonText.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/g, "").replace(/\n?```$/g, "");
  cleaned = cleaned.trim();
  if (!cleaned || cleaned === "[]") return [];

  try {
    const parsed = JSON.parse(cleaned);
    return parseCandidateItems(parsed)
      .map((item) => normalizeExtractedMemory(item))
      .filter((item): item is ExtractedMemory => item !== null);
  } catch {
    const match = cleaned.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]);
      return parseCandidateItems(parsed)
        .map((item) => normalizeExtractedMemory(item))
        .filter((item): item is ExtractedMemory => item !== null);
    } catch {
      return [];
    }
  }
}

export function detectMemoryExclusionRules(source: string): MemoryExclusionRules {
  const exclusionSignal =
    /(don't|do not|never|exclude|avoid|without|keep|leave|out of)\s+.{0,48}(memory|remember|save|store)/i;
  const phoneSignal = /(phone|mobile|telephone|number)/i;
  const emailSignal = /\bemail\b/i;
  const hasExclusionContext = exclusionSignal.test(source);

  return {
    excludePhone: hasExclusionContext && phoneSignal.test(source),
    excludeEmail: hasExclusionContext && emailSignal.test(source),
  };
}

export function shouldExcludeMemoryContent(
  content: string,
  rules: MemoryExclusionRules,
): boolean {
  const text = content.toLowerCase();
  if (rules.excludePhone) {
    if (/\+?\d[\d\s().-]{7,}\d/.test(text)) return true;
    if (/\b(phone|mobile|telephone)\b/.test(text)) return true;
  }
  if (rules.excludeEmail) {
    if (/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/.test(text)) return true;
    if (/\bemail\b/.test(text)) return true;
  }
  return false;
}

export function memoryLikelyUserFact(content: string): boolean {
  const normalized = content.trim();
  if (normalized.length < 8 || normalized.length > 320) return false;
  if (normalized.endsWith("?")) return false;
  if (/^(assistant|model|system)\b/i.test(normalized)) return false;
  if (
    EXPLORATORY_INTENT_PATTERNS.some((pattern) => pattern.test(normalized)) &&
    !STABLE_PREFERENCE_HINTS.some((pattern) => pattern.test(normalized))
  ) {
    return false;
  }
  if (TRANSIENT_OR_META_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return false;
  }
  return true;
}

export function normalizeMemoryContent(content: string): string | null {
  let normalized = content.trim();
  if (normalized.length === 0) return null;
  normalized = normalized
    .replace(/^[-*•]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (normalized.length === 0) return null;

  if (!/[.!?]$/.test(normalized)) normalized += ".";
  return normalized;
}

function tokenizeMemorySimilarity(content: string): string[] {
  return content
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2);
}

export function findDuplicateMemory<T extends { content: string }>(
  candidateContent: string,
  existingMemories: T[],
): T | null {
  const candidate = candidateContent.toLowerCase();
  const candidateTokens = tokenizeMemorySimilarity(candidate);

  for (const memory of existingMemories) {
    const existing = memory.content.toLowerCase();
    const existingTokens = tokenizeMemorySimilarity(existing);
    if (existing === candidate) return memory;
    if (existing.includes(candidate) || candidate.includes(existing)) return memory;

    const existingWords = new Set(existingTokens);
    const candidateWords = new Set(candidateTokens);
    const intersection = new Set(
      [...existingWords].filter((word) => candidateWords.has(word)),
    );
    const union = new Set([...existingWords, ...candidateWords]);
    if (union.size > 0 && intersection.size / union.size >= 0.8) {
      return memory;
    }
  }

  return null;
}

export function isDuplicateMemory(
  candidateContent: string,
  existingMemories: Array<{ content: string }>,
): boolean {
  return findDuplicateMemory(candidateContent, existingMemories) !== null;
}
