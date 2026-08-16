import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { OpenRouterMessage } from "../lib/openrouter";
import {
  assembleContext,
  compareAssemblyToLegacy,
  type AssemblyArtifactCandidate,
  type AssemblyMemoryCandidate,
} from "./context_assembler";
import { scheduleContextAssemblyLog } from "./context_assembly_log_scheduler";
import { branchPathIds } from "./helpers_utils";
import type { ContextMessage } from "./helpers_types";
import { selectRecentMcpInvocationIds } from "../mcp/context_selection";
import {
  prepareParticipantTurn,
  type PreparedParticipantTurn,
  type PreparedTurnCausality,
} from "./prepared_participant_turn";

export interface GenerationContextAssemblyInput {
  ctx: ActionCtx;
  chatId: Id<"chats">;
  userId: string;
  assistantMessageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  participantId: string;
  legacyMessages: OpenRouterMessage[];
  allMessages: ContextMessage[];
  providerContextWindowTokens?: number;
  mode?: "read_path" | "autonomous_discussion" | "collaborative_discussion" | "subagent_child" | "subagent_parent_resume";
  runtimeKind?: "chat_generation" | "autonomous_discussion" | "collaborative_discussion" | "subagent_child" | "subagent_parent_resume" | "scheduled_job";
  causality?: PreparedTurnCausality;
  subagentBatchId?: Id<"subagentBatches">;
  subagentRunId?: Id<"subagentRuns">;
  parentMessageId?: Id<"messages">;
  parentJobId?: Id<"generationJobs">;
  parentToolCallId?: string;
  promotionDecision?: "child_private" | "parent_resume" | "parent_visible" | "audit_only";
}

function shouldRequestExactArtifactRehydration(
  messages: Array<{ role?: string; content?: unknown }>,
): boolean {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  const content = typeof lastUser?.content === "string" ? lastUser.content.toLowerCase() : "";
  return /\b(exact|verbatim|previous csv|same csv|raw output|full result)\b/.test(content);
}

async function rehydrateStoredArtifacts(
  ctx: ActionCtx,
  artifacts: AssemblyArtifactCandidate[],
  artifactIds: Set<string>,
): Promise<{ artifacts: AssemblyArtifactCandidate[]; bytesRead: number; durationMs: number }> {
  const startedAt = Date.now();
  let bytesRead = 0;
  const rehydrated = await Promise.all(artifacts.map(async (artifact) => {
    if (!artifactIds.has(String(artifact._id))) return artifact;
    const storageId = artifact.resultStorageId;
    if (artifact.resultRaw || !storageId) return artifact;
    const blob = await ctx.storage.get(storageId);
    if (!blob) return artifact;
    const resultRaw = await blob.text();
    bytesRead += resultRaw.length;
    return {
      ...artifact,
      resultRaw,
    };
  }));
  return {
    artifacts: rehydrated,
    bytesRead,
    durationMs: Date.now() - startedAt,
  };
}

function normalizeAssemblyQueryResult<T>(
  result: T[] | { rows: T[]; branchExcludedCount?: number; lineageCappedMessageCount?: number },
): { rows: T[]; branchExcludedCount: number; lineageCappedMessageCount: number } {
  if (Array.isArray(result)) {
    return { rows: result, branchExcludedCount: 0, lineageCappedMessageCount: 0 };
  }
  return {
    rows: result.rows,
    branchExcludedCount: result.branchExcludedCount ?? 0,
    lineageCappedMessageCount: result.lineageCappedMessageCount ?? 0,
  };
}

function buildExtraExclusionCounts(
  branchExcludedCount: number,
  lineageCappedMessageCount: number,
): { excludedByBranch?: number; lineageMessagesSkippedByCap?: number } | undefined {
  if (branchExcludedCount <= 0 && lineageCappedMessageCount <= 0) return undefined;
  return {
    ...(branchExcludedCount > 0 ? { excludedByBranch: branchExcludedCount } : {}),
    ...(lineageCappedMessageCount > 0 ? { lineageMessagesSkippedByCap: lineageCappedMessageCount } : {}),
  };
}

export async function prepareRequestContextForGeneration(
  input: GenerationContextAssemblyInput,
): Promise<PreparedParticipantTurn> {
  const messagesById = new Map(input.allMessages.map((message) => [String(message._id), message]));
  const reachableMessageIds = Array.from(
    branchPathIds(String(input.assistantMessageId), messagesById),
  ) as Array<Id<"messages">>;
  const reachableSet = new Set(reachableMessageIds.map(String));
  const mcpInvocationIds = selectRecentMcpInvocationIds(input.allMessages, reachableSet);
  const [toolMemoryQueryRaw, artifactQueryRaw, mcpContexts] = await Promise.all([
    input.ctx.runQuery(internal.tools.artifacts.listToolMemoriesForAssembly, {
      chatId: input.chatId,
      userId: input.userId,
      reachableMessageIds,
      limit: 80,
    }),
    input.ctx.runQuery(internal.tools.artifacts.listArtifactsForAssembly, {
      chatId: input.chatId,
      userId: input.userId,
      reachableMessageIds,
      limit: 80,
    }),
    input.ctx.runQuery(internal.mcp.queries.getInvocationContextsInternal, {
      userId: input.userId,
      invocationIds: mcpInvocationIds,
    }),
  ]);
  const legacyMessagesWithMcp = [
    ...mcpContexts.map((context) => ({
      role: "user" as const,
      content: context.contextText,
    })),
    ...input.legacyMessages,
  ];
  const toolMemoryQuery = normalizeAssemblyQueryResult(toolMemoryQueryRaw);
  const artifactQuery = normalizeAssemblyQueryResult(artifactQueryRaw);
  const toolMemoriesRaw = toolMemoryQuery.rows;
  const rawArtifacts = artifactQuery.rows as AssemblyArtifactCandidate[];
  const branchExcludedCount = toolMemoryQuery.branchExcludedCount + artifactQuery.branchExcludedCount;
  const lineageCappedMessageCount = toolMemoryQuery.lineageCappedMessageCount + artifactQuery.lineageCappedMessageCount;
  const extraExclusionCounts = buildExtraExclusionCounts(branchExcludedCount, lineageCappedMessageCount);
  let toolMemories = toolMemoriesRaw as AssemblyMemoryCandidate[];
  let provenanceResolutions: Array<{
    memoryId: Id<"toolMemories">;
    status: "valid" | "missing" | "repaired" | "unavailable" | "forbidden";
    repairAttempts: number;
  }> = [];
  let provenanceRepairMs = 0;
  const exactRehydrationRequested = shouldRequestExactArtifactRehydration(input.allMessages);

  let assembly = assembleContext({
    chatId: input.chatId,
    messageId: input.assistantMessageId,
    jobId: input.jobId,
    userId: input.userId,
    participantId: input.participantId,
    modelRunId: String(input.jobId),
    legacyMessages: legacyMessagesWithMcp,
    toolMemories,
    rawArtifacts,
    providerContextWindowTokens: input.providerContextWindowTokens,
    exactRehydrationRequested,
    mode: input.mode ?? "read_path",
    extraExclusionCounts,
  });
  const selectedMemoryIds = new Set(assembly.memoryRefs.map((memoryId) => String(memoryId)));
  const provenanceMemoryIds = toolMemories
    .filter((memory) =>
      selectedMemoryIds.has(String(memory._id)) &&
      memory.provenanceLocators != null
    )
    .map((memory) => memory._id);
  if (provenanceMemoryIds.length > 0) {
    const provenanceStartedAt = Date.now();
    const provenanceResolutionResult = await input.ctx.runMutation(
      internal.tools.artifacts.resolveToolMemoryProvenanceForAssembly,
      {
        userId: input.userId,
        memoryIds: provenanceMemoryIds,
        maxRepairAttempts: 2,
      },
    );
    provenanceRepairMs = Date.now() - provenanceStartedAt;
    provenanceResolutions = Array.isArray(provenanceResolutionResult)
      ? provenanceResolutionResult as Array<{
        memoryId: Id<"toolMemories">;
        status: "valid" | "missing" | "repaired" | "unavailable" | "forbidden";
        repairAttempts: number;
      }>
      : [];
    const provenanceByMemoryId = new Map(provenanceResolutions.map((entry) => [String(entry.memoryId), entry]));
    toolMemories = toolMemories.map((memory) => {
      const resolution = provenanceByMemoryId.get(String(memory._id));
      return resolution
        ? {
            ...memory,
            lastResolutionStatus: resolution.status,
            repairAttempts: resolution.repairAttempts,
          }
        : memory;
    });
    assembly = assembleContext({
      chatId: input.chatId,
      messageId: input.assistantMessageId,
      jobId: input.jobId,
      userId: input.userId,
      participantId: input.participantId,
      modelRunId: String(input.jobId),
      legacyMessages: legacyMessagesWithMcp,
      toolMemories,
      rawArtifacts,
      providerContextWindowTokens: input.providerContextWindowTokens,
      exactRehydrationRequested,
      mode: input.mode ?? "read_path",
      extraExclusionCounts,
    });
  }
  const rehydrationArtifactIds = new Set(
    assembly.rehydrationDirectives.map((directive) => String(directive.artifactId)),
  );
  const rehydration = rehydrationArtifactIds.size > 0
    ? await rehydrateStoredArtifacts(input.ctx, rawArtifacts, rehydrationArtifactIds)
    : { artifacts: rawArtifacts, bytesRead: 0, durationMs: 0 };
  const rehydratedArtifacts = rehydration.artifacts as AssemblyArtifactCandidate[];
  if (rehydratedArtifacts !== rawArtifacts) {
    assembly = assembleContext({
      chatId: input.chatId,
      messageId: input.assistantMessageId,
      jobId: input.jobId,
      userId: input.userId,
      participantId: input.participantId,
      modelRunId: String(input.jobId),
      legacyMessages: legacyMessagesWithMcp,
      toolMemories,
      rawArtifacts: rehydratedArtifacts,
      providerContextWindowTokens: input.providerContextWindowTokens,
      exactRehydrationRequested,
      mode: input.mode ?? "read_path",
      extraExclusionCounts,
    });
  }
  const comparison = compareAssemblyToLegacy({
    legacyMessages: legacyMessagesWithMcp,
    assembledMessages: assembly.messages,
  });

  await scheduleContextAssemblyLog(input.ctx, {
    userId: input.userId,
    chatId: input.chatId,
    messageId: input.assistantMessageId,
    jobId: input.jobId,
    visibilityScope: "participant",
    ownerParticipantId: input.participantId,
    ownerModelRunId: String(input.jobId),
    runtimeKind: input.runtimeKind ?? "chat_generation",
    subagentBatchId: input.subagentBatchId,
    subagentRunId: input.subagentRunId,
    parentMessageId: input.parentMessageId,
    parentJobId: input.parentJobId,
    parentToolCallId: input.parentToolCallId,
    promotionDecision: input.promotionDecision,
    mode: input.mode ?? "read_path",
    legacyMessageCount: input.legacyMessages.length,
    assembledMessageCount: assembly.messages.length,
    legacyEstimatedTokens: comparison.legacyEstimatedTokens,
    assembledEstimatedTokens: comparison.assembledEstimatedTokens,
    rawArtifactCount: rehydratedArtifacts.length,
    memoryCount: toolMemories.length,
    rehydratedArtifactCount: assembly.rehydrationDirectives.length,
    rehydratedArtifactBytes: rehydration.bytesRead,
    storageRehydrationMs: rehydration.durationMs,
    provenanceRepairMs,
    provenanceRepairAttempts: provenanceResolutions.reduce(
      (total, resolution) => total + resolution.repairAttempts,
      0,
    ),
    safetyMismatches: assembly.safety.mismatchReasons,
    toolSelectionDrift: comparison.toolSelectionDrift,
    retryDivergence: false,
    branchDivergence: false,
    memoryInclusionDivergence: assembly.memoryRefs.length !== toolMemories.length,
    providerRoutingDivergence: false,
    resolvedPolicyVersion: assembly.policyVersion,
    resolvedPolicySummary: JSON.stringify(assembly.resolvedPolicy),
    excludedReasonCounts: assembly.exclusionSummary,
    graphCandidateCount: assembly.assemblyPlan.graphCandidateCount,
    graphSelectedCount: assembly.assemblyPlan.graphSelectedCount,
    graphQueryMs: assembly.timings.graphQueryMs,
    policyEvaluationMs: assembly.timings.policyEvaluationMs,
    serializationMs: assembly.timings.serializationMs,
    decisionSummary: assembly.assemblyPlan.policyDecisions.join("; "),
  });

  return prepareParticipantTurn(assembly, input.causality);
}

export async function assembleRequestContextForGeneration(
  input: GenerationContextAssemblyInput,
): Promise<OpenRouterMessage[]> {
  const prepared = await prepareRequestContextForGeneration(input);
  return prepared.providerMessages;
}
