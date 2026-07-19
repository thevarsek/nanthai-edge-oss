import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { ttftLog } from "../lib/generation_log";
import { prepareGenerationContext } from "./actions_run_generation_context";
import { generateForParticipant } from "./actions_run_generation_participant";
import type { GenerationContext } from "./actions_run_generation_context";
import type { ModelCapabilities, RunGenerationArgs } from "./actions_run_generation_types";
import { maybeFinalizeGenerationGroup } from "./actions_run_generation_group_finalize";
import { scheduleGenerationContinuation } from "./actions_run_generation_continuation";
import {
  RunGenerationParticipantArgs,
  TERMINAL_GENERATION_JOB_STATUSES,
} from "./generation_continuation_shared";
import { claimParticipantExecution } from "./actions_execution_lease";
import { buildRuntimeBaseToolRegistry } from "../tools/progressive_registry_runtime";
import {
  hasNodeRequiredDirectTools,
  hasNodeRequiredProfiles,
} from "../tools/runtime_safety";
import { patchDeferredProgressiveToolErrors } from "../tools/progressive_registry_shared";
import { classifyTerminalErrorCode } from "./terminal_error";
import { normalizeGenerationError } from "./generation_error";
import type { SkillToolProfileId } from "../skills/tool_profiles";
import {
  captureAssistantResponseStarted,
  captureAssistantResponseTerminal,
  captureAssistantResponseThrown,
} from "./generation_analytics";
import {
  markGenerationJobAnalyticsStarted,
  markGenerationJobStreamingIfActive,
} from "./generation_start_guard";
import { dedicatedImageGenerationAnalytics } from "./image_generation_analytics";
import {
  generationBudgetStartedAt,
  resolveGenerationProviderDeadline,
} from "./generation_deadline";
import { transitionGenerationRound } from "./generation_round_actions";
import {
  attachmentTriggeredDocumentWorkspaceToolNames,
  attachmentTriggeredReadToolNames,
} from "./helpers_attachment_utils";
import type { ContextAttachment } from "./helpers_types";

export function mapBatchTerminalStatus(
  messageStatus?: string,
  jobStatus?: string,
): "completed" | "failed" | "cancelled" {
  if (messageStatus === "cancelled" || jobStatus === "cancelled") {
    return "cancelled";
  }
  if (
    messageStatus === "failed" ||
    jobStatus === "failed" ||
    jobStatus === "timedOut"
  ) {
    return "failed";
  }
  return "completed";
}

export async function clearFreshRuntimeContinuation(
  ctx: Pick<ActionCtx, "runMutation">,
  jobId: Id<"generationJobs">,
  resumeExpected: boolean,
): Promise<void> {
  if (resumeExpected) return;
  // This must finish before the V8 round can write a new pre-provider
  // checkpoint. Scheduling the clear allowed it to race with, and delete,
  // the V8-to-Node handoff created later in the same action.
  await ctx.runMutation(internal.chat.mutations.clearGenerationContinuation, {
    jobId,
  });
}

async function maybeFinalizeSubagentBatch(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
): Promise<void> {
  if (!args.subagentBatchId) {
    return;
  }

  const [message, job] = await Promise.all([
    ctx.runQuery(internal.chat.queries.getMessageInternal, {
      messageId: args.participant.messageId,
    }),
    ctx.runQuery(internal.chat.queries.getGenerationJobInternal, {
      jobId: args.participant.jobId,
    }),
  ]);

  await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
    batchId: args.subagentBatchId,
    status: mapBatchTerminalStatus(message?.status, job?.status),
    expectedCurrentStatus: "resuming",
  });
}

async function maybeFinalizeDrivePickerBatch(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
): Promise<void> {
  if (!args.drivePickerBatchId) return;
  const [message, job] = await Promise.all([
    ctx.runQuery(internal.chat.queries.getMessageInternal, {
      messageId: args.participant.messageId,
    }),
    ctx.runQuery(internal.chat.queries.getGenerationJobInternal, {
      jobId: args.participant.jobId,
    }),
  ]);
  await ctx.runMutation(internal.drive_picker.mutations.completeBatch, {
    batchId: args.drivePickerBatchId,
    status: mapBatchTerminalStatus(message?.status, job?.status),
  });
}

type RunGenerationArgsWithContinuationIds = RunGenerationArgs & {
  subagentBatchId?: Id<"subagentBatches">;
  drivePickerBatchId?: Id<"drivePickerBatches">;
};

function toRunGenerationArgs(args: RunGenerationParticipantArgs): RunGenerationArgsWithContinuationIds {
  const generationArgs: RunGenerationArgsWithContinuationIds = {
    chatId: args.chatId,
    userMessageId: args.userMessageId,
    assistantMessageIds: args.assistantMessageIds,
    generationJobIds: args.generationJobIds,
    participants: [args.participant],
    userId: args.userId,
    expandMultiModelGroups: args.expandMultiModelGroups,
    webSearchEnabled: args.webSearchEnabled,
    enabledIntegrations: args.effectiveIntegrations,
    subagentsEnabled: args.allowSubagents,
    disableTools: args.disableTools,
    searchSessionId: args.searchSessionId,
    analytics: args.analytics,
    analyticsSource: args.analyticsSource,
    subagentBatchId: args.subagentBatchId,
    drivePickerBatchId: args.drivePickerBatchId,
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
    workflowResumeEventId: args.workflowResumeEventId,
  };
  if (args.requireZdrOverride === true) {
    generationArgs.requireZdrOverride = true;
  }
  return generationArgs;
}

async function finalizeParticipantSetupFailure(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
  error: unknown,
): Promise<void> {
  const errorMessage = normalizeGenerationError(error).message;
  await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
    messageId: args.participant.messageId,
    jobId: args.participant.jobId,
    chatId: args.chatId,
    content: `Error: ${errorMessage}`,
    status: "failed",
    error: errorMessage,
    userId: args.userId,
    terminalErrorCode: classifyTerminalErrorCode({
      status: "failed",
      error: errorMessage,
    }),
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
  });
}

async function finalizeParticipantFailureAndCleanup(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
  error: unknown,
): Promise<void> {
  await finalizeParticipantSetupFailure(ctx, args, error);
  await ctx.runMutation(internal.chat.mutations.clearGenerationContinuation, {
    jobId: args.participant.jobId,
  });
  await maybeFinalizeSubagentBatch(ctx, args);
  await maybeFinalizeGenerationGroup(ctx, {
    chatId: args.chatId,
    userMessageId: args.userMessageId,
    assistantMessageIds: args.assistantMessageIds,
    generationJobIds: args.generationJobIds,
    userId: args.userId,
    searchSessionId: args.searchSessionId,
  });
}

export function requiresNodeWorker(args: {
  directToolNames: string[];
  activeProfiles: string[];
  hasVideoGeneration: boolean;
  hasAudioOutput: boolean;
  hasImageGeneration?: boolean;
}): boolean {
  return (
    args.hasVideoGeneration ||
    args.hasAudioOutput ||
    args.hasImageGeneration === true ||
    hasNodeRequiredDirectTools(args.directToolNames) ||
    hasNodeRequiredProfiles(args.activeProfiles as SkillToolProfileId[])
  );
}

function continuationPreviewDirectToolNames(
  continuationPreview: { groupSnapshot?: unknown } | null,
): string[] | null {
  const groupSnapshot = continuationPreview?.groupSnapshot as
    | { directToolNames?: unknown }
    | undefined;
  const directToolNames = groupSnapshot?.directToolNames;
  if (!Array.isArray(directToolNames)) {
    return null;
  }
  return directToolNames.filter((name): name is string => typeof name === "string");
}

export async function runGenerationParticipantRuntimeHandler(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
): Promise<void> {
  // Phase 1 TTFT instrumentation: scheduler hop #2 latency
  // (coordinator dispatch → participant runtime handler entry)
  const participantStartedAt = Date.now();
  const providerDeadlineAt = resolveGenerationProviderDeadline(
    args.providerDeadlineAt,
    participantStartedAt,
  );
  const actionStartTime = generationBudgetStartedAt(
    providerDeadlineAt,
    participantStartedAt,
  );
  const schedulerHop2Ms =
    typeof args.enqueuedAt === "number" ? participantStartedAt - args.enqueuedAt : null;
  console.info("[generationParticipant] started", {
    chatId: args.chatId,
    messageId: args.participant.messageId,
    jobId: args.participant.jobId,
    modelId: args.participant.modelId,
    resumeExpected: args.resumeExpected === true,
    schedulerHop2Ms,
  });

  const [continuationPreview, caps, driveResumeMessage] = await Promise.all([
    args.resumeExpected
      ? ctx.runQuery(internal.chat.queries.getGenerationContinuationInternal, {
          jobId: args.participant.jobId,
        })
      : Promise.resolve(null),
    ctx.runQuery(internal.chat.queries.getModelCapabilities, {
      modelId: args.participant.modelId,
    }),
    args.drivePickerBatchId && args.resumeExpected !== true
      ? ctx.runQuery(internal.chat.queries.getMessageInternal, {
          messageId: args.userMessageId,
        })
      : Promise.resolve(null),
  ]);

  const persistedAttachments = driveResumeMessage?.attachments as
    | ContextAttachment[]
    | undefined;
  const routingDirectToolNames = Array.from(new Set([
    ...(continuationPreviewDirectToolNames(continuationPreview) ?? args.directToolNames ?? []),
    ...attachmentTriggeredReadToolNames(persistedAttachments),
    ...attachmentTriggeredDocumentWorkspaceToolNames(persistedAttachments),
  ]));
  const routedArgs: RunGenerationParticipantArgs = driveResumeMessage
    ? { ...args, directToolNames: routingDirectToolNames }
    : args;
  if (requiresNodeWorker({
    directToolNames: routingDirectToolNames,
    activeProfiles: continuationPreview?.activeProfiles ?? [],
    hasVideoGeneration: caps?.hasVideoGeneration === true,
    hasAudioOutput: caps?.hasAudioOutput === true,
    hasImageGeneration: caps?.hasImageGeneration === true,
  })) {
    try {
      await ctx.runAction(internal.chat.actions_node.runGenerationParticipantNode, {
        ...routedArgs,
        providerDeadlineAt,
      });
    } catch (error) {
      const nodeJob = await ctx.runQuery(
        internal.chat.queries.getGenerationJobInternal,
        { jobId: args.participant.jobId },
      );
      if (nodeJob && !TERMINAL_GENERATION_JOB_STATUSES.has(nodeJob.status)) {
        await finalizeParticipantFailureAndCleanup(ctx, routedArgs, error);
        await maybeFinalizeDrivePickerBatch(ctx, routedArgs);
      }
      throw error;
    }
    return;
  }

  const claimedArgs = await claimParticipantExecution(ctx, routedArgs);
  if (!claimedArgs) return;

  const continuationState = claimedArgs.resumeExpected
      ? await ctx.runMutation(internal.chat.mutations.claimGenerationContinuation, {
        jobId: claimedArgs.participant.jobId,
        ...(claimedArgs.executionAttemptId && claimedArgs.executionFence !== undefined
          ? {
              executionAttemptId: claimedArgs.executionAttemptId,
              executionFence: claimedArgs.executionFence,
            }
          : {}),
      })
    : null;

  if (args.resumeExpected && !continuationState) {
    throw new Error("GENERATION_CONTINUATION_NOT_CLAIMABLE");
  }

  const effectiveArgs: RunGenerationParticipantArgs = continuationState
    ? {
        chatId: args.chatId,
        userMessageId: continuationState.group.userMessageId,
        assistantMessageIds: continuationState.group.assistantMessageIds,
        generationJobIds: continuationState.group.generationJobIds,
        participant: continuationState.participant,
        userId: continuationState.group.userId,
        expandMultiModelGroups: continuationState.group.expandMultiModelGroups,
        webSearchEnabled: continuationState.group.webSearchEnabled,
        requireZdrOverride: continuationState.group.requireZdrOverride,
        effectiveIntegrations: continuationState.group.effectiveIntegrations,
        directToolNames: continuationState.group.directToolNames,
        isPro: continuationState.group.isPro,
        allowSubagents: continuationState.group.allowSubagents,
        disableTools: continuationState.group.disableTools,
        searchSessionId: continuationState.group.searchSessionId,
        subagentBatchId: continuationState.group.subagentBatchId,
        drivePickerBatchId: claimedArgs.drivePickerBatchId
          ?? continuationState.group.drivePickerBatchId,
        chatSkillOverrides: continuationState.group.chatSkillOverrides,
        chatIntegrationOverrides: continuationState.group.chatIntegrationOverrides,
        personaSkillOverrides: continuationState.group.personaSkillOverrides,
        skillDefaults: continuationState.group.skillDefaults,
        integrationDefaults: continuationState.group.integrationDefaults,
        analytics: continuationState.group.analytics,
        analyticsSource: continuationState.group.analyticsSource,
        executionAttemptId: claimedArgs.executionAttemptId,
        executionFence: claimedArgs.executionFence,
        workflowManaged: claimedArgs.workflowManaged,
        workflowResumeEventId: claimedArgs.workflowResumeEventId,
        resumeExpected: true,
      }
    : claimedArgs;
  const imageTerminalAnalytics = caps?.hasImageGeneration === true
    ? dedicatedImageGenerationAnalytics({
        config: effectiveArgs.imageConfig,
        supportedParameters: caps.imageCapabilities?.supportedParameters,
        originSource: effectiveArgs.analyticsSource
          ?? (effectiveArgs.subagentBatchId ? "subagent_parent_resume" : "chat_generation"),
      })
    : undefined;

  const generationArgs = toRunGenerationArgs(effectiveArgs);
  const job = await ctx.runQuery(internal.chat.queries.getGenerationJobInternal, {
    jobId: effectiveArgs.participant.jobId,
  });
  if (!job || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)) {
    await ctx.scheduler.runAfter(0, internal.chat.mutations.clearGenerationContinuation, {
      jobId: effectiveArgs.participant.jobId,
    });
    return;
  }
  await clearFreshRuntimeContinuation(
    ctx,
    effectiveArgs.participant.jobId,
    args.resumeExpected === true,
  );

  let startedAnalyticsCapture: Promise<void> | undefined;
  try {
    const preflightStartedAt = Date.now();
    if (args.resumeExpected !== true) {
      const didStart = await markGenerationJobStreamingIfActive(
        ctx,
        effectiveArgs.participant.jobId,
      );
      if (!didStart) {
        return;
      }
      let shouldCaptureStarted = false;
      try {
        shouldCaptureStarted = await markGenerationJobAnalyticsStarted(ctx, effectiveArgs.participant.jobId);
      } catch (error) {
        console.warn("[analytics] failed to mark generation job analytics start", {
          jobId: effectiveArgs.participant.jobId,
          error: error instanceof Error ? error.message : String(error),
        });
        shouldCaptureStarted = true;
      }
      if (shouldCaptureStarted) {
        startedAnalyticsCapture = captureAssistantResponseStarted(ctx, effectiveArgs, {
          isResume: false,
          schedulerHop2Ms,
        }, imageTerminalAnalytics);
      }
    }
    ttftLog("[generation] participant preflight started", {
      chatId: effectiveArgs.chatId,
      messageId: effectiveArgs.participant.messageId,
      jobId: effectiveArgs.participant.jobId,
      modelId: effectiveArgs.participant.modelId,
    });
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, effectiveArgs.userId);
    const continuationCount = continuationState?.continuationCount ?? 0;

    let allMessages: GenerationContext["allMessages"] = [];
    let memoryContext: string | undefined;
    let modelCapabilities: Map<string, ModelCapabilities>;
    if (continuationState) {
      modelCapabilities = new Map();
      if (caps) {
        modelCapabilities.set(effectiveArgs.participant.modelId, caps);
      }
    } else {
      const preloadedCaps = new Map<string, ModelCapabilities>();
      if (caps) {
        preloadedCaps.set(effectiveArgs.participant.modelId, caps);
      }
      const prepared = await prepareGenerationContext(
        ctx,
        generationArgs as RunGenerationArgs,
        preloadedCaps,
      );
      allMessages = prepared.allMessages;
      memoryContext = prepared.memoryContext;
      modelCapabilities = prepared.modelCapabilities;
    }
    const streamingMessageId =
      effectiveArgs.participant.streamingMessageId
      ?? job?.streamingMessageId
      ?? undefined;
    ttftLog("[generation] participant preflight finished", {
      chatId: effectiveArgs.chatId,
      messageId: effectiveArgs.participant.messageId,
      jobId: effectiveArgs.participant.jobId,
      modelId: effectiveArgs.participant.modelId,
      durationMs: Date.now() - preflightStartedAt,
    });

    const toolRegistry = buildRuntimeBaseToolRegistry({
      isPro: effectiveArgs.isPro,
      disabled: effectiveArgs.disableTools === true,
      allowSubagents: effectiveArgs.allowSubagents,
      webSearchToolEnabled: effectiveArgs.webSearchEnabled === true,
    });

    const result = await generateForParticipant({
      ctx,
      args: generationArgs as RunGenerationArgs,
      participant: effectiveArgs.participant,
      allMessages,
      memoryContext,
      modelCapabilities,
      toolRegistry,
      progressiveTools: {
        enabledIntegrations: effectiveArgs.effectiveIntegrations,
        allowSubagents: effectiveArgs.allowSubagents,
        directToolNames: [],
      },
      isPro: effectiveArgs.isPro,
      runtimeProfile: "mobileBasic",
      apiKey,
      requestMessagesOverride: continuationState?.messages,
      requireZdrOverride: effectiveArgs.requireZdrOverride,
      initialTotalUsage: continuationState?.usage,
      initialToolCalls: continuationState?.toolCalls,
      initialToolResults: continuationState?.toolResults,
      initialCompactionCount: continuationState?.compactionCount ?? 0,
      restoredActiveProfiles: continuationState?.activeProfiles,
      restoredLoadedSkills: continuationState?.loadedSkills,
      forceToolChoiceNone: false,
      actionStartTime,
      providerDeadlineAt,
      onProviderDispatch: async () => await transitionGenerationRound(ctx, effectiveArgs, "dispatched"),
      v8RuntimeHandoffGuards: true,
      streamingMessageId,
      preResolvedOverrides: {
        resolved: true as const,
        chatSkillOverrides: effectiveArgs.chatSkillOverrides,
        personaSkillOverrides: effectiveArgs.personaSkillOverrides,
        skillDefaults: effectiveArgs.skillDefaults,
      },
      onProfilesExpanded: async (toolCalls, results, _activeProfiles) => {
        // Runtime path cannot expand profiles — always defer tool calls
        // so they are retried on the Node continuation path.
        patchDeferredProgressiveToolErrors(toolCalls, results);
      },
      continuationHandoff: {
            maxToolRoundsPerInvocation: 1,
            continuationCount,
            onHandoff: async (checkpoint) => {
              await scheduleGenerationContinuation(ctx, effectiveArgs, checkpoint);
            },
          },
    });
    await transitionGenerationRound(ctx, effectiveArgs, "committed");
    const generationDurationMs = Date.now() - preflightStartedAt;

    if (!result.deferredForSubagents && !result.continued) {
      await ctx.scheduler.runAfter(0, internal.chat.mutations.clearGenerationContinuation, {
        jobId: effectiveArgs.participant.jobId,
      });
      await maybeFinalizeSubagentBatch(ctx, effectiveArgs);
      await maybeFinalizeDrivePickerBatch(ctx, effectiveArgs);
      await maybeFinalizeGenerationGroup(ctx, {
        chatId: effectiveArgs.chatId,
        userMessageId: effectiveArgs.userMessageId,
        assistantMessageIds: effectiveArgs.assistantMessageIds,
        generationJobIds: effectiveArgs.generationJobIds,
        userId: effectiveArgs.userId,
        searchSessionId: effectiveArgs.searchSessionId,
      });
    }
    await Promise.all([
      startedAnalyticsCapture,
      captureAssistantResponseTerminal(
        ctx,
        effectiveArgs,
        continuationState,
        result,
        generationDurationMs,
      ),
    ]);
  } catch (error) {
    await finalizeParticipantFailureAndCleanup(ctx, effectiveArgs, error);
    await maybeFinalizeDrivePickerBatch(ctx, effectiveArgs);
    await Promise.all([
      startedAnalyticsCapture,
      captureAssistantResponseThrown(ctx, effectiveArgs, error, imageTerminalAnalytics),
    ]);
    throw error;
  }
}
