"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { scheduleGenerationContinuation } from "../chat/actions_run_generation_continuation";
import type { ParticipantConfig } from "../chat/actions_run_generation_types";
import {
  TERMINAL_GENERATION_JOB_STATUSES,
  type GenerationContinuationCheckpoint,
  type GenerationContinuationGroupSnapshot,
  type RunGenerationParticipantArgs,
} from "../chat/generation_continuation_shared";
import type { OpenRouterMessage } from "../lib/openrouter";
import type { ToolResult } from "../tools/registry";
import type { DeferredPresentationWorkflowArgs } from "./deferred_workflow_refs";
import { safePresentationErrorMessage } from "./limits";
import { getProjectInternalRef } from "./action_refs";

const signalGenerationResumeRef = makeFunctionReference<
  "mutation",
  { eventId: string; value: { mode: "checkpoint" } },
  boolean
>("chat/workflow_events:signalGenerationResume") as unknown as FunctionReference<
  "mutation",
  "internal",
  { eventId: string; value: { mode: "checkpoint" } },
  boolean
>;

const completeDeferredToolRef = makeFunctionReference<
  "mutation",
  {
    jobId: Id<"generationJobs">;
    userId: string;
    toolCallId: string;
    toolName: string;
    result: string;
    isError?: boolean;
    eventId: string;
  },
  "resumed" | "duplicate" | "missing" | "terminal"
>("chat/workflow_events:completeDeferredTool") as unknown as FunctionReference<
  "mutation",
  "internal",
  {
    jobId: Id<"generationJobs">;
    userId: string;
    toolCallId: string;
    toolName: string;
    result: string;
    isError?: boolean;
    eventId: string;
  },
  "resumed" | "duplicate" | "missing" | "terminal"
>;

function replaceToolResultMessage(
  messages: OpenRouterMessage[],
  toolCallId: string,
  content: string,
): OpenRouterMessage[] {
  return messages.map((message) =>
    message.role === "tool" && message.tool_call_id === toolCallId
      ? { ...message, content }
      : message
  );
}

function generatedPresentationFile(result: ToolResult) {
  if (!result.success || !result.data || typeof result.data !== "object") return null;
  const data = result.data as Record<string, unknown>;
  if (
    typeof data.storageId !== "string" ||
    typeof data.filename !== "string" ||
    typeof data.mimeType !== "string" ||
    typeof data.toolName !== "string"
  ) {
    return null;
  }
  return {
    storageId: data.storageId as Id<"_storage">,
    filename: data.filename,
    mimeType: data.mimeType,
    sizeBytes: typeof data.sizeBytes === "number" ? data.sizeBytes : undefined,
    toolName: data.toolName,
    title: typeof data.title === "string" ? data.title : undefined,
    summary: typeof data.summary === "string" ? data.summary : undefined,
    presentationProjectId:
      typeof data.presentationProjectId === "string"
        ? data.presentationProjectId as Id<"presentationProjects">
        : undefined,
    presentationRevision:
      typeof data.presentationRevision === "number"
        ? data.presentationRevision
        : undefined,
  };
}

async function finalizeWithoutContinuation(
  ctx: ActionCtx,
  args: DeferredPresentationWorkflowArgs,
  job: {
    _id: Id<"generationJobs">;
    chatId: Id<"chats">;
    messageId: Id<"messages">;
  },
  result: ToolResult,
): Promise<void> {
  const file = generatedPresentationFile(result);
  const error = result.success
    ? "The presentation finished, but its chat continuation was unavailable. Please try again."
    : result.error ?? "Presentation generation failed. Please try again.";
  const toolResult = {
    toolCallId: args.toolCallId,
    toolName: "create_presentation",
    result: JSON.stringify(result.success ? result.data : { error }),
    isError: result.success ? undefined : true,
  };
  await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
    messageId: job.messageId,
    jobId: job._id,
    chatId: job.chatId,
    content: file ? "Presentation created." : `Error: ${error}`,
    status: file ? "completed" : "failed",
    error: file ? undefined : error,
    userId: args.userId,
    toolResults: [toolResult],
    generatedFiles: file ? [file] : undefined,
  });
}

async function resumeParentWithResult(
  ctx: ActionCtx,
  args: DeferredPresentationWorkflowArgs,
  result: ToolResult,
): Promise<void> {
  const [continuation, job, project] = await Promise.all([
    ctx.runQuery(internal.chat.queries.getGenerationContinuationInternal, {
      jobId: args.jobId,
    }),
    ctx.runQuery(internal.chat.queries.getGenerationJobInternal, {
      jobId: args.jobId,
    }),
    ctx.runQuery(getProjectInternalRef, {
      projectId: args.projectId,
      userId: args.userId,
    }),
  ]);
  if (!job || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)) return;
  if (job.userId !== args.userId) return;
  const parentEventId = project?.parentResumeEventId ?? args.workflowResumeEventId;
  if (!continuation) {
    await finalizeWithoutContinuation(ctx, args, job, result);
    if (parentEventId) {
      await ctx.runMutation(signalGenerationResumeRef, {
        eventId: parentEventId,
        value: { mode: "checkpoint" },
      });
    }
    return;
  }
  if (continuation.userId !== args.userId) return;

  const content = JSON.stringify(result.success
    ? result.data
    : {
      error: result.error,
      ...(result.data && typeof result.data === "object"
        ? result.data as Record<string, unknown>
      : {}),
    });
  if (parentEventId) {
    const resumeStatus = await ctx.runMutation(completeDeferredToolRef, {
      jobId: args.jobId,
      userId: args.userId,
      toolCallId: args.toolCallId,
      toolName: "create_presentation",
      result: content,
      ...(result.success ? {} : { isError: true }),
      eventId: parentEventId,
    });
    if (resumeStatus === "missing") {
      throw new Error("PRESENTATION_PARENT_CHECKPOINT_NOT_FOUND");
    }
    return;
  }
  const storedResults = [...(continuation.toolResults ?? [])];
  const resultIndex = storedResults.findIndex((entry) => entry.toolCallId === args.toolCallId);
  const storedResult = {
    toolCallId: args.toolCallId,
    toolName: "create_presentation",
    result: content,
    isError: result.success ? undefined : true,
  };
  if (resultIndex >= 0) storedResults[resultIndex] = storedResult;
  else storedResults.push(storedResult);

  const group = continuation.groupSnapshot as GenerationContinuationGroupSnapshot;
  const participant = continuation.participantSnapshot as ParticipantConfig;
  const runArgs: RunGenerationParticipantArgs = {
    chatId: continuation.chatId,
    userMessageId: group.userMessageId,
    assistantMessageIds: group.assistantMessageIds,
    generationJobIds: group.generationJobIds,
    participant,
    userId: group.userId,
    expandMultiModelGroups: group.expandMultiModelGroups,
    webSearchEnabled: group.webSearchEnabled,
    requireZdrOverride: group.requireZdrOverride,
    effectiveIntegrations: group.effectiveIntegrations,
    directToolNames: group.directToolNames,
    isPro: group.isPro,
    allowSubagents: group.allowSubagents,
    disableTools: group.disableTools,
    searchSessionId: group.searchSessionId,
    subagentBatchId: group.subagentBatchId,
    drivePickerBatchId: group.drivePickerBatchId,
    imageConfig: group.imageConfig,
    chatSkillOverrides: group.chatSkillOverrides,
    chatIntegrationOverrides: group.chatIntegrationOverrides,
    personaSkillOverrides: group.personaSkillOverrides,
    skillDefaults: group.skillDefaults,
    integrationDefaults: group.integrationDefaults,
    analytics: group.analytics,
    analyticsSource: group.analyticsSource,
    resumeExpected: true,
  };
  const checkpoint: GenerationContinuationCheckpoint = {
    roundKey: continuation.roundKey,
    participant,
    group,
    checkpointVersion: continuation.checkpointVersion ?? "v2",
    assembledCheckpoint: continuation.assembledCheckpoint as GenerationContinuationCheckpoint["assembledCheckpoint"],
    messages: replaceToolResultMessage(
      continuation.requestMessages as OpenRouterMessage[],
      args.toolCallId,
      content,
    ),
    usage: continuation.usage ?? undefined,
    toolCalls: continuation.toolCalls ?? [],
    toolResults: storedResults,
    activeProfiles: continuation.activeProfiles as GenerationContinuationCheckpoint["activeProfiles"],
    loadedSkills: (continuation.loadedSkills ?? []) as GenerationContinuationCheckpoint["loadedSkills"],
    compactionCount: continuation.compactionCount,
    continuationCount: continuation.continuationCount,
    partialContent: continuation.partialContent,
    partialReasoning: continuation.partialReasoning,
  };
  await scheduleGenerationContinuation(ctx, runArgs, checkpoint);
}

export async function failAndResume(
  ctx: ActionCtx,
  args: DeferredPresentationWorkflowArgs,
  error: unknown,
): Promise<void> {
  await resumeParentWithResult(ctx, args, {
    success: false,
    data: {
      presentationProjectId: args.projectId,
      retryable: false,
      backendRepairAttempted: true,
    },
    error: safePresentationErrorMessage(error),
  });
}

export async function completeAndResume(
  ctx: ActionCtx,
  args: DeferredPresentationWorkflowArgs,
  result: ToolResult,
): Promise<void> {
  await resumeParentWithResult(ctx, args, result);
}
