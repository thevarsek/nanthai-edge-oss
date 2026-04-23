"use node";

import { ConvexError } from "convex/values";
import { Id } from "../_generated/dataModel";
import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { MAX_TOOL_ROUNDS } from "../tools/execute_loop";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { ttftLog } from "../lib/generation_log";
import {
  buildProgressiveToolRegistry,
  buildRegistryParams,
  patchSameRoundProgressiveToolErrors,
  retrySameRoundProgressiveToolCalls,
} from "../tools/progressive_registry";
import { prepareGenerationContext } from "./actions_run_generation_context";
import { generateForParticipant } from "./actions_run_generation_participant";
import { maybeFinalizeGenerationGroup } from "./actions_run_generation_group_finalize";
import { scheduleGenerationContinuation } from "./actions_run_generation_continuation";
import { LYRIA_MP3_MIME_TYPE, parseMp3DurationMs } from "./audio_shared";
import {
  RunGenerationParticipantArgs,
  TERMINAL_GENERATION_JOB_STATUSES,
} from "./generation_continuation_shared";
import { classifyTerminalErrorCode } from "./terminal_error";

function mapBatchTerminalStatus(
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

export async function runGenerationParticipantHandler(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
): Promise<void> {
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
    await ctx.runMutation(internal.chat.mutations.clearGenerationContinuation, {
      jobId: effectiveArgs.participant.jobId,
    });
    return;
  }
  if (!args.resumeExpected) {
    await ctx.runMutation(internal.chat.mutations.clearGenerationContinuation, {
      jobId: effectiveArgs.participant.jobId,
    });
  }

  // ── M29: Video generation branch ────────────────────────────────────
  // Video models use a completely separate API (POST /api/v1/videos) with
  // async polling, so we divert here before entering the streaming/tool loop.
  // Continuations never apply to video — video jobs are self-scheduling.
  if (!continuationState) {
    const caps = await ctx.runQuery(internal.chat.queries.getModelCapabilities, {
      modelId: effectiveArgs.participant.modelId,
    });
    if (caps?.hasVideoGeneration) {
      try {
        await ctx.scheduler.runAfter(
          0,
          internal.chat.actions.submitVideoGeneration,
          {
            chatId: effectiveArgs.chatId,
            userMessageId: effectiveArgs.userMessageId,
            assistantMessageIds: effectiveArgs.assistantMessageIds,
            generationJobIds: effectiveArgs.generationJobIds,
            participant: {
              modelId: effectiveArgs.participant.modelId,
              messageId: effectiveArgs.participant.messageId,
              jobId: effectiveArgs.participant.jobId,
            },
            userId: effectiveArgs.userId,
            searchSessionId: effectiveArgs.searchSessionId,
            videoConfig: effectiveArgs.videoConfig,
          },
        );
        return; // Video flow takes over — no streaming/tool loop needed
      } catch (error) {
        await finalizeParticipantFailureAndCleanup(ctx, effectiveArgs, error);
        throw error;
      }
    }
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
      const caps = await ctx.runQuery(internal.chat.queries.getModelCapabilities, {
        modelId: effectiveArgs.participant.modelId,
      });
      modelCapabilities = new Map();
      if (caps) {
        modelCapabilities.set(effectiveArgs.participant.modelId, caps);
      }
    } else {
      const prepared = await prepareGenerationContext(ctx, generationArgs as any);
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

    const toolRegistry = buildProgressiveToolRegistry({
      enabledIntegrations: effectiveArgs.effectiveIntegrations,
      isPro: effectiveArgs.isPro,
      allowSubagents: effectiveArgs.allowSubagents,
      activeProfiles: continuationState?.activeProfiles,
      directToolNames: effectiveArgs.directToolNames ?? [],
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
        allowSubagents: effectiveArgs.allowSubagents,
        directToolNames: effectiveArgs.directToolNames ?? [],
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
      onProfilesExpanded: async (toolCalls, results, activeProfiles, _currentRegistry, currentParams, _nextCaps) => {
        const registry = buildProgressiveToolRegistry({
          enabledIntegrations: effectiveArgs.effectiveIntegrations,
          isPro: effectiveArgs.isPro,
          allowSubagents: effectiveArgs.allowSubagents,
          activeProfiles,
          directToolNames: effectiveArgs.directToolNames ?? [],
        });
        await retrySameRoundProgressiveToolCalls(
          toolCalls as any,
          results,
          registry,
          {
            ctx,
            userId: effectiveArgs.userId,
            chatId: String(effectiveArgs.chatId),
          },
        );
        patchSameRoundProgressiveToolErrors(toolCalls, results, registry);

        return {
          registry,
          params: {
            ...currentParams,
            ...buildRegistryParams(registry),
          },
        };
      },
      persistInlineAudio: async (audioBase64) => {
        const audioBuffer = Buffer.from(audioBase64, "base64");
        let audioDurationMs = parseMp3DurationMs(audioBuffer);
        if (audioDurationMs === 0) {
          audioDurationMs = Math.round((audioBuffer.length * 8) / 128000 * 1000);
        }
        const audioStorageId = await ctx.storage.store(
          new Blob([new Uint8Array(audioBuffer)], { type: LYRIA_MP3_MIME_TYPE }),
        );
        return {
          audioStorageId: audioStorageId as Id<"_storage">,
          audioDurationMs,
          audioGeneratedAt: Date.now(),
        };
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
      await ctx.runMutation(internal.chat.mutations.clearGenerationContinuation, {
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
    if (error instanceof ConvexError) {
      await finalizeParticipantFailureAndCleanup(ctx, effectiveArgs, error);
      throw error;
    }

    await finalizeParticipantFailureAndCleanup(ctx, effectiveArgs, error);
    throw error;
  }
}
