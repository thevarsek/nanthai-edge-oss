"use node";

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  ChatRequestParameters,
  gateParameters,
  OnDelta,
  OnReasoningDelta,
  OpenRouterMessage,
  OpenRouterUsage,
} from "../lib/openrouter";
import {
  buildProgressiveToolRegistry,
  buildRegistryParams,
  extractLoadedSkillsFromConversation,
  extractLoadedSkillsFromLoadSkillResults,
  extractProfilesFromConversation,
  extractProfilesFromLoadSkillResults,
  mergeLoadedSkills,
  patchSameRoundProgressiveToolErrors,
  retrySameRoundProgressiveToolCalls,
} from "../tools/progressive_registry";
import { runGenerationWithCompaction } from "../chat/actions_run_generation_loop";
import type { StreamWriter } from "../chat/stream_writer";
import { GenerationCancelledError, isGenerationCancelledError } from "../chat/generation_helpers";
import { extractGeneratedCharts, extractGeneratedFiles } from "../chat/generated_file_helpers";
import {
  buildSubagentTaskPrompt,
  isSubagentLeaseStale,
  isTerminalSubagentStatus,
  normalizeOpenRouterMessages,
  resolveSnapshotRequireZdr,
  resolveWebSearchToolIntent,
  SUBAGENT_RECOVERY_LEASE_MS,
} from "./shared";
import { SubagentStreamWriter } from "./stream_writer";
import { RecordedToolCall, RecordedToolResult } from "../tools/execute_loop";
import { ToolResult } from "../tools/registry";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import type { LoadedSkillState } from "../tools/progressive_registry_shared";
import { normalizeMessagesForLoadedSkills } from "../chat/loaded_skill_prompt";
import { captureToolRoundArtifacts } from "../tools/artifact_writer";
import { estimatePromptTokens } from "../chat/runtime_graph";
import {
  captureAssistantResponseCompleted,
  captureAssistantResponseContinued,
  captureAssistantResponseFailure,
  captureAssistantResponseStartedEvent,
} from "../chat/generation_analytics";
import type { AnalyticsClientMetadata } from "../analytics/client_metadata";
import { scheduleContextAssemblyLog } from "../chat/context_assembly_log_scheduler";
import { normalizeGenerationError } from "../chat/generation_error";
import {
  assertModelAvailable,
  assertTextGenerationModel,
} from "../lib/openrouter_modality";

interface SubagentConversationSnapshot {
  messages: OpenRouterMessage[];
  totalUsage: OpenRouterUsage | null;
  allToolCalls: RecordedToolCall[];
  allToolResults: RecordedToolResult[];
  loadedSkills: LoadedSkillState[];
  compactionCount: number;
}

const MAX_TOOL_RESULT_STORE_CHARS = 4000;

function truncateForStorage(str: string): string {
  if (str.length <= MAX_TOOL_RESULT_STORE_CHARS) return str;
  return str.slice(0, MAX_TOOL_RESULT_STORE_CHARS) + "…[truncated]";
}

function toRecordedToolResults(
  toolCalls: RecordedToolCall[],
  results: Array<{ toolCallId: string; result: ToolResult }>,
): RecordedToolResult[] {
  return results.map(({ toolCallId, result }) => {
    const matchingCall = toolCalls.find((entry) => entry.id === toolCallId);
    return {
      toolCallId,
      toolName: matchingCall?.name ?? "unknown",
      result: truncateForStorage(
        JSON.stringify(result.success ? result.data : { error: result.error }),
      ),
      isError: result.success ? undefined : true,
    };
  });
}

async function markBatchWaitingAndArrangeParentResume(
  ctx: ActionCtx,
  batchId: Id<"subagentBatches">,
  workflowManaged: boolean,
): Promise<void> {
  if (workflowManaged) {
    await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
      batchId,
      status: "waiting_to_resume",
      expectedCurrentStatus: "running_children",
      continuationScheduledAt: Date.now(),
    });
    return;
  }
  await ctx.runMutation(
    internal.subagents.parent_resume_gate.markBatchWaitingAndArmParentResume,
    { batchId },
  );
}

async function maybeFailStaleStreamingRun(
  ctx: ActionCtx,
  runId: Id<"subagentRuns">,
  workflowManaged = false,
): Promise<boolean> {
  const run = await ctx.runQuery(internal.subagents.queries.getRunInternal, { runId });
  if (!run || run.status !== "streaming" || !isSubagentLeaseStale(run.updatedAt, Date.now())) {
    return false;
  }

  const finalizeResult = await ctx.runMutation(internal.subagents.mutations.finalizeRun, {
    runId,
    status: "failed",
    content: run.content,
    reasoning: run.reasoning,
    usage: run.usage,
    toolCalls: run.toolCalls,
    toolResults: run.toolResults,
    generatedFiles: run.generatedFiles,
    generatedCharts: run.generatedCharts,
    error: "Subagent execution lease expired before reaching a safe checkpoint.",
  });
  const batch = await ctx.runQuery(internal.subagents.queries.getBatchInternal, { batchId: run.batchId });
  const participantSnapshot = batch?.participantSnapshot as {
    participant?: { modelId?: string | null };
  } | undefined;
  const paramsSnapshot = batch?.paramsSnapshot as {
    analytics?: AnalyticsClientMetadata;
    enabledIntegrations?: string[];
  } | undefined;
  if (batch) {
    const error = new Error("Subagent execution lease expired before reaching a safe checkpoint.");
    const modelId = participantSnapshot?.participant?.modelId ?? null;
    const recoveryProperties = {
      subagent_batch_id: String(batch._id),
      subagent_run_id: String(run._id),
      stale_recovery: true,
    };
    if ((run.continuationCount ?? 0) === 0 && run.analyticsStartedAt === undefined) {
      await captureAssistantResponseStartedEvent(ctx, {
        userId: batch.userId,
        chatId: String(batch.chatId),
        messageId: String(batch.parentMessageId),
        jobId: String(batch.parentJobId),
        modelId,
        source: "subagent_child",
        analytics: paramsSnapshot?.analytics,
        participantCount: 1,
        integrationCount: paramsSnapshot?.enabledIntegrations?.length ?? 0,
        properties: recoveryProperties,
      });
    }
    await captureAssistantResponseFailure(ctx, {
      userId: batch.userId,
      chatId: String(batch.chatId),
      messageId: String(batch.parentMessageId),
      jobId: String(batch.parentJobId),
      modelId,
      source: "subagent_child",
      error,
      analytics: paramsSnapshot?.analytics,
      durationMs: typeof run.startedAt === "number" ? Date.now() - run.startedAt : undefined,
      properties: recoveryProperties,
    });
  }
  if (finalizeResult?.allTerminal) {
    await markBatchWaitingAndArrangeParentResume(
      ctx,
      finalizeResult.batchId,
      workflowManaged,
    );
  }
  return true;
}

async function ensureRunActive(ctx: ActionCtx, runId: Id<"subagentRuns">): Promise<void> {
  const run = await ctx.runQuery(internal.subagents.queries.getRunInternal, { runId });
  if (!run || isTerminalSubagentStatus(run.status)) {
    throw new GenerationCancelledError();
  }
  const batch = await ctx.runQuery(internal.subagents.queries.getBatchInternal, { batchId: run.batchId });
  if (!batch || batch.status === "cancelled") {
    throw new GenerationCancelledError();
  }
}

async function ensureFencedRunActive(
  ctx: ActionCtx,
  runId: Id<"subagentRuns">,
  executionAttemptId?: Id<"executionAttempts">,
  executionFence?: number,
): Promise<void> {
  await ensureRunActive(ctx, runId);
  if (executionAttemptId === undefined && executionFence === undefined) return;
  const current = await ctx.runQuery(
    internal.subagents.queries.isRunExecutionCurrent,
    { runId, executionAttemptId, executionFence },
  );
  if (!current) throw new GenerationCancelledError();
}

export async function runSubagentRunHandler(
  ctx: ActionCtx,
  args: {
    runId: Id<"subagentRuns">;
    workflowManaged?: boolean;
    executionAttemptId?: Id<"executionAttempts">;
    executionFence?: number;
  },
): Promise<void> {
  if (
    args.workflowManaged === true
    && (args.executionAttemptId === undefined || args.executionFence === undefined)
  ) {
    throw new Error("SUBAGENT_WORKFLOW_EXECUTION_FENCE_REQUIRED");
  }
  const executionToken = args.executionAttemptId !== undefined
    && args.executionFence !== undefined
    ? {
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
      }
    : {};
  const claimed = await ctx.runMutation(internal.subagents.mutations.claimRunForExecution, {
    runId: args.runId,
    expectedStatuses: ["queued", "waiting_continuation"],
    ...executionToken,
  });
  if (!claimed) {
    await maybeFailStaleStreamingRun(ctx, args.runId, args.workflowManaged === true);
    return;
  }

  const run = await ctx.runQuery(internal.subagents.queries.getRunInternal, { runId: args.runId });
  if (!run) return;
  if (!args.workflowManaged) {
    await ctx.scheduler.runAfter(SUBAGENT_RECOVERY_LEASE_MS, internal.execution.fanout_queues.enqueueSubagentContinuation, {
      runId: args.runId,
    });
  }
  const batch = await ctx.runQuery(internal.subagents.queries.getBatchInternal, { batchId: run.batchId });
  if (!batch) {
    return;
  }
  const paramsSnapshot = batch.paramsSnapshot as {
    enabledIntegrations?: string[];
    webSearchToolEnabled?: boolean;
    requireZdr?: boolean;
    requestParams?: ChatRequestParameters;
    analytics?: AnalyticsClientMetadata;
  };
  const participantSnapshot = batch.participantSnapshot as {
    userId: string;
    chatId?: string;
    participant: { modelId: string };
  } | undefined;
  const startedProperties = {
    subagent_batch_id: String(batch._id),
    subagent_run_id: String(run._id),
  };
  const isContinuationResume = (run.continuationCount ?? 0) > 0;
  const captureStartedIfInitial = async (
    setupPhase: string,
    modelId: string | null,
    extraProperties: Record<string, string | number | boolean | null | undefined> = {},
  ): Promise<boolean> => {
    if (isContinuationResume) return true;
    const shouldCaptureStarted = await ctx.runMutation(internal.subagents.mutations.markRunAnalyticsStarted, {
      runId: run._id,
      ...executionToken,
    }) !== false;
    if (!shouldCaptureStarted) return false;
    await captureAssistantResponseStartedEvent(ctx, {
      userId: batch.userId,
      chatId: String(batch.chatId),
      messageId: String(batch.parentMessageId),
      jobId: String(batch.parentJobId),
      modelId,
      source: "subagent_child",
      analytics: paramsSnapshot.analytics,
      participantCount: 1,
      integrationCount: paramsSnapshot.enabledIntegrations?.length ?? 0,
      properties: {
        ...startedProperties,
        setup_phase: setupPhase,
        ...extraProperties,
      },
    });
    return true;
  };
  if (batch.status === "cancelled") {
    const cancelledModelId = participantSnapshot?.participant.modelId;
    const didCaptureStart = cancelledModelId
      ? await captureStartedIfInitial("batch_cancelled", cancelledModelId)
      : false;
    await ctx.runMutation(internal.subagents.mutations.finalizeRun, {
      runId: run._id,
      ...executionToken,
      status: "cancelled",
      content: run.content,
      reasoning: run.reasoning,
      error: "Subagent batch was cancelled.",
    });
    if (cancelledModelId && didCaptureStart) {
      await captureAssistantResponseFailure(ctx, {
        userId: batch.userId,
        chatId: String(batch.chatId),
        messageId: String(batch.parentMessageId),
        jobId: String(batch.parentJobId),
        modelId: cancelledModelId,
        source: "subagent_child",
        cancelled: true,
        analytics: paramsSnapshot.analytics,
        properties: startedProperties,
      });
    }
    return;
  }
  if (!participantSnapshot?.participant.modelId) {
    const didCaptureStart = await captureStartedIfInitial("snapshot_validation", null);
    if (!didCaptureStart) return;
    const error = new Error("Subagent batch missing participant snapshot.");
    const finalizeResult = await ctx.runMutation(internal.subagents.mutations.finalizeRun, {
      runId: run._id,
      ...executionToken,
      status: "failed",
      content: run.content,
      reasoning: run.reasoning,
      error: error.message,
    });
    if (!finalizeResult) return;
    await captureAssistantResponseFailure(ctx, {
      userId: batch.userId,
      chatId: String(batch.chatId),
      messageId: String(batch.parentMessageId),
      jobId: String(batch.parentJobId),
      source: "subagent_child",
      error,
      analytics: paramsSnapshot.analytics,
      properties: startedProperties,
    });
    if (finalizeResult?.allTerminal) {
      await markBatchWaitingAndArrangeParentResume(
        ctx,
        finalizeResult.batchId,
        args.workflowManaged === true,
      );
    }
    return;
  }
  const modelId = participantSnapshot.participant.modelId;
  const didCaptureStart = await captureStartedIfInitial("preflight", modelId);
  if (!didCaptureStart) return;

  let apiKey: string;
  let caps: {
    supportedParameters?: string[];
    hasImageGeneration?: boolean;
    hasVideoGeneration?: boolean;
    hasAudioOutput?: boolean;
    hasReasoning?: boolean;
    contextLength?: number;
  } | null;
  let accountCapabilities: { isPro?: boolean } | null;
  try {
    await ensureFencedRunActive(
      ctx,
      run._id,
      args.executionAttemptId,
      args.executionFence,
    );
    apiKey = await getRequiredUserOpenRouterApiKey(ctx, batch.userId);
    caps = await ctx.runQuery(internal.chat.queries.getModelCapabilities, { modelId });
    accountCapabilities = await ctx.runQuery(
      internal.capabilities.queries.getAccountCapabilitiesInternal,
      { userId: participantSnapshot.userId },
    );
  } catch (error) {
    const errorMessage = normalizeGenerationError(error).message;
    const status = isGenerationCancelledError(error) ? "cancelled" : "failed";
    const finalizeResult = await ctx.runMutation(internal.subagents.mutations.finalizeRun, {
      runId: run._id,
      ...executionToken,
      status,
      content: run.content,
      reasoning: run.reasoning,
      error: errorMessage,
    });
    if (!finalizeResult) return;
    await captureAssistantResponseFailure(ctx, {
      userId: batch.userId,
      chatId: String(batch.chatId),
      messageId: String(batch.parentMessageId),
      jobId: String(batch.parentJobId),
      modelId,
      source: "subagent_child",
      error,
      cancelled: status === "cancelled",
      analytics: paramsSnapshot.analytics,
      properties: startedProperties,
    });
    if (finalizeResult?.allTerminal) {
      await markBatchWaitingAndArrangeParentResume(
        ctx,
        finalizeResult.batchId,
        args.workflowManaged === true,
      );
    }
    return;
  }
  const isProUser = accountCapabilities?.isPro ?? false;
  const snapshot = run.conversationSnapshot as SubagentConversationSnapshot | undefined;
  const liveToolCalls: RecordedToolCall[] = [...(snapshot?.allToolCalls ?? run.toolCalls ?? [])];
  const liveToolResults: RecordedToolResult[] = [...(snapshot?.allToolResults ?? run.toolResults ?? [])];
  const messages: OpenRouterMessage[] = snapshot?.messages
    ? normalizeOpenRouterMessages(snapshot.messages)
    : [
        ...normalizeOpenRouterMessages(batch.childConversationSeed),
        {
          role: "user",
          content: buildSubagentTaskPrompt({ title: run.title, prompt: run.taskPrompt }),
        },
      ];
  const requireZdr = resolveSnapshotRequireZdr(paramsSnapshot);
  const restoredProfiles = extractProfilesFromConversation(messages);
  const webSearchToolEnabled = resolveWebSearchToolIntent(paramsSnapshot);
  const modelSupportsTools = caps?.supportedParameters?.includes("tools") ?? false;
  let loadedSkills = mergeLoadedSkills(
    snapshot?.loadedSkills,
    extractLoadedSkillsFromConversation(messages),
  );
  // Snapshots already store normalized messages, but re-running normalization
  // keeps seed and resume paths aligned and self-heals older/raw transcripts.
  const normalizedMessages = normalizeMessagesForLoadedSkills(
    messages,
    loadedSkills,
  );
  const toolRegistry = buildProgressiveToolRegistry({
    enabledIntegrations: paramsSnapshot.enabledIntegrations,
    isPro: isProUser,
    allowSubagents: false,
    activeProfiles: restoredProfiles,
    webSearchToolEnabled,
  });
  const shouldUseMaterializedWebSearch =
    webSearchToolEnabled && !toolRegistry.isEmpty && modelSupportsTools;
  const rawParams = {
    ...(paramsSnapshot.requestParams ?? {}),
    webSearchEnabled: webSearchToolEnabled && !shouldUseMaterializedWebSearch,
    ...buildRegistryParams(toolRegistry),
  };
  const gatedParams = gateParameters(
    rawParams,
    caps?.supportedParameters,
    caps?.hasImageGeneration,
    caps?.hasReasoning,
  );
  const activeProfiles = new Set(restoredProfiles);
  const writer = new SubagentStreamWriter({
    ctx,
    runId: run._id,
    beforePatch: async () => ensureFencedRunActive(
      ctx,
      run._id,
      args.executionAttemptId,
      args.executionFence,
    ),
    ...executionToken,
    initialContent: run.content ?? "",
    initialReasoning: run.reasoning ?? "",
  });
  let deltaEventsSinceCancelCheck = 0;

  // Shared tool execution context — workspace sandbox is lazily created on
  // first workspace tool call. Cleanup is handled in the finally block.
  const subagentToolCtx: import("../tools/registry").ToolExecutionContext = {
    ctx,
    userId: participantSnapshot.userId,
    chatId: participantSnapshot.chatId ?? String(batch.chatId),
    jobId: String(batch.parentJobId),
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
    modelId,
    requireZdr,
  };

  try {
    assertModelAvailable({
      modelId,
      capabilities: caps,
      feature: "Subagent execution",
    });
    assertTextGenerationModel({
      feature: "Subagent execution",
      hasImageGeneration: caps?.hasImageGeneration,
      hasVideoGeneration: caps?.hasVideoGeneration,
      hasAudioOutput: caps?.hasAudioOutput,
    });
    const requestTokenEstimate = estimatePromptTokens(normalizedMessages);
    await scheduleContextAssemblyLog(ctx, {
      userId: batch.userId,
      chatId: batch.chatId,
      messageId: batch.parentMessageId,
      jobId: batch.parentJobId,
      visibilityScope: "participant",
      ownerParticipantId: `${modelId}:subagent:${run._id}`,
      ownerModelRunId: String(run._id),
      runtimeKind: "subagent_child",
      subagentBatchId: batch._id,
      subagentRunId: run._id,
      parentMessageId: batch.parentMessageId,
      parentJobId: batch.parentJobId,
      parentToolCallId: batch.toolCallId,
      promotionDecision: "child_private",
      mode: "subagent_child",
      legacyMessageCount: normalizedMessages.length,
      assembledMessageCount: normalizedMessages.length,
      legacyEstimatedTokens: requestTokenEstimate,
      assembledEstimatedTokens: requestTokenEstimate,
      rawArtifactCount: 0,
      memoryCount: 0,
      rehydratedArtifactCount: 0,
      rehydratedArtifactBytes: 0,
      storageRehydrationMs: 0,
      provenanceRepairMs: 0,
      provenanceRepairAttempts: 0,
      safetyMismatches: [],
      toolSelectionDrift: false,
      retryDivergence: false,
      branchDivergence: false,
      memoryInclusionDivergence: false,
      providerRoutingDivergence: false,
      resolvedPolicyVersion: "m38.policy.v1",
      resolvedPolicySummary: "subagent child private request boundary",
      excludedReasonCounts: {},
      graphCandidateCount: 0,
      graphSelectedCount: 0,
      graphQueryMs: 0,
      policyEvaluationMs: 0,
      serializationMs: 0,
      decisionSummary: "subagent child request assembled from child seed; private tool artifacts captured under child runtime owner",
    });
    const callbacks: { onDelta: OnDelta; onReasoningDelta: OnReasoningDelta } = {
      onDelta: async (delta) => {
        await writer.handleContentDeltaBoundary(delta.length);
        await writer.appendContent(delta);
        await writer.patchContentIfNeeded();
        deltaEventsSinceCancelCheck += 1;
        if (deltaEventsSinceCancelCheck % 10 === 0) {
          await ensureFencedRunActive(
            ctx,
            run._id,
            args.executionAttemptId,
            args.executionFence,
          );
        }
      },
      onReasoningDelta: async (delta) => {
        await writer.appendReasoning(delta);
        await writer.patchReasoningIfNeeded(writer.hasSeenContentDelta);
      },
    };

    const result = await runGenerationWithCompaction({
      apiKey,
      model: modelId,
      messages: normalizedMessages,
      params: gatedParams,
      callbacks,
      retryConfig: {
        emptyStreamRetries: 2,
        emptyStreamBackoffs: [500, 1500],
        fallbackModel: undefined,
      },
      toolRegistry,
      toolCtx: subagentToolCtx,
      onToolRoundStart: async (_round, _toolCalls) => {
        await ensureFencedRunActive(
          ctx,
          run._id,
          args.executionAttemptId,
          args.executionFence,
        );
        for (const toolCall of _toolCalls) {
          liveToolCalls.push({
            id: toolCall.id,
            name: toolCall.function.name,
            arguments: truncateForStorage(toolCall.function.arguments),
          });
        }
        await ctx.runMutation(internal.subagents.mutations.updateRunStreaming, {
          runId: run._id,
          ...executionToken,
          status: "streaming",
          toolCalls: liveToolCalls,
        });
      },
      onToolRoundComplete: async (_round, roundResults) => {
        await ensureFencedRunActive(
          ctx,
          run._id,
          args.executionAttemptId,
          args.executionFence,
        );
        const recordedResults = toRecordedToolResults(liveToolCalls, roundResults);
        liveToolResults.push(...recordedResults);
        await ctx.runMutation(internal.subagents.mutations.updateRunStreaming, {
          runId: run._id,
          ...executionToken,
          toolCalls: liveToolCalls,
          toolResults: liveToolResults,
          generatedFiles: extractGeneratedFiles(liveToolResults),
          generatedCharts: extractGeneratedCharts(liveToolResults),
        });
      },
      onToolArtifacts: async (round, toolCalls, results) => {
        await ensureFencedRunActive(
          ctx,
          run._id,
          args.executionAttemptId,
          args.executionFence,
        );
        await captureToolRoundArtifacts({
          ctx,
          metadata: {
            userId: batch.userId,
            chatId: batch.chatId,
            messageId: batch.parentMessageId,
            jobId: batch.parentJobId,
            sourceUserMessageId: batch.sourceUserMessageId,
            runtimeKind: "subagent_child",
            subagentBatchId: batch._id,
            subagentRunId: run._id,
            parentMessageId: batch.parentMessageId,
            parentJobId: batch.parentJobId,
            parentToolCallId: batch.toolCallId,
            promotionDecision: "child_private",
            ownerParticipantId: `${modelId}:subagent:${run._id}`,
            ownerModelRunId: String(run._id),
            runtime: "subagent",
            visibilityScope: "participant",
            runtimeIsolationPolicy: "isolated",
            activeProfiles: Array.from(activeProfiles),
            executionAttemptId: args.executionAttemptId,
            executionFence: args.executionFence,
          },
          round,
          toolCalls,
          results,
        });
      },
      onPrepareNextTurn: async (_round, toolCalls, results, conversationMessages) => {
        await ensureFencedRunActive(
          ctx,
          run._id,
          args.executionAttemptId,
          args.executionFence,
        );
        const newProfiles = extractProfilesFromLoadSkillResults(toolCalls, results);
        loadedSkills = mergeLoadedSkills(
          loadedSkills,
          extractLoadedSkillsFromLoadSkillResults(toolCalls, results),
        );
        const normalizedNextMessages = normalizeMessagesForLoadedSkills(
          conversationMessages,
          loadedSkills,
        );
        let changed = false;
        for (const profile of newProfiles) {
          if (!activeProfiles.has(profile)) {
            activeProfiles.add(profile);
            changed = true;
          }
        }
        if (!changed) {
          return {
            messages: normalizedNextMessages,
          };
        }

        const registry = buildProgressiveToolRegistry({
          enabledIntegrations: paramsSnapshot.enabledIntegrations,
          isPro: isProUser,
          allowSubagents: false,
          activeProfiles: Array.from(activeProfiles),
          webSearchToolEnabled,
        });
        const nextShouldUseMaterializedWebSearch =
          webSearchToolEnabled && !registry.isEmpty && modelSupportsTools;
        await retrySameRoundProgressiveToolCalls(
          toolCalls,
          results,
          registry,
          {
            ctx,
            userId: participantSnapshot.userId,
            chatId: participantSnapshot.chatId ?? String(batch.chatId),
            modelId,
            requireZdr,
          },
        );
        patchSameRoundProgressiveToolErrors(toolCalls, results, registry);

        return {
          registry,
          messages: normalizedNextMessages,
          params: gateParameters(
            {
              ...gatedParams,
              webSearchEnabled: webSearchToolEnabled && !nextShouldUseMaterializedWebSearch,
              ...buildRegistryParams(registry),
            },
            caps?.supportedParameters,
            caps?.hasImageGeneration,
            caps?.hasReasoning,
          ),
        };
      },
      modelContextLimit: caps?.contextLength ?? 128_000,
      // SubagentStreamWriter and StreamWriter intentionally share the same
      // runtime surface. This stays casted until the chat/subagent writers are
      // unified behind a shared interface.
      writer: writer as unknown as StreamWriter,
      actionStartTime: Date.now(),
      allowContinuationHandoff: true,
      maxToolRoundsPerInvocation: 1,
      initialTotalUsage: snapshot?.totalUsage ?? null,
      initialToolCalls: snapshot?.allToolCalls ?? [],
      initialToolResults: snapshot?.allToolResults ?? [],
      initialCompactionCount: snapshot?.compactionCount ?? 0,
      requireZdr,
    });

    await ensureFencedRunActive(
      ctx,
      run._id,
      args.executionAttemptId,
      args.executionFence,
    );

    // M23: Store ancillary compaction costs against the parent message.
    for (const cu of result.compactionUsages) {
      await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
        messageId: batch.parentMessageId,
        chatId: batch.chatId,
        userId: batch.userId,
        modelId: cu.modelId,
        promptTokens: cu.usage.promptTokens,
        completionTokens: cu.usage.completionTokens,
        totalTokens: cu.usage.totalTokens,
        cost: cu.usage.cost ?? undefined,
        source: "compaction",
        generationId: cu.generationId ?? undefined,
      });
    }

    await writer.flush();
    if (result.continuation) {
      const nextContinuationCount = (run.continuationCount ?? 0) + 1;
      const continuationLoadedSkills = loadedSkills;

      await ctx.runMutation(internal.subagents.mutations.checkpointRunContinuation, {
        runId: run._id,
        ...executionToken,
        content: writer.totalContent || undefined,
        reasoning: writer.totalReasoning || undefined,
        usage: result.totalUsage ?? undefined,
        toolCalls: result.allToolCalls.length > 0 ? result.allToolCalls : undefined,
        toolResults: result.allToolResults.length > 0 ? result.allToolResults : undefined,
        continuationCount: nextContinuationCount,
        conversationSnapshot: {
          messages: normalizeMessagesForLoadedSkills(
            result.continuation.messages,
            continuationLoadedSkills,
          ),
          totalUsage: result.totalUsage,
          allToolCalls: result.allToolCalls,
          allToolResults: result.allToolResults,
          loadedSkills: continuationLoadedSkills,
          compactionCount: result.compactionCount,
        } satisfies SubagentConversationSnapshot,
      });
      await captureAssistantResponseContinued(ctx, {
        userId: batch.userId,
        chatId: String(batch.chatId),
        messageId: String(batch.parentMessageId),
        jobId: String(batch.parentJobId),
        modelId,
        source: "subagent_child",
        usage: result.totalUsage,
        analytics: paramsSnapshot.analytics,
        participantCount: 1,
        openrouterGenerationId: result.streamResult.generationId ?? null,
        properties: {
          subagent_batch_id: String(batch._id),
          subagent_run_id: String(run._id),
          continuation_count: nextContinuationCount,
        },
      });
      if (!args.workflowManaged) {
        await ctx.scheduler.runAfter(0, internal.execution.fanout_queues.enqueueSubagentContinuation, {
          runId: run._id,
        });
      }
      return;
    }

    const finalContent = writer.totalContent.trim() || result.streamResult.content.trim() || "[No response received from subagent]";
    const finalizeResult = await ctx.runMutation(internal.subagents.mutations.finalizeRun, {
      runId: run._id,
      ...executionToken,
      status: "completed",
      content: finalContent,
      reasoning: result.streamResult.reasoning || writer.totalReasoning || undefined,
      usage: result.totalUsage ?? result.streamResult.usage ?? undefined,
      toolCalls: result.allToolCalls.length > 0 ? result.allToolCalls : undefined,
      toolResults: result.allToolResults.length > 0 ? result.allToolResults : undefined,
      generatedFiles: extractGeneratedFiles(result.allToolResults),
      generatedCharts: extractGeneratedCharts(result.allToolResults),
    });
    if (!finalizeResult) return;

    // M23: Track subagent generation cost against the parent message using the
    // subagent's own modelId so ancillary cost breakdowns reflect the actual
    // model that generated this child run.
    const subagentUsage = result.totalUsage ?? result.streamResult.usage;
    if (subagentUsage) {
      await ctx.scheduler.runAfter(0, internal.chat.mutations.storeAncillaryCost, {
        messageId: batch.parentMessageId,
        chatId: batch.chatId,
        userId: batch.userId,
        modelId,
        promptTokens: subagentUsage.promptTokens,
        completionTokens: subagentUsage.completionTokens,
        totalTokens: subagentUsage.totalTokens,
        cost: subagentUsage.cost ?? undefined,
        source: "subagent",
        generationId: result.streamResult.generationId ?? undefined,
      });
    }
    await captureAssistantResponseCompleted(ctx, {
      userId: batch.userId,
      chatId: String(batch.chatId),
      messageId: String(batch.parentMessageId),
      jobId: String(batch.parentJobId),
      modelId,
      source: "subagent_child",
      usage: subagentUsage,
      analytics: paramsSnapshot.analytics,
      openrouterGenerationId: result.streamResult.generationId ?? null,
      properties: {
        subagent_batch_id: String(batch._id),
        subagent_run_id: String(run._id),
      },
    });

    if (finalizeResult?.allTerminal) {
      await markBatchWaitingAndArrangeParentResume(
        ctx,
        finalizeResult.batchId,
        args.workflowManaged === true,
      );
    }
  } catch (error) {
    const errorMessage = normalizeGenerationError(error).message;
    const status = isGenerationCancelledError(error) ? "cancelled" : "failed";
    const finalizeResult = await ctx.runMutation(internal.subagents.mutations.finalizeRun, {
      runId: run._id,
      ...executionToken,
      status,
      content: writer.totalContent || undefined,
      reasoning: writer.totalReasoning || undefined,
      error: errorMessage,
    });
    if (!finalizeResult) return;
    await captureAssistantResponseFailure(ctx, {
      userId: batch.userId,
      chatId: String(batch.chatId),
      messageId: String(batch.parentMessageId),
      jobId: String(batch.parentJobId),
      modelId,
      source: "subagent_child",
      error,
      cancelled: status === "cancelled",
      analytics: paramsSnapshot.analytics,
      properties: {
        subagent_batch_id: String(batch._id),
        subagent_run_id: String(run._id),
      },
    });
    if (finalizeResult?.allTerminal) {
      await markBatchWaitingAndArrangeParentResume(
        ctx,
        finalizeResult.batchId,
        args.workflowManaged === true,
      );
    }
  } finally {
    // Stop the workspace (just-bash) sandbox — it is per-generation, not persistent.
    await subagentToolCtx.workspaceSandboxCleanup?.().catch(() => {});
    // NOTE: The Vercel sandbox is NOT stopped here. It is a per-chat persistent
    // session (shared with the parent generation) that must survive across turns.
    // Idle VMs are reaped by the cleanStaleSandboxSessions cron.
  }
}
