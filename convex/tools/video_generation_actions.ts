"use node";

import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  downloadVideoContent,
  pollVideoJobStatus,
  type PollVideoJobResponse,
} from "../lib/openrouter_video";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { recordMediaGenerationUsage } from "./media_generation_usage";
import {
  deferredVideoWorkflowArgsValidator,
  toolVideoExecutionValidator,
  type DeferredVideoWorkflowArgs,
  type ToolVideoExecution,
  VIDEO_GENERATION_MAX_POLL_COUNT,
} from "./video_generation_contract";
import { prepareToolVideoSubmission } from "./video_generation_submit";

const stateValidator = v.union(
  v.literal("pending"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("cancelled"),
);

type ToolVideoArgs = DeferredVideoWorkflowArgs & { execution: ToolVideoExecution };
type ToolVideoState = "pending" | "completed" | "failed" | "cancelled";

async function heartbeat(ctx: ActionCtx, execution: ToolVideoExecution): Promise<void> {
  await ctx.runMutation(internal.execution.mutations.heartbeat, {
    attemptId: execution.attemptId,
    fence: execution.fence,
    claimantId: execution.claimantId,
    leaseMs: 20 * 60 * 1_000,
  });
}

async function readOwnedJob(ctx: ActionCtx, args: ToolVideoArgs): Promise<Doc<"videoJobs">> {
  const job = await ctx.runQuery(internal.chat.queries.getVideoJobInternal, {
    videoJobId: args.videoJobId,
  });
  if (
    !job || job.userId !== args.userId || job.generationJobId !== args.jobId ||
    job.toolCallId !== args.toolCallId
  ) {
    throw new Error("TOOL_VIDEO_OWNERSHIP_MISMATCH");
  }
  return job;
}

async function parentIsTerminal(ctx: ActionCtx, jobId: Id<"generationJobs">): Promise<boolean> {
  const parent = await ctx.runQuery(internal.chat.queries.getGenerationJobInternal, { jobId });
  return !parent || ["completed", "failed", "cancelled", "timedOut"].includes(parent.status);
}

function mutationIdentity(args: ToolVideoArgs) {
  return {
    videoJobId: args.videoJobId,
    userId: args.userId,
    generationJobId: args.jobId,
    toolCallId: args.toolCallId,
    executionAttemptId: args.execution.attemptId,
    executionFence: args.execution.fence,
  };
}

export const submitToolVideoStep = internalAction({
  args: { ...deferredVideoWorkflowArgsValidator, execution: toolVideoExecutionValidator },
  returns: stateValidator,
  handler: async (ctx, args): Promise<ToolVideoState> => {
    await heartbeat(ctx, args.execution);
    const job = await readOwnedJob(ctx, args);
    if (job.status === "completed" || job.status === "failed") return job.status;
    if (await parentIsTerminal(ctx, args.jobId)) {
      await fail(ctx, args, "Cancelled by user");
      return "cancelled";
    }
    if (job.openRouterJobId) return "pending";
    const { submission, outputUploadId } = await prepareToolVideoSubmission(ctx, args, job);
    await ctx.runMutation(internal.tools.video_generation_mutations.markToolVideoSubmitted, {
      ...mutationIdentity(args),
      openRouterJobId: submission.id,
      outputUploadId,
    });
    return "pending";
  },
});

async function fail(
  ctx: ActionCtx,
  args: ToolVideoArgs,
  error: string,
  providerFailed = false,
): Promise<void> {
  const job = await readOwnedJob(ctx, args);
  await ctx.runMutation(internal.tools.video_generation_mutations.failToolVideo, {
    ...mutationIdentity(args),
    workflowResumeEventId: job.parentResumeEventId ?? args.workflowResumeEventId,
    error,
    providerFailed,
  });
}

async function publishCompletedVideo(
  ctx: ActionCtx,
  args: ToolVideoArgs,
  job: Doc<"videoJobs">,
): Promise<void> {
  let storageId: Id<"_storage"> | undefined;
  let storedByAction = false;
  let mimeType = "video/mp4";
  let sizeBytes: number | undefined;
  if (job.outputUploadId) {
    const upload = await ctx.runQuery(internal.chat.queries.getVideoOutputUploadById, {
      uploadId: job.outputUploadId,
    });
    storageId = upload?.storageId;
    mimeType = upload?.mimeType ?? mimeType;
    sizeBytes = upload?.sizeBytes;
    if (!storageId && job.pollCount < VIDEO_GENERATION_MAX_POLL_COUNT) return;
  }
  if (!storageId) {
    if (!job.openRouterJobId) throw new Error("Tool video has no provider job ID.");
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
    const data = await downloadVideoContent(apiKey, job.openRouterJobId);
    storageId = await ctx.storage.store(new Blob([data], { type: mimeType }));
    storedByAction = true;
    sizeBytes = data.byteLength;
  }
  let videoUrl: string | null;
  try {
    videoUrl = await ctx.storage.getUrl(storageId);
  } catch (error) {
    if (storedByAction) await ctx.storage.delete(storageId).catch(() => undefined);
    throw error;
  }
  if (!videoUrl) {
    if (storedByAction) await ctx.storage.delete(storageId).catch(() => undefined);
    throw new Error("Generated video storage URL is unavailable.");
  }
  const publicationArgs = {
    ...mutationIdentity(args),
    workflowResumeEventId: job.parentResumeEventId ?? args.workflowResumeEventId,
    storageId,
    videoUrl,
    mimeType,
    sizeBytes,
  };
  let accepted: boolean;
  try {
    accepted = await ctx.runMutation(
      internal.tools.video_generation_mutations.completeToolVideo,
      publicationArgs,
    );
  } catch {
    try {
      accepted = await ctx.runMutation(
        internal.tools.video_generation_mutations.completeToolVideo,
        publicationArgs,
      );
    } catch (error) {
      if (storedByAction) {
        await ctx.runMutation(
          internal.tools.media_generation_mutations.deleteUnreferencedMediaStorage,
          { storageIds: [storageId] },
        ).catch(() => undefined);
      }
      throw error;
    }
  }
  if (!accepted && storedByAction) await ctx.storage.delete(storageId);
}

export const pollToolVideoStep = internalAction({
  args: { ...deferredVideoWorkflowArgsValidator, execution: toolVideoExecutionValidator },
  returns: stateValidator,
  handler: async (ctx, args): Promise<ToolVideoState> => {
    await heartbeat(ctx, args.execution);
    const job = await readOwnedJob(ctx, args);
    if (job.status === "completed" || job.status === "failed") return job.status;
    if (await parentIsTerminal(ctx, args.jobId)) {
      await fail(ctx, args, "Cancelled by user");
      return "cancelled";
    }
    if (!job.openRouterJobId) throw new Error("Tool video has not been submitted.");
    let result: PollVideoJobResponse;
    const savedProviderTerminalStatus = job.providerTerminalStatus;
    const providerWasTerminal = job.providerTerminalAt !== undefined &&
      savedProviderTerminalStatus !== undefined;
    if (providerWasTerminal) {
      result = {
        id: job.openRouterJobId,
        status: savedProviderTerminalStatus ?? "failed",
        generation_id: job.providerGenerationId,
        usage: job.providerCost !== undefined || job.providerIsByok !== undefined
          ? { cost: job.providerCost, is_byok: job.providerIsByok }
          : undefined,
      };
    } else {
      const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
      result = await pollVideoJobStatus(apiKey, job.openRouterJobId);
    }
    const pollCount = job.pollCount + 1;
    if (result.status === "completed" || result.status === "failed") {
      await recordMediaGenerationUsage(ctx, {
        messageId: job.messageId,
        chatId: job.chatId,
        userId: args.userId,
        modelId: job.model,
        source: "media_tool_video",
        idempotencyKey: `${String(args.videoJobId)}:usage`,
      }, result.usage ? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: result.usage.cost,
        isByok: result.usage.is_byok,
      } : null, result.generation_id ?? null);
    }
    await ctx.runMutation(internal.tools.video_generation_mutations.recordToolVideoPoll, {
      ...mutationIdentity(args),
      status: result.status === "pending" ? "pending" : "in_progress",
      pollCount,
      ...(result.status === "completed" || result.status === "failed"
        ? {
            providerTerminalStatus: result.status,
            providerGenerationId: result.generation_id,
            providerCost: result.usage?.cost,
            providerIsByok: result.usage?.is_byok,
          }
        : {}),
    });
    if (result.status === "failed") {
      await fail(ctx, args, result.error?.message ?? "Video generation failed.", true);
      return "failed";
    }
    if (result.status !== "completed") return "pending";
    await publishCompletedVideo(ctx, args, { ...job, pollCount });
    const current = await readOwnedJob(ctx, args);
    if (current.status !== "completed") return "pending";
    return "completed";
  },
});

export const failToolVideoStep = internalAction({
  args: {
    ...deferredVideoWorkflowArgsValidator,
    execution: toolVideoExecutionValidator,
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await fail(ctx, args, args.error);
    return null;
  },
});
