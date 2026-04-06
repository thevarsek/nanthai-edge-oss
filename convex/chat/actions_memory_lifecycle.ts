import { Id } from "../_generated/dataModel";

export type MemoryType =
  | "profile"
  | "responsePreference"
  | "workContext"
  | "transient";

export interface MemoryRecordLike {
  _id?: Id<"memories"> | string;
  content: string;
  isPinned?: boolean;
  isPending?: boolean;
  isSuperseded?: boolean;
  createdAt?: number;
  updatedAt?: number;
  lastAccessedAt?: number;
  accessCount?: number;
  memoryType?: string;
  importanceScore?: number;
  confidenceScore?: number;
  reinforcementCount?: number;
  expiresAt?: number;
}

const RESPONSE_PREFERENCE_PATTERNS: RegExp[] = [
  /\b(prefers?|likes?|dislikes?|wants?|does not want|doesn't want|avoid|hates?)\b.*\b(response|responses|answer|answers|tone|format|style)\b/i,
  /\b(concise|brief|short|detailed|thorough|verbose|direct|gentle|formal|casual|bullets?|step[- ]by[- ]step)\b.*\b(response|responses|answer|answers)\b/i,
  /\b(do not|don't|never)\b.*\b(emojis?|fluff|small talk)\b/i,
];

const PROFILE_PATTERNS: RegExp[] = [
  /\b(name is|goes by|pronouns? are|lives? in|located in|based in|from|works? as|job is|role is|occupation is)\b/i,
  /\b(parent|married|children|kids?|allergic|vegetarian|vegan)\b/i,
];

const WORK_CONTEXT_PATTERNS: RegExp[] = [
  /\b(building|working on|maintaining|shipping|launching|developing|implementing)\b/i,
  /\b(project|app|product|codebase|backend|frontend|migration|release|roadmap)\b/i,
];

const TRANSIENT_OR_META_PATTERNS: RegExp[] = [
  /\b(interested in|interest in|thinking about|considering|curious about|looking into|exploring|trying out|experimenting with)\b/i,
  /\b(might|maybe|possibly|probably|for now|right now|today|tonight|tomorrow|this week|this month|recently|just)\b/i,
  /\b(asked about|asking about|talking about|discussing|debugging|troubleshooting)\b/i,
  /\b(in this chat|in this conversation|topic changed|conversation moved)\b/i,
];

const DURABLE_SIGNAL_PATTERNS: RegExp[] = [
  /\b(name is|is named|goes by|is a|is an|has)\b/i,
  /\b(works? (as|at|on)|lives? (in|at)|builds?|maintains?|uses?|owns?)\b/i,
  /\b(prefers|likes|dislikes|enjoys)\b/i,
];

function tokenize(content: string): string[] {
  return content
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function extractResponseLengthPreference(content: string): "concise" | "detailed" | null {
  const normalized = content.toLowerCase();
  if (/\b(concise|brief|short|to the point)\b/.test(normalized)) return "concise";
  if (/\b(detailed|thorough|long|in-depth|verbose)\b/.test(normalized)) return "detailed";
  return null;
}

function extractStableSlot(content: string): { slot: string; value: string } | null {
  const text = content.replace(/^user(?:'s)?\s+/i, "").trim();
  const nameMatch = text.match(/^name is\s+([^.,;]+)/i);
  if (nameMatch) return { slot: "name", value: nameMatch[1].trim().toLowerCase() };

  const locationMatch = text.match(/^(lives in|located in|based in|from)\s+([^.,;]+)/i);
  if (locationMatch) {
    return { slot: "location", value: locationMatch[2].trim().toLowerCase() };
  }

  const roleMatch = text.match(/^(works as|role is|job is|occupation is)\s+([^.,;]+)/i);
  if (roleMatch) return { slot: "role", value: roleMatch[2].trim().toLowerCase() };
  return null;
}

function isLikelyStableIdentityStatement(content: string): boolean {
  const normalized = content.replace(/[.!?]\s*$/, "");
  if (!/^user(?:'s)?\s+is\s+/i.test(normalized)) return false;
  if (TRANSIENT_OR_META_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  if (/\b(building|working on|developing|maintaining|launching|shipping)\b/i.test(normalized)) {
    return false;
  }
  if (/\b(project|app|product|codebase|backend|frontend|migration|roadmap)\b/i.test(normalized)) {
    return false;
  }
  return true;
}

function typePriority(memoryType: string | undefined): number {
  if (memoryType === "responsePreference") return 3;
  if (memoryType === "profile") return 2;
  if (memoryType === "workContext") return 1;
  return 0;
}

function countTokenOverlap(queryText: string, memoryText: string): number {
  const queryTokens = new Set(tokenize(queryText.toLowerCase()));
  if (queryTokens.size === 0) return 0;
  const memoryTokens = new Set(tokenize(memoryText.toLowerCase()));
  if (memoryTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of queryTokens) {
    if (memoryTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(1, queryTokens.size);
}

export function classifyMemoryType(content: string): MemoryType {
  if (TRANSIENT_OR_META_PATTERNS.some((pattern) => pattern.test(content))) {
    return "transient";
  }
  if (RESPONSE_PREFERENCE_PATTERNS.some((pattern) => pattern.test(content))) {
    return "responsePreference";
  }
  if (isLikelyStableIdentityStatement(content)) {
    return "profile";
  }
  if (PROFILE_PATTERNS.some((pattern) => pattern.test(content))) {
    return "profile";
  }
  if (WORK_CONTEXT_PATTERNS.some((pattern) => pattern.test(content))) {
    return "workContext";
  }
  return "transient";
}

export function defaultExpiryForType(type: MemoryType, now: number): number | undefined {
  if (type === "transient") return now + 1000 * 60 * 60 * 24 * 21;
  if (type === "workContext") return now + 1000 * 60 * 60 * 24 * 90;
  return undefined;
}

export function computeLifecycleScores(
  content: string,
  memoryType: MemoryType,
  now = Date.now(),
): {
  memoryType: MemoryType;
  importanceScore: number;
  confidenceScore: number;
  expiresAt?: number;
} {
  const baseImportance =
    memoryType === "responsePreference" ? 0.92 :
    memoryType === "profile" ? 0.88 :
    memoryType === "workContext" ? 0.72 :
    0.42;
  const preferenceBoost =
    /\b(prefers|likes|dislikes|avoid|doesn't like|does not like)\b/i.test(content)
      ? 0.06
      : 0;
  const importanceScore = clamp01(baseImportance + preferenceBoost);

  let confidence = 0.55;
  if (DURABLE_SIGNAL_PATTERNS.some((pattern) => pattern.test(content))) confidence += 0.18;
  if (content.length >= 30 && content.length <= 160) confidence += 0.05;
  if (TRANSIENT_OR_META_PATTERNS.some((pattern) => pattern.test(content))) confidence -= 0.25;
  const confidenceScore = clamp01(confidence);

  return {
    memoryType,
    importanceScore,
    confidenceScore,
    expiresAt: defaultExpiryForType(memoryType, now),
  };
}

export function findConflictingMemory<T extends MemoryRecordLike>(
  candidateContent: string,
  candidateType: MemoryType,
  existingMemories: T[],
): T | null {
  if (candidateType === "responsePreference") {
    const candidatePreference = extractResponseLengthPreference(candidateContent);
    if (!candidatePreference) return null;
    return (
      existingMemories.find((memory) => {
        if ((memory.memoryType ?? "") !== "responsePreference") return false;
        const existingPreference = extractResponseLengthPreference(memory.content);
        return existingPreference !== null && existingPreference !== candidatePreference;
      }) ?? null
    );
  }

  const candidateSlot = extractStableSlot(candidateContent);
  if (!candidateSlot) return null;
  return (
    existingMemories.find((memory) => {
      const existingSlot = extractStableSlot(memory.content);
      if (!existingSlot) return false;
      return (
        existingSlot.slot === candidateSlot.slot &&
        existingSlot.value !== candidateSlot.value
      );
    }) ?? null
  );
}

export function isMemoryExpired(memory: MemoryRecordLike, now = Date.now()): boolean {
  return typeof memory.expiresAt === "number" && memory.expiresAt <= now;
}

export function isMemoryActive(memory: MemoryRecordLike, now = Date.now()): boolean {
  return !memory.isPending && !memory.isSuperseded && !isMemoryExpired(memory, now);
}

export function selectMemoriesForContext<T extends MemoryRecordLike>(
  memories: T[],
  queryText: string,
  limit = 12,
): T[] {
  const now = Date.now();
  const active = memories.filter((memory) => isMemoryActive(memory, now));
  const scored = active
    .map((memory) => {
      const importance = memory.importanceScore ?? 0.5;
      const overlap = countTokenOverlap(queryText, memory.content);
      const accessBoost = Math.min(0.3, (memory.accessCount ?? 0) * 0.03);
      const recencyBoost =
        typeof memory.updatedAt === "number"
          ? Math.max(0, 0.2 - (now - memory.updatedAt) / (1000 * 60 * 60 * 24 * 180))
          : 0;
      const pinnedBoost = memory.isPinned ? 0.35 : 0;
      const rank =
        importance * 1.5 +
        typePriority(memory.memoryType) * 0.45 +
        overlap * 1.4 +
        accessBoost +
        recencyBoost +
        pinnedBoost;
      return { memory, rank };
    })
    .sort((a, b) => b.rank - a.rank);

  const quotas: Record<MemoryType, number> = {
    responsePreference: 5,
    profile: 4,
    workContext: 4,
    transient: 2,
  };
  const selected: T[] = [];
  for (const item of scored) {
    if (selected.length >= limit) break;
    const type = (item.memory.memoryType as MemoryType | undefined) ?? "transient";
    if ((quotas[type] ?? 0) <= 0) continue;
    quotas[type] = Math.max(0, quotas[type] - 1);
    selected.push(item.memory);
  }
  return selected;
}
