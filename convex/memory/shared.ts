import { Id } from "../_generated/dataModel";

export const MEMORY_CATEGORIES = [
  "identity",
  "writingStyle",
  "work",
  "goals",
  "background",
  "relationships",
  "preferences",
  "tools",
  "skills",
  "logistics",
] as const;

export const MEMORY_RETRIEVAL_MODES = [
  "alwaysOn",
  "contextual",
  "disabled",
] as const;

export const MEMORY_SCOPE_TYPES = [
  "allPersonas",
  "selectedPersonas",
] as const;

export const MEMORY_SOURCE_TYPES = [
  "chat",
  "import",
  "manual",
] as const;

export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];
export type MemoryRetrievalMode = (typeof MEMORY_RETRIEVAL_MODES)[number];
export type MemoryScopeType = (typeof MEMORY_SCOPE_TYPES)[number];
export type MemorySourceType = (typeof MEMORY_SOURCE_TYPES)[number];

export interface MemoryRecordLike {
  _id?: Id<"memories"> | string;
  content: string;
  category?: string;
  memoryType?: string;
  retrievalMode?: string;
  scopeType?: string;
  personaIds?: string[];
  sourceType?: string;
  sourceFileName?: string;
  tags?: string[];
  isPinned?: boolean;
  isPending?: boolean;
  isSuperseded?: boolean;
  createdAt?: number;
  updatedAt?: number;
  accessCount?: number;
  importanceScore?: number;
  confidenceScore?: number;
  expiresAt?: number;
}

const WRITING_STYLE_PATTERNS: RegExp[] = [
  /\b(concise|brief|detailed|thorough|direct|formal|casual|bullets?|tone|style|format|spelling)\b/i,
  /\b(emojis?|fluff|small talk|oxford comma|uk spelling|us spelling)\b/i,
];

const RELATIONSHIP_PATTERNS: RegExp[] = [
  /\b(wife|husband|partner|daughter|son|kids?|children|family|mother|father)\b/i,
];

const BACKGROUND_PATTERNS: RegExp[] = [
  /\b(education|degree|university|studied|musician|composer|film|background)\b/i,
];

const SKILL_PATTERNS: RegExp[] = [
  /\b(sql|python|swift|azure|power bi|figma|n8n|chatgpt|claude|gemini|grok|cursor)\b/i,
];

const TOOL_PATTERNS: RegExp[] = [
  /\b(tool|tools|stack|workflow|software|editor|ide|uses)\b/i,
];

const LOGISTICS_PATTERNS: RegExp[] = [
  /\b(based in|lives in|located in|timezone|schedule|availability|travels?|commute)\b/i,
];

const GOAL_PATTERNS: RegExp[] = [
  /\b(goal|aim|trying to|wants to|plans to|building toward|optimi[sz]e)\b/i,
];

function isMemoryCategory(value: string | undefined): value is MemoryCategory {
  return !!value && MEMORY_CATEGORIES.includes(value as MemoryCategory);
}

function isMemoryRetrievalMode(value: string | undefined): value is MemoryRetrievalMode {
  return !!value && MEMORY_RETRIEVAL_MODES.includes(value as MemoryRetrievalMode);
}

function isMemoryScopeType(value: string | undefined): value is MemoryScopeType {
  return !!value && MEMORY_SCOPE_TYPES.includes(value as MemoryScopeType);
}

function isMemorySourceType(value: string | undefined): value is MemorySourceType {
  return !!value && MEMORY_SOURCE_TYPES.includes(value as MemorySourceType);
}

export function defaultRetrievalModeForCategory(
  category: MemoryCategory,
): MemoryRetrievalMode {
  if (category === "writingStyle") return "alwaysOn";
  return "contextual";
}

export function normalizeMemoryCategory(
  category: string | undefined,
  content: string,
  legacyType?: string,
): MemoryCategory {
  if (isMemoryCategory(category)) return category;

  if (legacyType === "responsePreference") return "writingStyle";
  if (legacyType === "workContext") return "work";

  const normalized = content.toLowerCase();
  if (WRITING_STYLE_PATTERNS.some((pattern) => pattern.test(normalized))) return "writingStyle";
  if (RELATIONSHIP_PATTERNS.some((pattern) => pattern.test(normalized))) return "relationships";
  if (BACKGROUND_PATTERNS.some((pattern) => pattern.test(normalized))) return "background";
  if (SKILL_PATTERNS.some((pattern) => pattern.test(normalized))) return "skills";
  if (TOOL_PATTERNS.some((pattern) => pattern.test(normalized))) return "tools";
  if (LOGISTICS_PATTERNS.some((pattern) => pattern.test(normalized))) return "logistics";
  if (GOAL_PATTERNS.some((pattern) => pattern.test(normalized))) return "goals";
  if (legacyType === "profile") return "identity";
  return "work";
}

export function normalizeMemoryRetrievalMode(
  retrievalMode: string | undefined,
  category: MemoryCategory,
  legacyType?: string,
): MemoryRetrievalMode {
  if (isMemoryRetrievalMode(retrievalMode)) return retrievalMode;
  if (legacyType === "responsePreference") return "alwaysOn";
  return defaultRetrievalModeForCategory(category);
}

export function normalizeMemoryScopeType(
  scopeType: string | undefined,
  personaIds: string[] | undefined,
): MemoryScopeType {
  if (isMemoryScopeType(scopeType)) return scopeType;
  return personaIds && personaIds.length > 0 ? "selectedPersonas" : "allPersonas";
}

export function normalizeMemorySourceType(
  sourceType: string | undefined,
): MemorySourceType {
  if (isMemorySourceType(sourceType)) return sourceType;
  return "chat";
}

export function normalizeMemoryRecord<T extends MemoryRecordLike>(
  memory: T,
): T & {
  category: MemoryCategory;
  retrievalMode: MemoryRetrievalMode;
  scopeType: MemoryScopeType;
  personaIds: string[];
  sourceType: MemorySourceType;
  sourceFileName?: string;
  tags: string[];
} {
  const category = normalizeMemoryCategory(
    memory.category,
    memory.content,
    memory.memoryType,
  );
  const retrievalMode = normalizeMemoryRetrievalMode(
    memory.retrievalMode,
    category,
    memory.memoryType,
  );
  const personaIds = Array.isArray(memory.personaIds)
    ? memory.personaIds.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];
  const scopeType = normalizeMemoryScopeType(memory.scopeType, personaIds);
  const resolvedPersonaIds = scopeType === "allPersonas" ? [] : personaIds;
  const sourceType = normalizeMemorySourceType(memory.sourceType);
  const tags = Array.isArray(memory.tags)
    ? memory.tags
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    : [];

  return {
    ...memory,
    category,
    retrievalMode,
    scopeType,
    personaIds: resolvedPersonaIds,
    sourceType,
    sourceFileName:
      typeof memory.sourceFileName === "string" && memory.sourceFileName.trim().length > 0
        ? memory.sourceFileName.trim()
        : undefined,
    tags,
  };
}

export function isMemoryVisibleToPersona(
  memory: Pick<MemoryRecordLike, "scopeType" | "personaIds">,
  personaId?: string | null,
): boolean {
  const normalized = normalizeMemoryRecord({
    content: "",
    ...memory,
  });
  if (normalized.scopeType === "allPersonas") return true;
  if (!personaId) return false;
  return normalized.personaIds.includes(personaId);
}

export function prioritizeAlwaysOnMemories<T extends MemoryRecordLike>(
  memories: T[],
  limit: number,
): T[] {
  return memories
    .slice()
    .sort((lhs, rhs) => {
      const left = normalizeMemoryRecord(lhs);
      const right = normalizeMemoryRecord(rhs);
      const categoryPriority = (value: MemoryCategory) => {
        if (value === "writingStyle") return 3;
        if (value === "identity") return 2;
        return 1;
      };
      const leftRank =
        categoryPriority(left.category) * 10 +
        (left.isPinned ? 5 : 0) +
        (left.importanceScore ?? 0);
      const rightRank =
        categoryPriority(right.category) * 10 +
        (right.isPinned ? 5 : 0) +
        (right.importanceScore ?? 0);
      return rightRank - leftRank;
    })
    .slice(0, limit);
}
