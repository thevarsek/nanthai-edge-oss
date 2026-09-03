import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { completeDeferredToolHandler } from "../chat/workflow_resume_handlers";
import { releaseVideoOutputUpload } from "../chat/video_cleanup";
import { assertCurrentFence } from "../execution/control_plane";
import { completeOperationHandler } from "../execution/operations";
import { GENERATED_MEDIA_REFERENCE_TRACKING_VERSION } from
  "../lib/generated_media_reference_tracking";
import { failOwnedToolVideo } from "./video_generation_failure";
const videoConfigValidator = v.object({
  resolution: v.optional(v.string()),
  aspectRatio: v.optional(v.string()),
  duration: v.optional(v.number()),
  generateAudio: v.optional(v.boolean()),
  seed: v.optional(v.number()),
});
const executionValidator = {
  executionAttemptId: v.id("executionAttempts"),
  executionFence: v.number(),
};
type ToolVideoIdentity = {
  videoJobId: Id<"videoJobs">;
  userId: string;
  generationJobId: Id<"generationJobs">;
  toolCallId: string;
  executionAttemptId: Id<"executionAttempts">;
  executionFence: number;
};
async function ownedToolVideoJob(ctx: MutationCtx, args: ToolVideoIdentity) {
  await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
  const job = await ctx.db.get(args.videoJobId);
  if (
    !job || job.userId !== args.userId ||
    job.generationJobId !== args.generationJobId ||
    job.toolCallId !== args.toolCallId ||
    job.executionAttemptId !== args.executionAttemptId ||
    job.executionFence !== args.executionFence
  ) {
    throw new Error("TOOL_VIDEO_OWNERSHIP_MISMATCH");
  }
  return job;
}
function pendingVideoToolResult(
  videoJobId: Id<"videoJobs">,
  modelId: string,
  prompt: string,
): string {
  return JSON.stringify({
    success: true,
    data: { kind: "video", status: "generating", videoJobId, modelId, prompt },
    deferred: { kind: "video_generation", data: { videoJobId } },
  });
}
export async function createToolVideoJobHandler(
  ctx: MutationCtx,
  args: {
    userId: string;
    chatId: Id<"chats">;
    messageId: Id<"messages">;
    sourceUserMessageId: Id<"messages">;
    generationJobId: Id<"generationJobs">;
    toolCallId: string;
    toolOperationKey: string;
    model: string;
    prompt: string;
    videoConfig: {
      resolution?: string;
      aspectRatio?: string;
      duration?: number;
      generateAudio?: boolean;
      seed?: number;
    };
    requireZdr: boolean;
    executionAttemptId: Id<"executionAttempts">;
    executionFence: number;
  },
): Promise<{ videoJobId: Id<"videoJobs">; resultJson: string }> {
  await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
  const [generationJob, message, sourceMessage] = await Promise.all([
    ctx.db.get(args.generationJobId),
    ctx.db.get(args.messageId),
    ctx.db.get(args.sourceUserMessageId),
  ]);
  if (
    !generationJob || !message || !sourceMessage ||
    generationJob.userId !== args.userId || message.userId !== args.userId ||
    sourceMessage.userId !== args.userId || generationJob.chatId !== args.chatId ||
    message.chatId !== args.chatId || sourceMessage.chatId !== args.chatId ||
    generationJob.messageId !== args.messageId ||
    !["queued", "streaming"].includes(generationJob.status)
  ) {
    throw new Error("MEDIA_GENERATION_CONTEXT_STALE");
  }
  const existing = await ctx.db
    .query("videoJobs")
    .withIndex("by_parent_tool", (query) => query
      .eq("generationJobId", args.generationJobId)
      .eq("toolCallId", args.toolCallId))
    .unique();
  let videoJobId: Id<"videoJobs">;
  if (existing) {
    if (
      existing.toolOperationKey !== args.toolOperationKey ||
      existing.model !== args.model || existing.prompt !== args.prompt
    ) {
      throw new Error("TOOL_VIDEO_OPERATION_CONFLICT");
    }
    videoJobId = existing._id;
  } else {
    videoJobId = await ctx.db.insert("videoJobs", {
      messageId: args.messageId,
      chatId: args.chatId,
      userId: args.userId,
      sourceUserMessageId: args.sourceUserMessageId,
      generationJobId: args.generationJobId,
      toolCallId: args.toolCallId,
      toolOperationKey: args.toolOperationKey,
      status: "pending",
      model: args.model,
      prompt: args.prompt,
      videoConfig: args.videoConfig,
      requireZdr: args.requireZdr,
      pollCount: 0,
      createdAt: Date.now(),
    });
  }
  const resultJson = pendingVideoToolResult(videoJobId, args.model, args.prompt);
  await completeOperationHandler(ctx, {
    attemptId: args.executionAttemptId,
    fence: args.executionFence,
    operationKey: args.toolOperationKey,
    resultJson,
  });
  return { videoJobId, resultJson };
}
export const createToolVideoJob = internalMutation({
  args: {
    userId: v.string(),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    sourceUserMessageId: v.id("messages"),
    generationJobId: v.id("generationJobs"),
    toolCallId: v.string(),
    toolOperationKey: v.string(),
    model: v.string(),
    prompt: v.string(),
    videoConfig: videoConfigValidator,
    requireZdr: v.boolean(),
    ...executionValidator,
  },
  returns: v.object({
    videoJobId: v.id("videoJobs"),
    resultJson: v.string(),
  }),
  handler: createToolVideoJobHandler,
});
export const markToolVideoSubmitted = internalMutation({
  args: {
    videoJobId: v.id("videoJobs"),
    userId: v.string(),
    generationJobId: v.id("generationJobs"),
    toolCallId: v.string(),
    openRouterJobId: v.string(),
    outputUploadId: v.optional(v.id("videoOutputUploads")),
    ...executionValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ownedToolVideoJob(ctx, args);
    if (job.openRouterJobId && job.openRouterJobId !== args.openRouterJobId) {
      throw new Error("TOOL_VIDEO_PROVIDER_CONFLICT");
    }
    if (!job.openRouterJobId) {
      await ctx.db.patch(job._id, {
        openRouterJobId: args.openRouterJobId,
        outputUploadId: args.outputUploadId,
        status: "in_progress",
        lastPolledAt: Date.now(),
      });
    }
    return null;
  },
});
export const recordToolVideoPoll = internalMutation({
  args: {
    videoJobId: v.id("videoJobs"),
    userId: v.string(),
    generationJobId: v.id("generationJobs"),
    toolCallId: v.string(),
    status: v.union(v.literal("pending"), v.literal("in_progress")),
    pollCount: v.number(),
    providerTerminalStatus: v.optional(v.union(v.literal("completed"), v.literal("failed"))),
    providerGenerationId: v.optional(v.string()),
    providerCost: v.optional(v.number()),
    providerIsByok: v.optional(v.boolean()),
    ...executionValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ownedToolVideoJob(ctx, args);
    if (job.status === "completed" || job.status === "failed") return null;
    await ctx.db.patch(job._id, {
      status: args.status,
      pollCount: args.pollCount,
      lastPolledAt: Date.now(),
      ...(args.providerTerminalStatus
        ? {
            providerTerminalAt: job.providerTerminalAt ?? Date.now(),
            providerTerminalStatus: args.providerTerminalStatus,
            providerGenerationId: args.providerGenerationId,
            providerCost: args.providerCost,
            providerIsByok: args.providerIsByok,
          }
        : {}),
    });
    return null;
  },
});
export const completeToolVideo = internalMutation({
  args: {
    videoJobId: v.id("videoJobs"),
    userId: v.string(),
    generationJobId: v.id("generationJobs"),
    toolCallId: v.string(),
    workflowResumeEventId: v.string(),
    storageId: v.id("_storage"),
    videoUrl: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    ...executionValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ownedToolVideoJob(ctx, args);
    if (job.status === "completed") return job.storageId === args.storageId;
    if (job.parentResumeEventId !== args.workflowResumeEventId) {
      throw new Error("TOOL_VIDEO_RESUME_EVENT_MISMATCH");
    }
    const outputUploadId = job.outputUploadId;
    const result = JSON.stringify({
      kind: "video",
      status: "completed",
      modelId: job.model,
      prompt: job.prompt,
      storageId: args.storageId,
      videoStorageId: args.storageId,
      videoUrl: args.videoUrl,
      videoUrls: [args.videoUrl],
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      durationSeconds: job.videoConfig?.duration,
    });
    const message = await ctx.db.get(job.messageId);
    if (
      !message || message.userId !== args.userId
      || message.chatId !== job.chatId
    ) {
      throw new Error("TOOL_VIDEO_MESSAGE_OWNERSHIP_MISMATCH");
    }
    await ctx.db.patch(message._id, {
      videoUrls: Array.from(new Set([...(message.videoUrls ?? []), args.videoUrl])),
    });
    const resume = await completeDeferredToolHandler(ctx, {
      jobId: args.generationJobId,
      userId: args.userId,
      toolCallId: args.toolCallId,
      toolName: "generate_video",
      result,
      eventId: args.workflowResumeEventId,
    });
    if (resume === "missing" || resume === "terminal") {
      throw new Error(`TOOL_VIDEO_PARENT_${resume.toUpperCase()}`);
    }
    await ctx.db.insert("generatedMedia", {
      userId: args.userId,
      chatId: job.chatId,
      messageId: job.messageId,
      storageId: args.storageId,
      type: "video",
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      durationSeconds: job.videoConfig?.duration,
      model: job.model,
      prompt: job.prompt,
      referenceTrackingVersion: GENERATED_MEDIA_REFERENCE_TRACKING_VERSION,
      createdAt: Date.now(),
    });
    await ctx.db.patch(job._id, {
      status: "completed",
      outputUploadId: undefined,
      storageId: args.storageId,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      providerTerminalAt: job.providerTerminalAt ?? Date.now(),
      providerTerminalStatus: "completed",
      lastPolledAt: Date.now(),
    });
    if (outputUploadId) {
      await releaseVideoOutputUpload(ctx, outputUploadId);
    }
    return true;
  },
});

export const failToolVideo = internalMutation({
  args: {
    videoJobId: v.id("videoJobs"),
    userId: v.string(),
    generationJobId: v.id("generationJobs"),
    toolCallId: v.string(),
    workflowResumeEventId: v.string(),
    error: v.string(),
    providerFailed: v.optional(v.boolean()),
    ...executionValidator,
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const job = await ownedToolVideoJob(ctx, args);
    const result = await failOwnedToolVideo(ctx, {
      job,
      error: args.error,
      workflowResumeEventId: args.workflowResumeEventId,
      providerFailed: args.providerFailed,
    });
    if (result === "missing") throw new Error("TOOL_VIDEO_PARENT_MISSING");
    return result;
  },
});
