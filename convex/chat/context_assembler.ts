import type { Id } from "../_generated/dataModel";
import type { OpenRouterMessage } from "../lib/openrouter";
import {
  canRuntimeOwnerSee,
  estimatePromptTokens,
  isMemoryStale,
  resolveAssemblyPolicy,
  type FreshnessClass,
  type ResolvedAssemblyPolicy,
  type VisibilityScope,
} from "./runtime_graph";
import type { ProvenanceLocators, ProvenanceResolutionStatus } from "./provenance_repair";

type ExclusionReason =
  | "excludedByPolicy"
  | "excludedByBudget"
  | "excludedByVisibility"
  | "excludedByOwnership"
  | "excludedByPrivacy"
  | "excludedByBranch"
  | "lineageMessagesSkippedByCap"
  | "excludedByFreshness"
  | "excludedByContradiction"
  | "excludedAsStale"
  | "excludedAsSuperseded";

export interface AssemblyMemoryCandidate {
  _id: Id<"toolMemories">;
  summary: string;
  contextClass: string;
  promotionPolicy: string;
  visibilityScope?: VisibilityScope;
  runtimeIsolationPolicy?: string;
  ownerParticipantId?: string;
  sharedWithParticipants?: string[];
  privacyClassification: string;
  freshnessClass?: FreshnessClass;
  staleAfter?: number;
  requiresRevalidation?: boolean;
  conflictsWith?: Array<Id<"toolMemories">>;
  supersedes?: Array<Id<"toolMemories">>;
  supersededBy?: Array<Id<"toolMemories">>;
  invalidatedBy?: Array<Id<"toolMemories">>;
  sourceArtifactIds?: Array<Id<"toolExecutionArtifacts">>;
  provenanceLocators?: ProvenanceLocators;
  revalidationToolNames?: string[];
  lastResolutionStatus?: ProvenanceResolutionStatus;
  repairAttempts?: number;
  confidence?: number;
  confidenceSource?: string;
  confidenceRationale?: string;
  limitations?: string[];
}

export interface AssemblyArtifactCandidate {
  _id: Id<"toolExecutionArtifacts">;
  toolCallId: string;
  toolName: string;
  status: string;
  resultRaw?: string;
  resultStorageId?: Id<"_storage">;
  resultBytes?: number;
  contextClass?: string;
  visibilityScope?: VisibilityScope;
  runtimeIsolationPolicy?: string;
  ownerParticipantId?: string;
  sharedWithParticipants?: string[];
  privacyClassification?: string;
  budgetStub?: boolean;
}

export interface ContextAssemblyInput {
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  userId: string;
  participantId?: string;
  modelRunId?: string;
  legacyMessages: OpenRouterMessage[];
  toolMemories: AssemblyMemoryCandidate[];
  rawArtifacts: AssemblyArtifactCandidate[];
  providerContextWindowTokens?: number;
  exactRehydrationRequested?: boolean;
  continuationMode?: "v1" | "v2";
  mode?: "shadow" | "read_path" | "autonomous_discussion" | "collaborative_discussion" | "subagent_child" | "subagent_parent_resume";
  extraExclusionCounts?: Partial<Record<ExclusionReason, number>>;
  now?: number;
}

export interface ContextAssemblyResult {
  messages: OpenRouterMessage[];
  policyVersion: string;
  assemblerVersion: string;
  resolvedPolicy: ResolvedAssemblyPolicy;
  artifactRefs: Array<Id<"toolExecutionArtifacts">>;
  memoryRefs: Array<Id<"toolMemories">>;
  rehydrationDirectives: Array<{ artifactId: Id<"toolExecutionArtifacts">; reason: string }>;
  exclusionSummary: Record<ExclusionReason, number>;
  safety: { ok: boolean; mismatchReasons: string[] };
  assemblyPlan: {
    graphCandidateCount: number;
    graphSelectedCount: number;
    policyDecisions: string[];
  };
  provenanceResolutions: Array<{
    memoryId: Id<"toolMemories">;
    status: ProvenanceResolutionStatus;
    repairAttempts?: number;
  }>;
  timings: {
    graphQueryMs: number;
    policyEvaluationMs: number;
    serializationMs: number;
  };
}

function bump(summary: Record<ExclusionReason, number>, reason: ExclusionReason): void {
  summary[reason] += 1;
}

function emptyExclusionSummary(): Record<ExclusionReason, number> {
  return {
    excludedByPolicy: 0,
    excludedByBudget: 0,
    excludedByVisibility: 0,
    excludedByOwnership: 0,
    excludedByPrivacy: 0,
    excludedByBranch: 0,
    lineageMessagesSkippedByCap: 0,
    excludedByFreshness: 0,
    excludedByContradiction: 0,
    excludedAsStale: 0,
    excludedAsSuperseded: 0,
  };
}

function visibleToParticipant(
  participantId: string | undefined,
  candidate: {
    visibilityScope?: VisibilityScope;
    ownerParticipantId?: string;
    sharedWithParticipants?: string[];
  },
): boolean {
  return canRuntimeOwnerSee(participantId, {
    visibilityScope: candidate.visibilityScope,
    ownerParticipantId: candidate.ownerParticipantId,
    sharedWithParticipants: candidate.sharedWithParticipants,
  });
}

function memoryLine(memory: AssemblyMemoryCandidate, stale: boolean): string {
  const staleMarker = stale ? " [stale; revalidate before treating as current]" : "";
  const confidence = memory.confidence != null
    ? ` confidence=${memory.confidence.toFixed(2)} source=${memory.confidenceSource ?? "unknown"}`
    : "";
  const limitations = memory.limitations?.length
    ? ` limitations=${memory.limitations.join("; ")}`
    : "";
  const provenanceDetails = memory.provenanceLocators
    ? ` provenance=${memory.lastResolutionStatus ?? "unavailable"}${memory.revalidationToolNames?.length ? ` revalidate_with=${memory.revalidationToolNames.join(",")}` : ""}${memory.repairAttempts != null ? ` repair_attempts=${memory.repairAttempts}` : ""}`
    : "";
  return `- ${memory.summary}${staleMarker}${confidence}${limitations}${provenanceDetails}`;
}

export function assembleContext(input: ContextAssemblyInput): ContextAssemblyResult {
  const started = Date.now();
  const policy = resolveAssemblyPolicy({
    chatId: input.chatId,
    messageId: input.messageId,
    jobId: input.jobId,
    userId: input.userId,
    participantId: input.participantId,
    modelRunId: input.modelRunId,
    providerContextWindowTokens: input.providerContextWindowTokens,
    continuationMode: input.continuationMode,
  });
  const exclusionSummary = emptyExclusionSummary();
  for (const [reason, count] of Object.entries(input.extraExclusionCounts ?? {}) as Array<[ExclusionReason, number]>) {
    exclusionSummary[reason] += count;
  }
  const selectedMemories: AssemblyMemoryCandidate[] = [];
  const selectedArtifacts: AssemblyArtifactCandidate[] = [];
  const rehydratableArtifactIds = new Set<string>();
  const safetyMismatches: string[] = [];
  const now = input.now ?? Date.now();

  const graphCandidateCount = input.toolMemories.length + input.rawArtifacts.length;
  for (const memory of input.toolMemories) {
    if (memory.promotionPolicy === "audit_only" || memory.promotionPolicy === "transient") {
      bump(exclusionSummary, "excludedByPolicy");
      continue;
    }
    if (
      memory.privacyClassification === "secret_adjacent" ||
      memory.privacyClassification === "oauth_data" ||
      memory.privacyClassification === "google_data"
    ) {
      bump(exclusionSummary, "excludedByPrivacy");
      continue;
    }
    if (!visibleToParticipant(input.participantId, memory)) {
      bump(exclusionSummary, "excludedByOwnership");
      continue;
    }
    if (memory.supersededBy?.length || memory.invalidatedBy?.length) {
      bump(exclusionSummary, "excludedAsSuperseded");
      continue;
    }
    if (selectedMemories.length >= policy.contextAllocation.maxGraphCandidates) {
      bump(exclusionSummary, "excludedByBudget");
      continue;
    }
    if (isMemoryStale(memory, now) && memory.requiresRevalidation) {
      selectedMemories.push(memory);
      bump(exclusionSummary, "excludedAsStale");
      continue;
    }
    selectedMemories.push(memory);
  }

  let rawBytes = 0;
  for (const artifact of input.rawArtifacts) {
    const unresolved = artifact.status === "pending" ||
      artifact.status === "failed" ||
      artifact.status === "deferred";
    if (!unresolved && !input.exactRehydrationRequested) continue;
    if (!visibleToParticipant(input.participantId, artifact)) {
      bump(exclusionSummary, "excludedByOwnership");
      continue;
    }
    if (
      artifact.privacyClassification === "secret_adjacent" ||
      artifact.privacyClassification === "oauth_data" ||
      artifact.privacyClassification === "google_data"
    ) {
      bump(exclusionSummary, "excludedByPrivacy");
      continue;
    }
    const bytes = artifact.resultBytes ?? artifact.resultRaw?.length ?? 0;
    if (rawBytes + bytes > policy.contextAllocation.maxRawRehydrationBytes) {
      bump(exclusionSummary, "excludedByBudget");
      if (unresolved) {
        selectedArtifacts.push({
          ...artifact,
          budgetStub: true,
          resultRaw: undefined,
        });
      }
      continue;
    }
    rawBytes += bytes;
    selectedArtifacts.push(artifact);
    rehydratableArtifactIds.add(String(artifact._id));
  }

  const policyEvaluationMs = Date.now() - started;
  const memoryRefs = selectedMemories.map((memory) => memory._id);
  const artifactRefs = [
    ...selectedArtifacts.map((artifact) => artifact._id),
    ...selectedMemories.flatMap((memory) => memory.sourceArtifactIds ?? []),
  ];
  const messages = [...input.legacyMessages];
  const contextLines = selectedMemories.map((memory) =>
    memoryLine(memory, isMemoryStale(memory, now))
  );
  const provenanceResolutions = selectedMemories
    .filter((memory) => memory.provenanceLocators)
    .map((memory) => ({
      memoryId: memory._id,
      status: memory.lastResolutionStatus ?? "unavailable",
      repairAttempts: memory.repairAttempts,
    }));
  const rawLines = selectedArtifacts.map((artifact) =>
    `- ${artifact.toolName} tool_call_id=${artifact.toolCallId} status=${artifact.status}: ${artifact.budgetStub ? `[raw payload omitted by assembly byte budget artifact_id=${artifact._id}]` : artifact.resultRaw ?? `[raw payload stored separately artifact_id=${artifact._id}]`}`
  );
  if (contextLines.length > 0 || rawLines.length > 0) {
    messages.splice(Math.min(messages.length, 3), 0, {
      role: "system",
      content: [
        "[Internal tool context]",
        ...contextLines,
        ...rawLines,
        "Use this internal context only when relevant. Preserve uncertainty, stale markers, and provenance.",
      ].join("\n"),
    });
  }
  const serializationMs = Date.now() - started - policyEvaluationMs;
  return {
    messages,
    policyVersion: policy.policyVersion,
    assemblerVersion: policy.assemblerVersion,
    resolvedPolicy: policy,
    artifactRefs,
    memoryRefs,
    rehydrationDirectives: selectedArtifacts
      .filter((artifact) => rehydratableArtifactIds.has(String(artifact._id)))
      .map((artifact) => ({
        artifactId: artifact._id,
        reason: artifact.status === "pending" || artifact.status === "failed" || artifact.status === "deferred"
          ? "never-prune recovery state"
          : "exact rehydration requested",
      })),
    exclusionSummary,
    safety: { ok: safetyMismatches.length === 0, mismatchReasons: safetyMismatches },
    assemblyPlan: {
      graphCandidateCount,
      graphSelectedCount: selectedMemories.length + selectedArtifacts.length,
      policyDecisions: [
        `mode=${input.mode ?? "read_path"}`,
        `selected ${selectedMemories.length} tool memories`,
        `rehydrated/protected ${selectedArtifacts.length} raw artifacts`,
      ],
    },
    provenanceResolutions,
    timings: {
      graphQueryMs: 0,
      policyEvaluationMs,
      serializationMs,
    },
  };
}

export function compareAssemblyToLegacy(params: {
  legacyMessages: OpenRouterMessage[];
  assembledMessages: OpenRouterMessage[];
}): {
  legacyEstimatedTokens: number;
  assembledEstimatedTokens: number;
  toolSelectionDrift: boolean;
} {
  return {
    legacyEstimatedTokens: estimatePromptTokens(params.legacyMessages),
    assembledEstimatedTokens: estimatePromptTokens(params.assembledMessages),
    toolSelectionDrift: false,
  };
}
