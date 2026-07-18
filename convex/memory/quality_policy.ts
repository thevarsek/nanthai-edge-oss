import type { MemoryCategory, MemoryRetrievalMode } from "./shared";

export type MemoryDurability = "durable" | "ongoing" | "oneOff";
export type MemoryEvidenceKind =
  | "explicitFact"
  | "explicitPreference"
  | "longTermGoal"
  | "ongoingContext"
  | "taskInstruction";

export interface EvidenceSpan {
  start: number;
  end: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const FIRST_PERSON_PATTERNS: RegExp[] = [
  /\b(i|i'm|i’m|i've|i’ve|my|mine|we|we're|our|ours)\b/i,
  /\b(io|sono|ho|devo|uso|utilizzo|voglio|vorrei|preferisco|mi piace|sto|mio|mia|miei|mie|noi|nostro|nostra)\b/i,
  /\b(je|j'ai|j’ai|mon|ma|mes|nous|notre|nos)\b/i,
  /\b(ich|mein|meine|wir|unser|unsere)\b/i,
  /\b(yo|tengo|quiero|prefiero|me gusta|nosotros|nuestro|nuestra)\b/i,
];

const EXPLICIT_MEMORY_PATTERNS: RegExp[] = [
  /\b(remember|keep in mind|from now on|always use)\b/i,
  /\b(ricorda|ricordati|tieni a mente|da ora in poi|usa sempre)\b/i,
  /\b(souviens|retiens|garde en mémoire|désormais)\b/i,
  /\b(recuerda|ten en cuenta|a partir de ahora)\b/i,
];

const ONE_OFF_TASK_PATTERNS: RegExp[] = [
  /\b\d+\s*[-–]?\s*(?:\d+\s*)?(slides?|diapositive|posts?|parole|words?|pages?|pagine|tasks?|sub-?tasks?|sotto-?task)\b/i,
  /\b(today|tonight|tomorrow|this (?:week|month)|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i,
  /\b(oggi|stasera|domani|questa (?:settimana|mese)|entro (?:lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica))\b/i,
  /\b(for this (?:answer|response|deck|presentation|document|task)|in this (?:chat|conversation))\b/i,
  /\b(per questa (?:risposta|presentazione|documento|attività)|in questa (?:chat|conversazione))\b/i,
  /\b(?:prepare|create|write|make|generate) (?:me )?(?:a|an|the) (?:deck|presentation|post|email|document|report)\b/i,
  /\b(?:prepara|crea|scrivi|genera) (?:una?|il|la) (?:presentazione|post|email|documento|report)\b/i,
];

const DOMAIN_SCOPED_PREFERENCE_PATTERNS: RegExp[] = [
  /\b(linkedin|deck|presentation|slides?|footer|timestamp|email|report|document|news)\b/i,
  /\b(presentazione|diapositive|fonti|notizie|documento|relazione)\b/i,
];

const GLOBAL_PREFERENCE_PATTERNS: RegExp[] = [
  /\b(global|globally|every conversation|all conversations|from now on|always)\b/i,
  /\b(globale|globalmente|ogni conversazione|tutte le conversazioni|da ora in poi|sempre)\b/i,
  /\b(global|todas las conversaciones|cada conversación|a partir de ahora|siempre)\b/i,
  /\b(global|toutes les conversations|chaque conversation|désormais|toujours)\b/i,
  /\b(global|allen unterhaltungen|jedem gespräch|ab jetzt|immer)\b/i,
];

const CORE_IDENTITY_PATTERNS: RegExp[] = [
  /\b(name is|goes by|preferred name|pronouns? (?:are|is))\b/i,
  /\b(mi chiamo|il mio nome|preferisco essere chiamat[oa]|i miei pronomi)\b/i,
  /\b(je m'appelle|mon nom|mes pronoms)\b/i,
  /\b(me llamo|mi nombre|mis pronombres)\b/i,
];

function normalizeForEvidence(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function normalizeMemoryScore(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const normalized = value > 1 && value <= 10 ? value / 10 : value;
  return Math.max(0, Math.min(1, normalized));
}

export function findUserEvidenceSpan(
  userMessage: string,
  evidenceQuote: string | undefined,
): EvidenceSpan | null {
  if (!evidenceQuote) return null;
  const source = normalizeForEvidence(userMessage);
  const evidence = normalizeForEvidence(evidenceQuote.replace(/^["'“”‘’]+|["'“”‘’]+$/g, ""));
  if (evidence.length < 8) return null;
  const start = source.indexOf(evidence);
  return start < 0 ? null : { start, end: start + evidence.length };
}

export function evidenceOverlaps(span: EvidenceSpan, accepted: EvidenceSpan[]): boolean {
  return accepted.some((existing) => span.start < existing.end && existing.start < span.end);
}

export function evidenceComesFromQuestion(
  userMessage: string,
  span: EvidenceSpan,
): boolean {
  const source = normalizeForEvidence(userMessage);
  const nextBoundary = source.slice(span.end).match(/[.!?]/);
  return nextBoundary?.[0] === "?";
}

export function hasUserAssertionSignal(value: string): boolean {
  return FIRST_PERSON_PATTERNS.some((pattern) => pattern.test(value)) ||
    EXPLICIT_MEMORY_PATTERNS.some((pattern) => pattern.test(value));
}

export function isExplicitMemoryInstruction(value: string): boolean {
  return EXPLICIT_MEMORY_PATTERNS.some((pattern) => pattern.test(value));
}

export function isOneOffTaskContent(value: string): boolean {
  return ONE_OFF_TASK_PATTERNS.some((pattern) => pattern.test(value));
}

export function isDomainScopedPreference(value: string): boolean {
  return DOMAIN_SCOPED_PREFERENCE_PATTERNS.some((pattern) => pattern.test(value));
}

export function isGlobalPreferenceInstruction(value: string): boolean {
  return GLOBAL_PREFERENCE_PATTERNS.some((pattern) => pattern.test(value));
}

export function resolveAutomaticRetrievalMode(args: {
  category: MemoryCategory;
  memoryType: string;
  durability: MemoryDurability;
  content: string;
}): MemoryRetrievalMode {
  if (args.durability !== "durable" || isOneOffTaskContent(args.content)) {
    return "contextual";
  }
  if (args.category === "identity" && CORE_IDENTITY_PATTERNS.some(
    (pattern) => pattern.test(args.content),
  )) {
    return "alwaysOn";
  }
  if (
    (args.category === "writingStyle" || isGlobalPreferenceInstruction(args.content)) &&
    args.memoryType === "responsePreference" &&
    !isDomainScopedPreference(args.content)
  ) {
    return "alwaysOn";
  }
  return "contextual";
}

export function resolveImportRetrievalMode(
  category: MemoryCategory,
  content: string,
): MemoryRetrievalMode {
  if (
    (category === "writingStyle" || isGlobalPreferenceInstruction(content)) &&
    !isDomainScopedPreference(content)
  ) {
    return "alwaysOn";
  }
  if (category === "identity" && CORE_IDENTITY_PATTERNS.some(
    (pattern) => pattern.test(content),
  )) {
    return "alwaysOn";
  }
  return "contextual";
}

export function expiryForDurability(
  durability: MemoryDurability,
  createdAt: number,
): number | undefined {
  if (durability === "ongoing") return createdAt + 90 * DAY_MS;
  if (durability === "oneOff") return createdAt + 14 * DAY_MS;
  return undefined;
}

export function shouldAdmitChatCandidate(args: {
  userMessage: string;
  evidenceQuote?: string;
  durability?: string;
  evidenceKind?: string;
  acceptedEvidence: EvidenceSpan[];
}): { accepted: boolean; reason?: string; span?: EvidenceSpan } {
  const span = findUserEvidenceSpan(args.userMessage, args.evidenceQuote);
  if (!span) return { accepted: false, reason: "missing_user_evidence" };
  if (evidenceOverlaps(span, args.acceptedEvidence)) {
    return { accepted: false, reason: "overlapping_user_evidence" };
  }
  const evidence = args.evidenceQuote ?? "";
  if (evidenceComesFromQuestion(args.userMessage, span)) {
    return { accepted: false, reason: "question_not_assertion" };
  }
  if (!hasUserAssertionSignal(evidence)) {
    return { accepted: false, reason: "not_user_asserted" };
  }
  if (args.durability === "oneOff" || args.evidenceKind === "taskInstruction") {
    return { accepted: false, reason: "one_off_task" };
  }
  if (
    args.durability !== "durable" &&
    args.durability !== "ongoing"
  ) {
    return { accepted: false, reason: "unknown_durability" };
  }
  return { accepted: true, span };
}

export function isEligibleExistingAlwaysOn(args: {
  sourceType?: string;
  isPinned?: boolean;
  category: MemoryCategory;
  memoryType?: string;
  content: string;
}): boolean {
  if (args.sourceType === "manual" || args.isPinned) return true;
  return resolveAutomaticRetrievalMode({
    category: args.category,
    memoryType: args.memoryType ?? "profile",
    durability: "durable",
    content: args.content,
  }) === "alwaysOn";
}

export function isQuestionOnlyUserMessage(content: string): boolean {
  const trimmed = content.trim();
  return trimmed.endsWith("?") && !hasUserAssertionSignal(trimmed);
}

export function isLikelyNonAssertiveUserMessage(content: string): boolean {
  const trimmed = content.trim();
  if (hasUserAssertionSignal(trimmed)) return false;
  if (isQuestionOnlyUserMessage(trimmed)) return true;
  return /^(?:please\s+)?(?:give|show|tell|create|write|prepare|make|generate|help|explain|compare|review|audit|test|do|can|could|would|ok|okay|now)\b/i.test(
    trimmed,
  ) || /^(?:per favore\s+)?(?:dammi|mostrami|dimmi|crea|scrivi|prepara|genera|aiutami|spiega|confronta|rivedi|verifica|ok|ora)\b/i.test(
    trimmed,
  );
}
