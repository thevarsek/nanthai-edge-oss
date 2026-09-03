import type { ActionCtx, MutationCtx } from "../_generated/server";
import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { durableWorkflow } from "../execution/components";
import { claimExecutionRun } from "../execution/attempts";
import { linkExecutionComponent } from "../execution/component_refs";
import { ensureGenerationExecution } from "../execution/control_plane";
import { createExecutionRun } from "../execution/runs";
import { ownedWorkflowCompletionRef } from "../execution/workflow_lifecycle";
import { scheduleOwnedWorkflowWatchdog } from "../execution/owned_workflow_watchdog";
import { scheduleGenerationContinuation } from "../chat/actions_run_generation_continuation";
import type {
  GenerationContinuationCheckpoint,
  RunGenerationParticipantArgs,
} from "../chat/generation_continuation_shared";
import {
  deferredVideoWorkflowArgsValidator,
  runToolVideoWorkflowRef,
  startToolVideoWorkflowRef,
  type DeferredVideoWorkflowArgs,
} from "./video_generation_contract";

export async function scheduleDeferredVideoWorkflow(
  ctx: ActionCtx,
  args: RunGenerationParticipantArgs,
  checkpoint: GenerationContinuationCheckpoint,
  video: { videoJobId: DeferredVideoWorkflowArgs["videoJobId"]; toolCallId: string },
): Promise<void> {
  if (!args.workflowResumeEventId) {
    throw new Error("VIDEO_TOOL_PARENT_WORKFLOW_EVENT_REQUIRED");
  }
  await scheduleGenerationContinuation(
    ctx,
    { ...args, workflowManaged: true },
    {
      ...checkpoint,
      deferredResumeEventId: args.workflowResumeEventId,
      deferredOwnership: {
        kind: "video",
        videoJobId: video.videoJobId,
        toolCallId: video.toolCallId,
      },
    },
  );
  await ctx.runMutation(startToolVideoWorkflowRef, {
    videoJobId: video.videoJobId,
    userId: args.userId,
    jobId: args.participant.jobId,
    toolCallId: video.toolCallId,
    workflowResumeEventId: args.workflowResumeEventId,
  });
}

export async function startToolVideoWorkflowHandler(
  ctx: MutationCtx,
  args: DeferredVideoWorkflowArgs,
): Promise<string> {
  const videoJob = await ctx.db.get(args.videoJobId);
  if (
    !videoJob || videoJob.userId !== args.userId ||
    videoJob.generationJobId !== args.jobId || videoJob.toolCallId !== args.toolCallId
  ) {
    throw new Error("TOOL_VIDEO_OWNERSHIP_MISMATCH");
  }
  if (videoJob.workflowId) {
    if (videoJob.parentResumeEventId !== args.workflowResumeEventId) {
      await ctx.db.patch(videoJob._id, {
        parentResumeEventId: args.workflowResumeEventId,
      });
    }
    return videoJob.workflowId;
  }
  const parent = await ensureGenerationExecution(ctx, args.jobId);
  if (!parent) throw new Error("Tool video parent execution was unavailable.");
  const execution = await createExecutionRun(ctx, {
    userId: args.userId,
    runKey: `video-tool:${String(args.videoJobId)}`,
    kind: "media",
    requestedPlacement: "cloud",
    chatId: videoJob.chatId,
    sourceMessageId: videoJob.sourceUserMessageId,
    generationJobId: args.jobId,
    domainType: "video_generation",
    domainId: String(videoJob.messageId),
    parentRunId: parent.runId,
    initialAttempt: {
      executorKind: "convex_workflow",
      placement: "cloud",
      adapterId: "convex-workflow",
      provider: "openrouter",
      modelId: videoJob.model,
    },
  });
  const claimantId = `video-tool:${String(args.videoJobId)}`;
  const active = await claimExecutionRun(ctx, {
    runId: execution.runId,
    claimantId,
    leaseMs: 20 * 60 * 1_000,
  });
  if (!active) throw new Error("TOOL_VIDEO_EXECUTION_NOT_CLAIMABLE");
  const workflowId = String(await durableWorkflow.start(
    ctx,
    runToolVideoWorkflowRef,
    {
      ...args,
      execution: {
        runId: active.runId,
        attemptId: active.attemptId,
        fence: active.fence,
        claimantId,
      },
    },
    { startAsync: true, onComplete: ownedWorkflowCompletionRef, context: {} },
  ));
  await ctx.db.patch(active.attemptId, {
    componentOperationId: workflowId,
    updatedAt: Date.now(),
  });
  await linkExecutionComponent(ctx, {
    runId: active.runId,
    attemptId: active.attemptId,
    fence: active.fence,
    adapterId: "convex-workflow",
    operationId: workflowId,
    role: "video-tool-workflow",
  });
  await scheduleOwnedWorkflowWatchdog(ctx, { workflowId, context: {} });
  await ctx.db.patch(videoJob._id, {
    workflowId,
    parentResumeEventId: args.workflowResumeEventId,
    executionRunId: active.runId,
    executionAttemptId: active.attemptId,
    executionFence: active.fence,
  });
  return workflowId;
}

export const startToolVideoWorkflow = internalMutation({
  args: deferredVideoWorkflowArgsValidator,
  returns: v.string(),
  handler: startToolVideoWorkflowHandler,
});
