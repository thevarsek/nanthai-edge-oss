import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertCurrentFence, terminalizeExecution } from "../execution/control_plane";
import { GENERATED_MEDIA_REFERENCE_TRACKING_VERSION } from "../lib/generated_media_reference_tracking";
import { storageHasContentReferences } from "../knowledge_base/delete_helpers";
import {
  ensureVideoProviderReconciliationRef,
  releaseVideoOutputUpload,
} from "./video_cleanup";
import type { FinalizeGenerationArgs } from "./mutations_internal_handlers";
import { finalizeGenerationHandler } from "./mutations_internal_handlers";

type VideoFence = {
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
};

type CreateVideoJobArgs = VideoFence & {
  messageId: Id<"messages">;
  chatId: Id<"chats">;
  userId: string;
  openRouterJobId?: string;
  outputUploadId?: Id<"videoOutputUploads">;
  model: string;
  prompt: string;
  videoConfig?: {
    resolution?: string;
    aspectRatio?: string;
    duration?: number;
    generateAudio?: boolean;
  };
  executionRunId?: Id<"executionRuns">;
  generationJobId?: Id<"generationJobs">;
};

type VideoStatusArgs = VideoFence & {
  videoJobId: Id<"videoJobs">;
  status: "pending" | "in_progress" | "completed" | "failed";
  error?: string;
};

async function assertOptionalVideoFence(ctx: MutationCtx, args: VideoFence): Promise<void> {
  if ((args.executionAttemptId === undefined) !== (args.executionFence === undefined)) {
    throw new Error("INCOMPLETE_EXECUTION_FENCE");
  }
  if (args.executionAttemptId && args.executionFence !== undefined) {
    await assertCurrentFence(ctx, args.executionAttemptId, args.executionFence);
  }
}

export async function createVideoJobHandler(
  ctx: MutationCtx,
  args: CreateVideoJobArgs,
): Promise<Id<"videoJobs">> {
  await assertOptionalVideoFence(ctx, args);
  const existing = await ctx.db
    .query("videoJobs")
    .withIndex("by_messageId", (query) => query.eq("messageId", args.messageId))
    .first();
  if (existing) {
    if (
      existing.openRouterJobId && args.openRouterJobId &&
      existing.openRouterJobId !== args.openRouterJobId
    ) {
      throw new Error("VIDEO_PROVIDER_SUBMISSION_CONFLICT");
    }
    if (existing.userId !== args.userId || existing.chatId !== args.chatId) {
      throw new Error("VIDEO_JOB_OWNERSHIP_MISMATCH");
    }
    const patch: Record<string, unknown> = {};
    if (!existing.openRouterJobId && args.openRouterJobId) {
      patch.openRouterJobId = args.openRouterJobId;
      patch.status = "in_progress";
    }
    if (!existing.outputUploadId && args.outputUploadId) {
      patch.outputUploadId = args.outputUploadId;
    }
    if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert("videoJobs", {
    messageId: args.messageId,
    chatId: args.chatId,
    userId: args.userId,
    openRouterJobId: args.openRouterJobId,
    outputUploadId: args.outputUploadId,
    status: "pending",
    model: args.model,
    prompt: args.prompt,
    videoConfig: args.videoConfig,
    pollCount: 0,
    executionRunId: args.executionRunId,
    generationJobId: args.generationJobId,
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
    createdAt: Date.now(),
  });
}

export async function createVideoOutputUploadSessionHandler(
  ctx: MutationCtx,
  args: VideoFence & {
    videoJobId: Id<"videoJobs">;
    tokenHash: string;
    expiresAt: number;
    messageId: Id<"messages">;
    chatId: Id<"chats">;
    userId: string;
    executionRunId?: Id<"executionRuns">;
  },
): Promise<Id<"videoOutputUploads">> {
  await assertOptionalVideoFence(ctx, args);
  const job = await ctx.db.get(args.videoJobId);
  if (
    !job || job.userId !== args.userId || job.chatId !== args.chatId ||
    job.messageId !== args.messageId ||
    (args.executionRunId !== undefined && job.executionRunId !== args.executionRunId)
  ) {
    throw new Error("VIDEO_OUTPUT_UPLOAD_OWNERSHIP_MISMATCH");
  }
  if (job.outputUploadId) {
    const existing = await ctx.db.get(job.outputUploadId);
    if (
      existing?.tokenHash === args.tokenHash &&
      existing.messageId === args.messageId && existing.chatId === args.chatId &&
      existing.userId === args.userId && existing.expiresAt === args.expiresAt
    ) return existing._id;
    if (existing) throw new Error("VIDEO_OUTPUT_UPLOAD_CONFLICT");
  }
  const uploadId = await ctx.db.insert("videoOutputUploads", {
    tokenHash: args.tokenHash,
    messageId: args.messageId,
    chatId: args.chatId,
    userId: args.userId,
    status: "pending",
    executionRunId: args.executionRunId,
    executionAttemptId: args.executionAttemptId,
    executionFence: args.executionFence,
    createdAt: Date.now(),
    expiresAt: args.expiresAt,
  });
  await ctx.db.patch(job._id, { outputUploadId: uploadId });
  return uploadId;
}

export async function completeVideoOutputUploadHandler(
  ctx: MutationCtx,
  args: {
    uploadId: Id<"videoOutputUploads">;
    expectedTokenHash: string;
    storageId: Id<"_storage">;
    mimeType: string;
    sizeBytes: number;
  },
): Promise<boolean> {
  const session = await ctx.db.get(args.uploadId);
  if (!session || session.tokenHash !== args.expectedTokenHash) return false;
  if (session.status === "uploaded") {
    return session.storageId === args.storageId &&
      session.mimeType === args.mimeType && session.sizeBytes === args.sizeBytes;
  }
  if (session.status !== "pending") return false;
  if (session.expiresAt <= Date.now()) return false;
  await ctx.db.patch(session._id, {
    status: "uploaded",
    storageId: args.storageId,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    uploadedAt: Date.now(),
  });
  return true;
}

export async function discardVideoOutputUploadCandidateHandler(
  ctx: MutationCtx,
  args: {
    uploadId: Id<"videoOutputUploads">;
    storageId: Id<"_storage">;
  },
): Promise<void> {
  const session = await ctx.db.get(args.uploadId);
  if (session?.storageId === args.storageId) return;
  if (await storageHasContentReferences(ctx, args.storageId)) return;
  await ctx.storage.delete(args.storageId).catch(() => undefined);
}

export async function updateVideoJobStatusHandler(
  ctx: MutationCtx,
  args: VideoStatusArgs,
): Promise<void> {
  await assertOptionalVideoFence(ctx, args);
  const job = await ctx.db.get(args.videoJobId);
  if (!job) return;
  const outputUploadId = job.outputUploadId;
  const now = Date.now();
  await ctx.db.patch(args.videoJobId, {
    status: args.status,
    error: args.error,
    ...(args.status === "failed" ? { outputUploadId: undefined } : {}),
    lastPolledAt: now,
  });
  if (
    args.status === "failed" && job.openRouterJobId &&
    job.providerTerminalAt === undefined && job.executionRunId
  ) {
    await ensureVideoProviderReconciliationRef(ctx, {
      runId: job.executionRunId,
      attemptId: job.executionAttemptId,
      userId: job.userId,
      videoJobId: job._id,
      now,
    });
  }
  if (args.status === "failed" && outputUploadId) {
    await releaseVideoOutputUpload(ctx, outputUploadId);
  }
}

export async function updateVideoJobPollHandler(
  ctx: MutationCtx,
  args: VideoStatusArgs & { pollCount: number },
): Promise<void> {
  await assertOptionalVideoFence(ctx, args);
  await ctx.db.patch(args.videoJobId, {
    status: args.status,
    pollCount: args.pollCount,
    error: args.error,
    lastPolledAt: Date.now(),
  });
}

export async function markVideoProviderTerminalHandler(
  ctx: MutationCtx,
  args: {
    videoJobId: Id<"videoJobs">;
    status: "completed" | "failed";
    generationId?: string;
    cost?: number;
    isByok?: boolean;
  },
): Promise<void> {
  const job = await ctx.db.get(args.videoJobId);
  if (!job || job.providerTerminalAt !== undefined) return;
  await ctx.db.patch(job._id, {
    providerTerminalAt: Date.now(),
    providerTerminalStatus: args.status,
    providerGenerationId: args.generationId,
    providerCost: args.cost,
    providerIsByok: args.isByok,
    lastPolledAt: Date.now(),
  });
}

export async function insertGeneratedMediaHandler(
  ctx: MutationCtx,
  args: VideoFence & {
    userId: string;
    chatId: Id<"chats">;
    messageId: Id<"messages">;
    storageId: Id<"_storage">;
    type: "image" | "video";
    mimeType: string;
    sizeBytes?: number;
    width?: number;
    height?: number;
    durationSeconds?: number;
    model?: string;
    prompt?: string;
  },
): Promise<Id<"generatedMedia">> {
  await assertOptionalVideoFence(ctx, args);
  return await ctx.db.insert("generatedMedia", {
    userId: args.userId,
    chatId: args.chatId,
    messageId: args.messageId,
    storageId: args.storageId,
    type: args.type,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    width: args.width,
    height: args.height,
    durationSeconds: args.durationSeconds,
    model: args.model,
    prompt: args.prompt,
    referenceTrackingVersion: GENERATED_MEDIA_REFERENCE_TRACKING_VERSION,
    createdAt: Date.now(),
  });
}

type SettleVideoGenerationArgs = FinalizeGenerationArgs & VideoFence & {
  videoJobId: Id<"videoJobs">;
  media?: {
    storageId: Id<"_storage">;
    mimeType: string;
    sizeBytes?: number;
  };
};

/** Atomically publishes the video domain row, media reference, and message. */
export async function settleVideoGenerationHandler(
  ctx: MutationCtx,
  args: SettleVideoGenerationArgs,
): Promise<void> {
  await assertOptionalVideoFence(ctx, args);
  const videoJob = await ctx.db.get(args.videoJobId);
  if (!videoJob) throw new Error("VIDEO_JOB_NOT_FOUND");
  if (videoJob.status === "completed" || videoJob.status === "failed") return;
  if (args.status === "completed" && !args.media) {
    throw new Error("VIDEO_COMPLETION_MEDIA_REQUIRED");
  }
  const outputUploadId = videoJob.outputUploadId;
  const now = Date.now();
  await ctx.db.patch(args.videoJobId, {
    status: args.status === "completed" ? "completed" : "failed",
    error: args.error,
    outputUploadId: undefined,
    lastPolledAt: now,
  });
  if (args.media) {
    await ctx.db.insert("generatedMedia", {
      userId: args.userId,
      chatId: args.chatId,
      messageId: args.messageId,
      storageId: args.media.storageId,
      type: "video",
      mimeType: args.media.mimeType,
      sizeBytes: args.media.sizeBytes,
      referenceTrackingVersion: GENERATED_MEDIA_REFERENCE_TRACKING_VERSION,
      createdAt: Date.now(),
    });
  }
  if (
    args.status !== "completed" && videoJob.openRouterJobId &&
    videoJob.providerTerminalAt === undefined && videoJob.executionRunId
  ) {
    await ensureVideoProviderReconciliationRef(ctx, {
      runId: videoJob.executionRunId,
      attemptId: videoJob.executionAttemptId,
      userId: videoJob.userId,
      videoJobId: videoJob._id,
      now,
    });
  }
  if (outputUploadId) {
    await releaseVideoOutputUpload(ctx, outputUploadId);
  }
  await finalizeGenerationHandler(ctx, args);
  await terminalizeParentGenerationExecution(ctx, videoJob.executionRunId, args.jobId);
}

export async function terminalizeParentGenerationExecution(
  ctx: MutationCtx,
  videoRunId: Id<"executionRuns"> | undefined,
  generationJobId: Id<"generationJobs">,
): Promise<void> {
  if (!videoRunId) return;
  const videoRun = await ctx.db.get(videoRunId);
  if (!videoRun?.parentRunId) return;
  const parentRun = await ctx.db.get(videoRun.parentRunId);
  if (
    !parentRun?.activeAttemptId
    || ["completed", "failed", "cancelled"].includes(parentRun.state)
  ) return;
  const parentAttempt = await ctx.db.get(parentRun.activeAttemptId);
  if (!parentAttempt) return;
  const generationJob = await ctx.db.get(generationJobId);
  const outcome = generationJob?.status === "completed"
    ? "completed"
    : generationJob?.status === "cancelled" ? "cancelled" : "failed";
  await terminalizeExecution(ctx, {
    attemptId: parentAttempt._id,
    fence: parentAttempt.fence,
    outcome,
    summary: outcome === "completed"
      ? "Owned video generation completed"
      : outcome === "cancelled"
        ? "Owned video generation cancelled"
        : "Owned video generation failed",
    allowExpiredLease: true,
  });
}
