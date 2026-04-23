import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { MAX_TOOL_ROUNDS } from "../tools/execute_loop";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { ttftLog } from "../lib/generation_log";
import { prepareGenerationContext } from "./actions_run_generation_context";
import { generateForParticipant } from "./actions_run_generation_participant";
import { maybeFinalizeGenerationGroup } from "./actions_run_generation_group_finalize";
import { scheduleGenerationContinuation } from "./actions_run_generation_continuation";
import {
  RunGenerationParticipantArgs,
  TERMINAL_GENERATION_JOB_STATUSES,
} from "./generation_continuation_shared";
import { buildRuntimeBaseToolRegistry } from "../tools/progressive_registry_runtime";
import {
  hasNodeRequiredDirectTools,
  hasNodeRequiredProfiles,
} from "../tools/runtime_safety";
import { patchDeferredProgressiveToolErrors } from "../tools/progressive_registry_shared";
import { classifyTerminalErrorCode } from "./terminal_error";

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

function toRunGenerationArgs(args: RunGenerationParticipantArgs) {
  return {
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
    searchSessionId: args.searchSessionId,
    subagentBatchId: args.subagentBatchId,
  } as const;
}

async function finalizeParticipantSetupFailure(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
  error: unknown,
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : "Unknown generation error";
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
}): boolean {
  return (
    args.hasVideoGeneration ||
    args.hasAudioOutput ||
    hasNodeRequiredDirectTools(args.directToolNames) ||
    hasNodeRequiredProfiles(args.activeProfiles as any)
  );
}

export async function runGenerationParticipantRuntimeHandler(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
): Promise<void> {
  // Phase 1 TTFT instrumentation: scheduler hop #2 latency
  // (coordinator dispatch → participant runtime handler entry)
  const participantStartedAt = Date.now();
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

  const [continuationPreview, caps] = await Promise.all([
    args.resumeExpected
      ? ctx.runQuery(internal.chat.queries.getGenerationContinuationInternal, {
          jobId: args.participant.jobId,
        })
      : Promise.resolve(null),
    ctx.runQuery(internal.chat.queries.getModelCapabilities, {
      modelId: args.participant.modelId,
    }),
  ]);

  if (requiresNodeWorker({
    directToolNames: args.directToolNames ?? [],
    activeProfiles: continuationPreview?.activeProfiles ?? [],
    hasVideoGeneration: caps?.hasVideoGeneration === true,
    hasAudioOutput: caps?.hasAudioOutput === true,
  })) {
    await ctx.runAction(internal.chat.actions_node.runGenerationParticipantNode, args);
    return;
  }

  const continuationState = args.resumeExpected
    ? await ctx.runMutation(internal.chat.mutations.claimGenerationContinuation, {
        jobId: args.participant.jobId,
      })
    : null;

  if (args.resumeExpected && !continuationState) {
    return;
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
        effectiveIntegrations: continuationState.group.effectiveIntegrations,
        directToolNames: continuationState.group.directToolNames,
        isPro: continuationState.group.isPro,
        allowSubagents: continuationState.group.allowSubagents,
        searchSessionId: continuationState.group.searchSessionId,
        subagentBatchId: continuationState.group.subagentBatchId,
        chatSkillOverrides: continuationState.group.chatSkillOverrides,
        chatIntegrationOverrides: continuationState.group.chatIntegrationOverrides,
        personaSkillOverrides: continuationState.group.personaSkillOverrides,
        skillDefaults: continuationState.group.skillDefaults,
        integrationDefaults: continuationState.group.integrationDefaults,
        resumeExpected: true,
      }
    : args;

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
  if (!args.resumeExpected) {
    await ctx.scheduler.runAfter(0, internal.chat.mutations.clearGenerationContinuation, {
      jobId: effectiveArgs.participant.jobId,
    });
  }

  try {
    const preflightStartedAt = Date.now();
    ttftLog("[generation] participant preflight started", {
      chatId: effectiveArgs.chatId,
      messageId: effectiveArgs.participant.messageId,
      jobId: effectiveArgs.participant.jobId,
      modelId: effectiveArgs.participant.modelId,
    });
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, effectiveArgs.userId);
    const continuationCount = continuationState?.continuationCount ?? 0;
    const forceToolChoiceNone = continuationCount >= MAX_TOOL_ROUNDS;

    let allMessages: Array<any> = [];
    let memoryContext: string | undefined;
    let modelCapabilities: Map<string, any>;
    if (continuationState) {
      modelCapabilities = new Map();
      if (caps) {
        modelCapabilities.set(effectiveArgs.participant.modelId, caps);
      }
    } else {
      const preloadedCaps = new Map<string, any>();
      if (caps) {
        preloadedCaps.set(effectiveArgs.participant.modelId, caps);
      }
      const prepared = await prepareGenerationContext(ctx, generationArgs as any, preloadedCaps);
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
    });

    const result = await generateForParticipant({
      ctx,
      args: generationArgs as any,
      participant: effectiveArgs.participant,
      allMessages,
      memoryContext,
      modelCapabilities,
      toolRegistry,
      progressiveTools: {
        enabledIntegrations: effectiveArgs.effectiveIntegrations,
        allowSubagents: false,
        directToolNames: [],
      },
      isPro: effectiveArgs.isPro,
      runtimeProfile: "mobileBasic",
      apiKey,
      requestMessagesOverride: continuationState?.messages,
      initialTotalUsage: continuationState?.usage,
      initialToolCalls: continuationState?.toolCalls,
      initialToolResults: continuationState?.toolResults,
      initialCompactionCount: continuationState?.compactionCount ?? 0,
      restoredActiveProfiles: continuationState?.activeProfiles as any,
      forceToolChoiceNone,
      actionStartTime: Date.now(),
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
      continuationHandoff: forceToolChoiceNone
        ? undefined
        : {
            maxToolRoundsPerInvocation: 1,
            continuationCount,
            onHandoff: async (checkpoint) => {
              await scheduleGenerationContinuation(ctx, effectiveArgs, checkpoint);
            },
          },
    });

    if (!result.deferredForSubagents && !result.continued) {
      await ctx.scheduler.runAfter(0, internal.chat.mutations.clearGenerationContinuation, {
        jobId: effectiveArgs.participant.jobId,
      });
      await maybeFinalizeSubagentBatch(ctx, effectiveArgs);
      await maybeFinalizeGenerationGroup(ctx, {
        chatId: effectiveArgs.chatId,
        userMessageId: effectiveArgs.userMessageId,
        assistantMessageIds: effectiveArgs.assistantMessageIds,
        generationJobIds: effectiveArgs.generationJobIds,
        userId: effectiveArgs.userId,
        searchSessionId: effectiveArgs.searchSessionId,
      });
    }
  } catch (error) {
    await finalizeParticipantFailureAndCleanup(ctx, effectiveArgs, error);
    throw error;
  }
}
