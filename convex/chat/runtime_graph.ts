import type { Id } from "../_generated/dataModel";

export const CONTEXT_ASSEMBLER_VERSION = "m38.assembler.v1";
export const CONTEXT_POLICY_VERSION = "m38.policy.v1";

export const CONTEXT_CLASSES = [
  "conversational",
  "operational",
  "epistemic",
  "provenance",
  "policy",
  "recovery",
  "planning",
] as const;

export type ContextClass = typeof CONTEXT_CLASSES[number];

export type VisibilityScope =
  | "participant"
  | "shared_participants"
  | "branch"
  | "conversation"
  | "audit_only";

export type RuntimeIsolationPolicy =
  | "isolated"
  | "shared_readonly"
  | "shared_mutable"
  | "audit_only";

export type FreshnessClass =
  | "volatile"
  | "session"
  | "bounded"
  | "durable"
  | "permanent";

export type PromotionPolicy =
  | "transient"
  | "candidate"
  | "durable"
  | "audit_only";

export type ConfidenceSource =
  | "tool"
  | "model"
  | "deterministic"
  | "inferred"
  | "user_asserted"
  | "composite";

export interface RuntimeOwner {
  visibilityScope?: VisibilityScope;
  runtimeIsolationPolicy?: RuntimeIsolationPolicy;
  ownerParticipantId?: string;
  ownerModelRunId?: string;
  sharedWithParticipants?: string[];
}

export interface ResolvedAssemblyPolicy {
  policyVersion: string;
  assemblerVersion: string;
  visibilityScope: VisibilityScope;
  runtimeIsolationPolicy: RuntimeIsolationPolicy;
  allowedContextClasses: ContextClass[];
  promotionRules: string[];
  freshnessRules: string[];
  contradictionRules: string[];
  confidenceRules: string[];
  privacyRules: string[];
  rehydrationRules: string[];
  retentionRules: string[];
  contextAllocation: {
    providerContextWindowTokens?: number;
    maxGraphCandidates: number;
    maxRawRehydrationBytes: number;
    maxAssemblyMs: number;
    maxRepairAttempts: number;
  };
  continuationMode?: "v1" | "v2";
}

export interface AssemblySubject {
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  userId: string;
  participantId?: string;
  modelRunId?: string;
  providerContextWindowTokens?: number;
  continuationMode?: "v1" | "v2";
}

export function resolveAssemblyPolicy(
  subject: AssemblySubject,
): ResolvedAssemblyPolicy {
  return Object.freeze({
    policyVersion: CONTEXT_POLICY_VERSION,
    assemblerVersion: CONTEXT_ASSEMBLER_VERSION,
    visibilityScope: "participant",
    runtimeIsolationPolicy: "isolated",
    allowedContextClasses: [...CONTEXT_CLASSES],
    promotionRules: ["durable and candidate memories may be selected; audit_only is never model-visible"],
    freshnessRules: ["stale volatile and bounded memories are marked stale or omitted"],
    contradictionRules: ["conflicts are preserved with provenance; superseded memories are omitted by default"],
    confidenceRules: ["deterministic, tool, and user_asserted confidence outrank model-only summaries"],
    privacyRules: ["audit_only, google_data, oauth_data, and secret_adjacent raw payloads require explicit policy"],
    rehydrationRules: ["rehydrate only selected exact-detail artifacts within byte bounds"],
    retentionRules: ["referenced artifacts and unresolved recovery state are not GC eligible"],
    contextAllocation: {
      providerContextWindowTokens: subject.providerContextWindowTokens,
      maxGraphCandidates: 80,
      maxRawRehydrationBytes: 96_000,
      maxAssemblyMs: 200,
      maxRepairAttempts: 2,
    },
    continuationMode: subject.continuationMode,
  } satisfies ResolvedAssemblyPolicy);
}

export function canRuntimeOwnerSee(
  currentParticipantId: string | undefined,
  owner: RuntimeOwner,
): boolean {
  const scope = owner.visibilityScope ?? "participant";
  if (scope === "audit_only") return false;
  if (scope === "conversation" || scope === "branch") return true;
  if (scope === "shared_participants") {
    return currentParticipantId != null &&
      (owner.sharedWithParticipants ?? []).includes(currentParticipantId);
  }
  if (!owner.ownerParticipantId) return true;
  return owner.ownerParticipantId === currentParticipantId;
}

export function isMemoryStale(memory: {
  freshnessClass?: FreshnessClass;
  staleAfter?: number;
  observedAt?: number;
}, now = Date.now()): boolean {
  if (memory.freshnessClass === "permanent" || memory.freshnessClass === "durable") {
    return false;
  }
  return memory.staleAfter != null && memory.staleAfter <= now;
}

export function estimatePromptTokens(messages: Array<{ content?: unknown }>): number {
  const chars = messages.reduce((total, message) => {
    const content = message.content;
    if (typeof content === "string") return total + content.length;
    try {
      return total + JSON.stringify(content ?? "").length;
    } catch {
      return total;
    }
  }, 0);
  return Math.ceil(chars / 4);
}
