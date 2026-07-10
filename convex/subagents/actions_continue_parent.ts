"use node";

import { ConvexError } from "convex/values";
import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { MAX_TOOL_ROUNDS } from "../tools/execute_loop";
import { buildProgressiveToolRegistry } from "../tools/progressive_registry";
import { scheduleGenerationContinuation } from "../chat/actions_run_generation_continuation";
import { generateForParticipant } from "../chat/actions_run_generation_participant";
import {
  captureAssistantResponseCompleted,
  captureAssistantResponseContinued,
  captureAssistantResponseFailure,
  captureAssistantResponseStartedEvent,
} from "../chat/generation_analytics";
import type { GenerationContinuationCheckpoint } from "../chat/generation_continuation_shared";
import type { AnalyticsClientMetadata } from "../analytics/client_metadata";
import type { ParticipantConfig } from "../chat/actions_run_generation_types";
import {
  buildParentContinuationPayload,
  isSubagentLeaseStale,
  resolveSnapshotRequireZdr,
  resolveWebSearchToolIntent,
  SUBAGENT_RECOVERY_LEASE_MS,
} from "./shared";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { estimatePromptTokens } from "../chat/runtime_graph";
import type { OpenRouterMessage } from "../lib/openrouter";
import { scheduleContextAssemblyLog } from "../chat/context_assembly_log_scheduler";
import { markGenerationJobAnalyticsStarted } from "../chat/generation_start_guard";
import { normalizeGenerationError } from "../chat/generation_error";

type ParentContinuationRun = Parameters<typeof buildParentContinuationPayload>[0][number];
type ChildGeneratedFile = NonNullable<ParentContinuationRun["generatedFiles"]>[number];
type ChildGeneratedChart = NonNullable<ParentContinuationRun["generatedCharts"]>[number];
type SubagentRunWithArtifacts = {
  generatedFiles?: ChildGeneratedFile[];
  generatedCharts?: ChildGeneratedChart[];
};

function collectGeneratedFiles(runs: SubagentRunWithArtifacts[]): ChildGeneratedFile[] {
  return runs.flatMap((run) => run.generatedFiles ?? []);
}

function collectGeneratedCharts(runs: SubagentRunWithArtifacts[]): ChildGeneratedChart[] {
  return runs.flatMap((run) => run.generatedCharts ?? []);
}

// PRE-3: Check "cancelled" before "completed" so that a cancelled generation
// is not accidentally treated as completed when the message was already
// finalized with partial content (status "completed" in the DB).
function mapParentTerminalState(
  messageStatus?: string,
  jobStatus?: string,
): "completed" | "failed" | "cancelled" | null {
  if (messageStatus === "cancelled" || jobStatus === "cancelled") return "cancelled";
  if (messageStatus === "failed" || jobStatus === "failed" || jobStatus === "timedOut") {
    return "failed";
  }
  if (messageStatus === "completed" || jobStatus === "completed") return "completed";
  return null;
}

type ParentResumeTerminalState = "completed" | "failed" | "cancelled";

type ParentResumeAnalyticsBatch = {
  _id: Id<"subagentBatches">;
  parentMessageId: Id<"messages">;
  parentJobId: Id<"generationJobs">;
  chatId: Id<"chats">;
  userId: string;
  participantSnapshot?: {
    participant?: {
      modelId?: string | null;
    };
  };
  paramsSnapshot?: {
    analytics?: AnalyticsClientMetadata;
  };
};

type ParentResumeTerminalJob = {
  error?: string;
  openrouterGenerationId?: string | null;
};

async function captureRecoveredParentResumeTerminal(
  ctx: ActionCtx,
  batch: ParentResumeAnalyticsBatch,
  terminalState: ParentResumeTerminalState,
  parentJob?: ParentResumeTerminalJob | null,
): Promise<void> {
  const modelId = batch.participantSnapshot?.participant?.modelId ?? null;
  const properties = {
    subagent_batch_id: String(batch._id),
    terminal_state: terminalState,
    recovered_terminal: true,
  };
  if (terminalState === "completed") {
    await captureAssistantResponseCompleted(ctx, {
      userId: batch.userId,
      chatId: String(batch.chatId),
      messageId: String(batch.parentMessageId),
      jobId: String(batch.parentJobId),
      modelId,
      source: "subagent_parent_resume",
      analytics: batch.paramsSnapshot?.analytics,
      openrouterGenerationId: parentJob?.openrouterGenerationId,
      properties,
    });
    return;
  }

  await captureAssistantResponseFailure(ctx, {
    userId: batch.userId,
    chatId: String(batch.chatId),
    messageId: String(batch.parentMessageId),
    jobId: String(batch.parentJobId),
    modelId,
    source: "subagent_parent_resume",
    error: parentJob?.error ? new Error(parentJob.error) : undefined,
    cancelled: terminalState === "cancelled",
    analytics: batch.paramsSnapshot?.analytics,
    properties,
  });
}

async function finalizeParentResumeFailure(
  ctx: ActionCtx,
  batch: {
    _id: Id<"subagentBatches">;
    parentMessageId: Id<"messages">;
    parentJobId: Id<"generationJobs">;
    chatId: Id<"chats">;
    userId: string;
  },
  error: unknown,
): Promise<void> {
  const errorMessage = normalizeGenerationError(error).message;
  await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
    messageId: batch.parentMessageId,
    jobId: batch.parentJobId,
    chatId: batch.chatId,
    content: `Error: ${errorMessage}`,
    status: "failed",
    error: errorMessage,
    userId: batch.userId,
  });
  await ctx.runMutation(internal.chat.mutations.clearGenerationContinuation, {
    jobId: batch.parentJobId,
  });
  await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
    batchId: batch._id,
    status: "failed",
    expectedCurrentStatus: "resuming",
  });
}

async function reconcileOrFailStaleResume(
  ctx: ActionCtx,
  batchId: Id<"subagentBatches">,
): Promise<boolean> {
  const batch = await ctx.runQuery(internal.subagents.queries.getBatchInternal, { batchId });
  if (!batch || batch.status !== "resuming" || !isSubagentLeaseStale(batch.updatedAt, Date.now())) {
    return false;
  }

  const [parentMessage, parentJob, runs] = await Promise.all([
    ctx.runQuery(internal.chat.queries.getMessageInternal, {
      messageId: batch.parentMessageId,
    }),
    ctx.runQuery(internal.chat.queries.getGenerationJobInternal, {
      jobId: batch.parentJobId,
    }),
    ctx.runQuery(internal.subagents.queries.listRunsForBatchInternal, {
      batchId: batch._id,
    }),
  ]);

  const terminalState = mapParentTerminalState(parentMessage?.status, parentJob?.status);
  if (terminalState === "completed") {
    const childGeneratedFiles = collectGeneratedFiles(runs);
    const childGeneratedCharts = collectGeneratedCharts(runs);
    if (childGeneratedFiles.length > 0) {
      await ctx.runMutation(internal.subagents.mutations.attachGeneratedFilesToMessage, {
        messageId: batch.parentMessageId,
        chatId: batch.chatId,
        userId: batch.userId,
        generatedFiles: childGeneratedFiles,
      });
    }
    if (childGeneratedCharts.length > 0) {
      await ctx.runMutation(internal.subagents.mutations.attachGeneratedChartsToMessage, {
        messageId: batch.parentMessageId,
        chatId: batch.chatId,
        userId: batch.userId,
        generatedCharts: childGeneratedCharts,
      });
    }
    await captureRecoveredParentResumeTerminal(ctx, batch, "completed", parentJob);
    await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
      batchId: batch._id,
      status: "completed",
      expectedCurrentStatus: "resuming",
    });
    return true;
  }

  if (terminalState === "failed" || terminalState === "cancelled") {
    await captureRecoveredParentResumeTerminal(ctx, batch, terminalState, parentJob);
    await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
      batchId: batch._id,
      status: terminalState,
      expectedCurrentStatus: "resuming",
    });
    return true;
  }

  const existingContent = typeof parentMessage?.content === "string" && parentMessage.content.trim().length > 0
    ? parentMessage.content
    : "Error: Subagent resume interrupted.";
  await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
    messageId: batch.parentMessageId,
    jobId: batch.parentJobId,
    chatId: batch.chatId,
    content: existingContent,
    status: "failed",
    error: "Subagent resume lease expired before completion.",
    userId: batch.userId,
  });
  await captureRecoveredParentResumeTerminal(ctx, batch, "failed", parentJob);
  await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
    batchId: batch._id,
    status: "failed",
    expectedCurrentStatus: "resuming",
  });
  return true;
}

export async function continueParentAfterSubagentsHandler(
  ctx: ActionCtx,
  args: { batchId: Id<"subagentBatches"> },
): Promise<void> {
  const claimed = await ctx.runMutation(internal.subagents.mutations.claimBatchForResume, {
    batchId: args.batchId,
  });
  if (!claimed) {
    await reconcileOrFailStaleResume(ctx, args.batchId);
    return;
  }

  const batch = await ctx.runQuery(internal.subagents.queries.getBatchInternal, { batchId: args.batchId });
  if (!batch || batch.status !== "resuming") {
    return;
  }
  await ctx.scheduler.runAfter(
    SUBAGENT_RECOVERY_LEASE_MS,
    internal.subagents.actions.continueParentAfterSubagents,
    { batchId: args.batchId },
  );
  const runs = await ctx.runQuery(internal.subagents.queries.listRunsForBatchInternal, { batchId: batch._id });
  const [existingParentMessage, existingParentJob] = await Promise.all([
    ctx.runQuery(internal.chat.queries.getMessageInternal, {
      messageId: batch.parentMessageId,
    }),
    ctx.runQuery(internal.chat.queries.getGenerationJobInternal, {
      jobId: batch.parentJobId,
    }),
  ]);
  const existingTerminalState = mapParentTerminalState(
    existingParentMessage?.status,
    existingParentJob?.status,
  );
  if (existingTerminalState) {
    const childGeneratedFiles = collectGeneratedFiles(runs);
    const childGeneratedCharts = collectGeneratedCharts(runs);
    if (existingTerminalState === "completed" && childGeneratedFiles.length > 0) {
      await ctx.runMutation(internal.subagents.mutations.attachGeneratedFilesToMessage, {
        messageId: batch.parentMessageId,
        chatId: batch.chatId,
        userId: batch.userId,
        generatedFiles: childGeneratedFiles,
      });
    }
    if (existingTerminalState === "completed" && childGeneratedCharts.length > 0) {
      await ctx.runMutation(internal.subagents.mutations.attachGeneratedChartsToMessage, {
        messageId: batch.parentMessageId,
        chatId: batch.chatId,
        userId: batch.userId,
        generatedCharts: childGeneratedCharts,
      });
    }
    await captureRecoveredParentResumeTerminal(ctx, batch, existingTerminalState, existingParentJob);
    await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
      batchId: batch._id,
      status: existingTerminalState,
      expectedCurrentStatus: "resuming",
    });
    if (existingTerminalState === "completed") {
      await ctx.scheduler.runAfter(0, internal.chat.actions.postProcess, {
        chatId: batch.chatId,
        userMessageId: batch.sourceUserMessageId,
        assistantMessageIds: [batch.parentMessageId],
        userId: batch.userId,
      });
    }
    return;
  }

  const participantSnapshot = batch.participantSnapshot as {
    chatId: Id<"chats">;
    userId: string;
    participant: ParticipantConfig;
  };
  const paramsSnapshot = batch.paramsSnapshot as {
    enabledIntegrations?: string[];
    webSearchToolEnabled?: boolean;
    requireZdr?: boolean;
    requestParams?: { webSearchEnabled?: boolean; provider?: { zdr?: boolean } };
    analytics?: AnalyticsClientMetadata;
    analyticsSource?: "chat_generation" | "web_search" | "research_paper" | "scheduled_job";
  };
  const continuationPayload = buildParentContinuationPayload(
    runs.map((run) => ({
      childIndex: run.childIndex,
      title: run.title,
      status: run.status,
      content: run.content,
      error: run.error,
      generatedFiles: run.generatedFiles,
      generatedCharts: run.generatedCharts,
    })),
  );

  const requestMessages = (batch.resumeConversationSeed as OpenRouterMessage[]).map((message) => {
    if (message.role === "tool" && message.tool_call_id === batch.toolCallId) {
      return {
        ...message,
        content: JSON.stringify(continuationPayload),
      };
    }
    return message;
  });
  const rawResumeRefs = await ctx.runQuery(internal.tools.artifacts.listSubagentRuntimeRefsForResume, {
    userId: batch.userId,
    batchId: batch._id,
    limit: 200,
  }) as Partial<{
    artifactRefs: string[];
    memoryRefs: string[];
    childPrivateArtifactCount: number;
    promotedArtifactCount: number;
    childPrivateMemoryCount: number;
    promotedMemoryCount: number;
  }> | null;
  const resumeRefs = {
    artifactRefs: rawResumeRefs?.artifactRefs ?? [],
    memoryRefs: rawResumeRefs?.memoryRefs ?? [],
    childPrivateArtifactCount: rawResumeRefs?.childPrivateArtifactCount ?? 0,
    promotedArtifactCount: rawResumeRefs?.promotedArtifactCount ?? 0,
    childPrivateMemoryCount: rawResumeRefs?.childPrivateMemoryCount ?? 0,
    promotedMemoryCount: rawResumeRefs?.promotedMemoryCount ?? 0,
  };
  const resumeMetadata = {
    policyVersion: "m38.policy.v1",
    assemblerVersion: "m38.assembler.v1",
    artifactRefs: resumeRefs.artifactRefs,
    memoryRefs: resumeRefs.memoryRefs,
    mode: "subagent_parent_resume",
    runtimeKind: "subagent_parent_resume",
    subagentBatchId: batch._id,
    parentMessageId: batch.parentMessageId,
    parentJobId: batch.parentJobId,
    parentToolCallId: batch.toolCallId,
    promotionDecision: "parent_resume",
    childPrivateArtifactCount: resumeRefs.childPrivateArtifactCount,
    promotedArtifactCount: resumeRefs.promotedArtifactCount,
    childPrivateMemoryCount: resumeRefs.childPrivateMemoryCount,
    promotedMemoryCount: resumeRefs.promotedMemoryCount,
  };
  await ctx.runMutation(internal.subagents.mutations.setBatchM38ResumeMetadata, {
    batchId: batch._id,
    m38ResumeMetadata: resumeMetadata,
  });
  const resumeTokenEstimate = estimatePromptTokens(requestMessages);
  await scheduleContextAssemblyLog(ctx, {
    userId: batch.userId,
    chatId: batch.chatId,
    messageId: batch.parentMessageId,
    jobId: batch.parentJobId,
    visibilityScope: "participant",
    ownerParticipantId: String(participantSnapshot.participant?.personaId ?? participantSnapshot.participant?.modelId ?? "parent"),
    ownerModelRunId: String(batch.parentJobId),
    runtimeKind: "subagent_parent_resume",
    subagentBatchId: batch._id,
    parentMessageId: batch.parentMessageId,
    parentJobId: batch.parentJobId,
    parentToolCallId: batch.toolCallId,
    promotionDecision: "parent_resume",
    mode: "subagent_parent_resume",
    legacyMessageCount: requestMessages.length,
    assembledMessageCount: requestMessages.length,
    legacyEstimatedTokens: resumeTokenEstimate,
    assembledEstimatedTokens: resumeTokenEstimate,
    rawArtifactCount: resumeRefs.artifactRefs.length,
    memoryCount: resumeRefs.memoryRefs.length,
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
    resolvedPolicySummary: "subagent parent resume receives summarized child results and runtime refs only",
    excludedReasonCounts: {
      childPrivateArtifactCount: resumeRefs.childPrivateArtifactCount,
      childPrivateMemoryCount: resumeRefs.childPrivateMemoryCount,
    },
    graphCandidateCount: resumeRefs.artifactRefs.length + resumeRefs.memoryRefs.length,
    graphSelectedCount: 0,
    graphQueryMs: 0,
    policyEvaluationMs: 0,
    serializationMs: 0,
    decisionSummary: "parent resume preserved child runtime refs without injecting private child raw artifacts into the request",
  });

  const accountCapabilities = await ctx.runQuery(
    internal.capabilities.queries.getAccountCapabilitiesInternal,
    { userId: participantSnapshot.userId },
  );
  const isProUser = accountCapabilities?.isPro ?? false;
  const webSearchToolEnabled = resolveWebSearchToolIntent(paramsSnapshot);
  const requireZdrOverride = resolveSnapshotRequireZdr(paramsSnapshot);
  const toolRegistry = buildProgressiveToolRegistry({
    enabledIntegrations: paramsSnapshot.enabledIntegrations,
    isPro: isProUser,
    allowSubagents: false,
    webSearchToolEnabled,
  });

  let didCaptureParentTerminal = false;
  try {
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, participantSnapshot.userId);
    let shouldCaptureStarted = false;
    try {
      shouldCaptureStarted = await markGenerationJobAnalyticsStarted(ctx, batch.parentJobId);
    } catch (error) {
      console.warn("[analytics] failed to mark parent resume analytics start", {
        jobId: batch.parentJobId,
        error: error instanceof Error ? error.message : String(error),
      });
      shouldCaptureStarted = true;
    }
    if (shouldCaptureStarted) {
      await captureAssistantResponseStartedEvent(ctx, {
        userId: participantSnapshot.userId,
        chatId: String(participantSnapshot.chatId),
        messageId: String(batch.parentMessageId),
        jobId: String(batch.parentJobId),
        modelId: participantSnapshot.participant.modelId,
        source: "subagent_parent_resume",
        analytics: paramsSnapshot.analytics,
        participantCount: 1,
        webSearchEnabled: webSearchToolEnabled,
        integrationCount: paramsSnapshot.enabledIntegrations?.length ?? 0,
        isResume: true,
        properties: {
          subagent_batch_id: String(batch._id),
          request_message_count: requestMessages.length,
          request_token_estimate: resumeTokenEstimate,
        },
      });
    }
    const generationResult = await generateForParticipant({
      ctx,
      args: {
        chatId: participantSnapshot.chatId,
        userMessageId: batch.sourceUserMessageId,
        assistantMessageIds: [batch.parentMessageId],
        generationJobIds: [batch.parentJobId],
        participants: [participantSnapshot.participant],
        userId: participantSnapshot.userId,
        expandMultiModelGroups: false,
        webSearchEnabled: webSearchToolEnabled,
        requireZdrOverride,
        enabledIntegrations: paramsSnapshot.enabledIntegrations,
        subagentsEnabled: false,
        subagentBatchId: batch._id,
        analytics: paramsSnapshot.analytics,
        analyticsSource: "subagent_parent_resume",
      },
      participant: participantSnapshot.participant,
      allMessages: [],
      memoryContext: undefined,
      modelCapabilities: new Map(),
      toolRegistry,
      progressiveTools: {
        enabledIntegrations: paramsSnapshot.enabledIntegrations ?? [],
        allowSubagents: false,
      },
      isPro: isProUser,
      runtimeProfile: "mobileBasic",
      apiKey,
      requestMessagesOverride: requestMessages,
      requireZdrOverride,
      forceToolChoiceNone: false,
      actionStartTime: Date.now(),
      // Parent-resume runs rebuild from the parent chat transcript only; they
      // do not carry subagent loaded-skill state across this boundary, and any
      // needed skills are re-extracted from the rebuilt requestMessages path.
      restoredLoadedSkills: [],
      continuationHandoff: {
        maxToolRoundsPerInvocation: 1,
        continuationCount: 0,
        onHandoff: async (checkpoint) => {
          if (checkpoint.continuationCount > MAX_TOOL_ROUNDS) {
            throw new ConvexError({
              code: "INTERNAL_ERROR" as const,
              message: "Parent continuation exceeded the tool round limit.",
            });
          }
          const resumeCheckpoint: GenerationContinuationCheckpoint = {
            ...checkpoint,
            assembledCheckpoint: {
              ...(checkpoint.assembledCheckpoint ?? {
                policyVersion: "m38.policy.v1",
                assemblerVersion: "m38.assembler.v1",
                artifactRefs: [],
                memoryRefs: [],
                rehydrationDirectives: [],
                activeProfiles: checkpoint.activeProfiles,
                loadedSkills: checkpoint.loadedSkills,
              }),
              policyVersion: "m38.policy.v1",
              assemblerVersion: "m38.assembler.v1",
              artifactRefs: resumeRefs.artifactRefs,
              memoryRefs: resumeRefs.memoryRefs,
              mode: "subagent_parent_resume",
              runtimeKind: "subagent_parent_resume",
              subagentBatchId: batch._id,
              parentMessageId: batch.parentMessageId,
              parentJobId: batch.parentJobId,
              parentToolCallId: batch.toolCallId,
              promotionDecision: "parent_resume",
              decisionSummary: "parent resume continuation preserved child runtime refs without private raw promotion",
            },
          };
          await scheduleGenerationContinuation(ctx, {
            chatId: participantSnapshot.chatId,
            userMessageId: batch.sourceUserMessageId,
            assistantMessageIds: [batch.parentMessageId],
            generationJobIds: [batch.parentJobId],
            participant: participantSnapshot.participant,
            userId: participantSnapshot.userId,
            expandMultiModelGroups: false,
            webSearchEnabled: webSearchToolEnabled,
            requireZdrOverride,
            effectiveIntegrations: paramsSnapshot.enabledIntegrations ?? [],
            directToolNames: [],
            isPro: isProUser,
            allowSubagents: false,
            subagentBatchId: batch._id,
            analytics: paramsSnapshot.analytics,
            analyticsSource: "subagent_parent_resume",
            resumeExpected: true,
          }, resumeCheckpoint);
        },
      },
    });

    if (generationResult.deferredForSubagents) {
      throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: "Parent continuation unexpectedly deferred to subagents again." });
    }

    const childGeneratedFiles = collectGeneratedFiles(runs);
    const childGeneratedCharts = collectGeneratedCharts(runs);
    if (childGeneratedFiles.length > 0) {
      await ctx.runMutation(internal.subagents.mutations.attachGeneratedFilesToMessage, {
        messageId: batch.parentMessageId,
        chatId: batch.chatId,
        userId: batch.userId,
        generatedFiles: childGeneratedFiles,
      });
    }
    if (childGeneratedCharts.length > 0) {
      await ctx.runMutation(internal.subagents.mutations.attachGeneratedChartsToMessage, {
        messageId: batch.parentMessageId,
        chatId: batch.chatId,
        userId: batch.userId,
        generatedCharts: childGeneratedCharts,
      });
    }

    if (generationResult.continued) {
      await captureAssistantResponseContinued(ctx, {
        userId: participantSnapshot.userId,
        chatId: String(participantSnapshot.chatId),
        messageId: String(batch.parentMessageId),
        jobId: String(batch.parentJobId),
        modelId: participantSnapshot.participant.modelId,
        source: "subagent_parent_resume",
        usage: generationResult.usage,
        analytics: paramsSnapshot.analytics,
        participantCount: 1,
        openrouterGenerationId: generationResult.generationId,
        latencies: generationResult.latencies,
        properties: {
          subagent_batch_id: String(batch._id),
        },
      });
      return;
    }
    if (generationResult.failed || generationResult.cancelled) {
      await captureAssistantResponseFailure(ctx, {
        userId: participantSnapshot.userId,
        chatId: String(participantSnapshot.chatId),
        messageId: String(batch.parentMessageId),
        jobId: String(batch.parentJobId),
        modelId: participantSnapshot.participant.modelId,
        source: "subagent_parent_resume",
        error: generationResult.error,
        cancelled: generationResult.cancelled,
        analytics: paramsSnapshot.analytics,
        properties: {
          subagent_batch_id: String(batch._id),
        },
      });
      didCaptureParentTerminal = true;
    } else {
      await captureAssistantResponseCompleted(ctx, {
        userId: participantSnapshot.userId,
        chatId: String(participantSnapshot.chatId),
        messageId: String(batch.parentMessageId),
        jobId: String(batch.parentJobId),
        modelId: participantSnapshot.participant.modelId,
        source: "subagent_parent_resume",
        usage: generationResult.usage,
        analytics: paramsSnapshot.analytics,
        properties: {
          subagent_batch_id: String(batch._id),
        },
      });
      didCaptureParentTerminal = true;
    }

    const parentMessage = await ctx.runQuery(internal.chat.queries.getMessageInternal, {
      messageId: batch.parentMessageId,
    });
    const parentJob = await ctx.runQuery(internal.chat.queries.getGenerationJobInternal, {
      jobId: batch.parentJobId,
    });
    const terminalState = mapParentTerminalState(parentMessage?.status, parentJob?.status);
    await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
      batchId: batch._id,
      status: terminalState ?? "completed",
      expectedCurrentStatus: "resuming",
    });
    // Only schedule postProcess for successful completions — failed or
    // cancelled generations should not trigger title/memory extraction.
    if (!terminalState || terminalState === "completed") {
      await ctx.scheduler.runAfter(0, internal.chat.actions.postProcess, {
        chatId: batch.chatId,
        userMessageId: batch.sourceUserMessageId,
        assistantMessageIds: [batch.parentMessageId],
        userId: batch.userId,
      });
    }
  } catch (error) {
    if (!didCaptureParentTerminal) {
      await captureAssistantResponseFailure(ctx, {
        userId: participantSnapshot.userId,
        chatId: String(participantSnapshot.chatId),
        messageId: String(batch.parentMessageId),
        jobId: String(batch.parentJobId),
        modelId: participantSnapshot.participant.modelId,
        source: "subagent_parent_resume",
        error,
        analytics: paramsSnapshot.analytics,
      });
    }
    await finalizeParentResumeFailure(ctx, batch, error);
  }
}
