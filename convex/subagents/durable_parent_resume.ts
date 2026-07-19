"use node";

import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { AnalyticsClientMetadata } from "../analytics/client_metadata";
import type { ChatRequestParameters } from "../lib/openrouter";
import type { ParticipantConfig } from "../chat/actions_run_generation_types";
import type { GenerationContinuationCheckpoint } from "../chat/generation_continuation_shared";
import type { OpenRouterMessage } from "../lib/openrouter";
import type { RecordedToolCall, RecordedToolResult } from "../tools/execute_loop";
import {
  extractLoadedSkillsFromConversation,
  extractProfilesFromConversation,
} from "../tools/progressive_registry";
import { buildParentContinuationPayload, resolveSnapshotRequireZdr, resolveWebSearchToolIntent } from "./shared";

type DurableParams = {
  enabledIntegrations?: string[];
  analytics?: AnalyticsClientMetadata;
  analyticsSource?: "chat_generation" | "web_search" | "research_paper" | "scheduled_job";
  workflowResumeEventId?: string;
  roundKey?: string;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
  webSearchToolEnabled?: boolean;
  requireZdr?: boolean;
  requestParams?: ChatRequestParameters;
};

function recordedCalls(value: unknown): RecordedToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const call = entry as { id?: unknown; name?: unknown; arguments?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const id = typeof call.id === "string" ? call.id : null;
    const name = typeof call.name === "string" ? call.name : call.function?.name;
    const args = typeof call.arguments === "string" ? call.arguments : call.function?.arguments;
    return id && typeof name === "string"
      ? [{ id, name, arguments: typeof args === "string" ? args : "{}" }]
      : [];
  });
}

function replaceParentToolResult(
  messages: OpenRouterMessage[],
  toolCallId: string,
  content: string,
): OpenRouterMessage[] {
  return messages.map((message) => message.role === "tool" && message.tool_call_id === toolCallId
    ? { ...message, content }
    : message);
}

export async function continueDurableParentAfterSubagents(
  ctx: ActionCtx,
  batchId: Id<"subagentBatches">,
  prefetched?: { batch: Doc<"subagentBatches"> | null; claimed: boolean },
): Promise<boolean> {
  let batch = prefetched?.batch
    ?? await ctx.runQuery(internal.subagents.queries.getBatchInternal, { batchId });
  const initialParams = batch?.paramsSnapshot as DurableParams | undefined;
  if (!batch || !initialParams?.workflowResumeEventId) return false;
  if (
    batch.resumeDeliveredEventId === initialParams.workflowResumeEventId
    && batch.resumeDeliveredAt !== undefined
  ) return true;
  if (batch.status === "waiting_to_resume" && prefetched?.claimed !== true) {
    await ctx.runMutation(internal.subagents.mutations.claimBatchForResume, { batchId });
    batch = await ctx.runQuery(internal.subagents.queries.getBatchInternal, { batchId });
  }
  if (!batch || batch.status !== "resuming") return true;

  const [runs, job, capabilities, parentContinuation] = await Promise.all([
    ctx.runQuery(internal.subagents.queries.listRunsForBatchInternal, { batchId }),
    ctx.runQuery(internal.chat.queries.getGenerationJobInternal, { jobId: batch.parentJobId }),
    ctx.runQuery(internal.capabilities.queries.getAccountCapabilitiesInternal, { userId: batch.userId }),
    ctx.runQuery(internal.chat.queries.getGenerationContinuationInternal, {
      jobId: batch.parentJobId,
    }),
  ]);
  if (!job || ["completed", "failed", "cancelled", "timedOut"].includes(job.status)) {
    const terminalBatchStatus = job?.status === "completed"
      ? "completed"
      : job?.status === "cancelled"
        ? "cancelled"
        : "failed";
    await ctx.runMutation(internal.subagents.mutations.updateBatchStatus, {
      batchId: batch._id,
      status: terminalBatchStatus,
      expectedCurrentStatus: "resuming",
    });
    await ctx.runMutation(internal.chat.workflow_events.signalGenerationResume, {
      eventId: initialParams.workflowResumeEventId,
      value: { mode: "fresh" },
    });
    return true;
  }

  const typedRuns = runs as Doc<"subagentRuns">[];
  const generatedFiles = typedRuns.flatMap((run) => run.generatedFiles ?? []);
  const generatedCharts = typedRuns.flatMap((run) => run.generatedCharts ?? []);
  if (generatedFiles.length > 0) {
    await ctx.runMutation(internal.subagents.mutations.attachGeneratedFilesToMessage, {
      messageId: batch.parentMessageId,
      chatId: batch.chatId,
      userId: batch.userId,
      generatedFiles,
    });
  }
  if (generatedCharts.length > 0) {
    await ctx.runMutation(internal.subagents.mutations.attachGeneratedChartsToMessage, {
      messageId: batch.parentMessageId,
      chatId: batch.chatId,
      userId: batch.userId,
      generatedCharts,
    });
  }

  const payload = buildParentContinuationPayload(typedRuns.map((run) => ({
    childIndex: run.childIndex,
    title: run.title,
    status: run.status,
    content: run.content,
    error: run.error,
    generatedFiles: run.generatedFiles,
    generatedCharts: run.generatedCharts,
  })));
  const content = JSON.stringify(payload);
  const messages = replaceParentToolResult(
    batch.resumeConversationSeed as OpenRouterMessage[],
    batch.toolCallId,
    content,
  );
  const participantSnapshot = batch.participantSnapshot as {
    participant: ParticipantConfig;
  };
  const params = batch.paramsSnapshot as DurableParams;
  const storedResults = (batch.toolRoundResults as RecordedToolResult[] | undefined) ?? [];
  const toolResults = storedResults.filter((entry) => entry.toolCallId !== batch.toolCallId);
  toolResults.push({
    toolCallId: batch.toolCallId,
    toolName: "spawn_subagents",
    result: content,
  });
  const parentGroup = parentContinuation?.groupSnapshot as
    | GenerationContinuationCheckpoint["group"]
    | undefined;
  const checkpoint: GenerationContinuationCheckpoint = {
    roundKey: parentContinuation?.roundKey ?? initialParams.roundKey,
    participant: participantSnapshot.participant,
    group: {
      ...parentGroup,
      assistantMessageIds: [batch.parentMessageId],
      generationJobIds: [batch.parentJobId],
      userMessageId: batch.sourceUserMessageId,
      userId: batch.userId,
      expandMultiModelGroups: false,
      webSearchEnabled: resolveWebSearchToolIntent(params),
      requireZdrOverride: resolveSnapshotRequireZdr(params),
      effectiveIntegrations: params.enabledIntegrations ?? [],
      directToolNames: parentGroup?.directToolNames ?? [],
      isPro: capabilities?.isPro ?? false,
      allowSubagents: false,
      subagentBatchId: batch._id,
      executionAttemptId: params.executionAttemptId,
      executionFence: params.executionFence,
      analytics: parentGroup?.analytics ?? params.analytics,
      analyticsSource: "subagent_parent_resume",
    },
    checkpointVersion: "v2",
    messages,
    toolCalls: recordedCalls(batch.toolRoundCalls),
    toolResults,
    activeProfiles: extractProfilesFromConversation(messages),
    loadedSkills: extractLoadedSkillsFromConversation(messages),
    compactionCount: parentContinuation?.compactionCount ?? 0,
    continuationCount: parentContinuation?.continuationCount ?? 1,
  };
  let signal = await ctx.runMutation(
    internal.chat.workflow_events.installDeferredCheckpointAndSignal,
    {
    chatId: batch.chatId,
    messageId: batch.parentMessageId,
    jobId: batch.parentJobId,
    userId: batch.userId,
    checkpoint,
    eventId: initialParams.workflowResumeEventId,
    resumeBatchId: batch._id,
    },
  );
  if (signal === "missing") {
    const refreshedBatch = await ctx.runQuery(
      internal.subagents.queries.getBatchInternal,
      { batchId: batch._id },
    );
    const refreshedParams = refreshedBatch?.paramsSnapshot as DurableParams | undefined;
    if (
      refreshedParams?.workflowResumeEventId
      && (
        refreshedParams.workflowResumeEventId !== initialParams.workflowResumeEventId
        || refreshedParams.executionAttemptId !== initialParams.executionAttemptId
        || refreshedParams.executionFence !== initialParams.executionFence
      )
    ) {
      signal = await ctx.runMutation(
        internal.chat.workflow_events.installDeferredCheckpointAndSignal,
        {
          chatId: batch.chatId,
          messageId: batch.parentMessageId,
          jobId: batch.parentJobId,
          userId: batch.userId,
          checkpoint: {
            ...checkpoint,
            group: {
              ...checkpoint.group,
              executionAttemptId: refreshedParams.executionAttemptId,
              executionFence: refreshedParams.executionFence,
            },
          },
          eventId: refreshedParams.workflowResumeEventId,
          resumeBatchId: batch._id,
        },
      );
    }
  }
  if (signal === "missing") {
    const deliveredBatch = await ctx.runQuery(
      internal.subagents.queries.getBatchInternal,
      { batchId: batch._id },
    );
    const deliveredParams = deliveredBatch?.paramsSnapshot as DurableParams | undefined;
    if (
      deliveredBatch?.resumeDeliveredEventId
        === (deliveredParams?.workflowResumeEventId ?? initialParams.workflowResumeEventId)
      && deliveredBatch.resumeDeliveredAt !== undefined
    ) return true;
    const error = "Durable subagent resume checkpoint no longer matches the active execution.";
    await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
      messageId: batch.parentMessageId,
      jobId: batch.parentJobId,
      chatId: batch.chatId,
      content: `Error: ${error}`,
      status: "failed",
      error,
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
  return true;
}
