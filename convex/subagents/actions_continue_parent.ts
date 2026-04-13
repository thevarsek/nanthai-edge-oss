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
  buildParentContinuationPayload,
  isSubagentLeaseStale,
  SUBAGENT_RECOVERY_LEASE_MS,
} from "./shared";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";

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
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
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
    const childGeneratedFiles = runs.flatMap((run) => run.generatedFiles ?? []);
    const childGeneratedCharts = runs.flatMap((run) => run.generatedCharts ?? []);
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
    await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
      batchId: batch._id,
      status: "completed",
      expectedCurrentStatus: "resuming",
    });
    return true;
  }

  if (terminalState === "failed" || terminalState === "cancelled") {
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
    const childGeneratedFiles = runs.flatMap((run) => run.generatedFiles ?? []);
    const childGeneratedCharts = runs.flatMap((run) => run.generatedCharts ?? []);
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
    participant: any;
  };
  const paramsSnapshot = batch.paramsSnapshot as {
    enabledIntegrations?: string[];
    requestParams?: { webSearchEnabled?: boolean };
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

  const requestMessages = (batch.resumeConversationSeed as Array<{
    role: string;
    tool_call_id?: string;
    content?: unknown;
  }>).map((message) => {
    if (message.role === "tool" && message.tool_call_id === batch.toolCallId) {
      return {
        ...message,
        content: JSON.stringify(continuationPayload),
      };
    }
    return message;
  });

  const accountCapabilities = await ctx.runQuery(
    internal.capabilities.queries.getAccountCapabilitiesInternal,
    { userId: participantSnapshot.userId },
  );
  const isProUser = accountCapabilities.isPro;
  const toolRegistry = buildProgressiveToolRegistry({
    enabledIntegrations: paramsSnapshot.enabledIntegrations,
    isPro: isProUser,
    allowSubagents: false,
  });

  try {
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, participantSnapshot.userId);
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
        webSearchEnabled: paramsSnapshot.requestParams?.webSearchEnabled ?? false,
        enabledIntegrations: paramsSnapshot.enabledIntegrations,
        subagentsEnabled: false,
        subagentBatchId: batch._id,
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
      forceToolChoiceNone: false,
      actionStartTime: Date.now(),
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
          await scheduleGenerationContinuation(ctx, {
            chatId: participantSnapshot.chatId,
            userMessageId: batch.sourceUserMessageId,
            assistantMessageIds: [batch.parentMessageId],
            generationJobIds: [batch.parentJobId],
            participant: participantSnapshot.participant,
            userId: participantSnapshot.userId,
            expandMultiModelGroups: false,
            webSearchEnabled: paramsSnapshot.requestParams?.webSearchEnabled ?? false,
            effectiveIntegrations: paramsSnapshot.enabledIntegrations ?? [],
            directToolNames: [],
            isPro: isProUser,
            allowSubagents: false,
            subagentBatchId: batch._id,
            resumeExpected: true,
          }, checkpoint);
        },
      },
    });

    if (generationResult.deferredForSubagents) {
      throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: "Parent continuation unexpectedly deferred to subagents again." });
    }

    const childGeneratedFiles = runs.flatMap((run) => run.generatedFiles ?? []);
    const childGeneratedCharts = runs.flatMap((run) => run.generatedCharts ?? []);
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
      return;
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
    await finalizeParentResumeFailure(ctx, batch, error);
  }
}
