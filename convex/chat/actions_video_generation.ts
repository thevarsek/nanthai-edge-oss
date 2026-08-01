// convex/chat/actions_video_generation.ts
// =============================================================================
// Workflow-owned video generation actions.
//
// Flow:
//   1. submitVideoGeneration  — called by runGenerationParticipant when the
//      model has hasVideoGeneration. Submits the job to OpenRouter and creates
//      a videoJobs row.
//   2. pollVideoGeneration    — Workflow step that polls OpenRouter,
//      downloads the video on completion, stores it in Convex _storage, and
//      finalizes the message.
//
// The owning Workflow controls polling intervals and retries. Max polls: 40.
// =============================================================================

"use node";

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import {
  assertModelSupportsZdr,
  isZdrEnabled,
} from "../lib/openrouter_zdr";
import {
  submitVideoJob,
  pollVideoJobStatus,
  downloadVideoContent,
  type SubmitVideoJobRequest,
} from "../lib/openrouter_video";
import {
  createVideoOutputUploadToken,
  hashVideoOutputUploadToken,
  VIDEO_OUTPUT_UPLOAD_TTL_MS,
} from "./video_output_upload_policy";
import { OPENROUTER_DEFAULT_PROVIDER_SORT } from "../lib/model_constants";
import { maybeFinalizeGenerationGroup } from "./actions_run_generation_group_finalize";
import type { VideoConfig } from "./actions_run_generation_types";
import type { AnalyticsClientMetadata } from "../analytics/client_metadata";
import type { GenerationAnalyticsSource } from "./actions_run_generation_types";
import {
  captureAssistantResponseCompleted,
  captureAssistantResponseFailure,
  captureAssistantResponseStartedEvent,
} from "./generation_analytics";
import {
  markGenerationJobAnalyticsStarted,
  markGenerationJobStreamingIfActive,
} from "./generation_start_guard";
import { resolveVideoAudioParameter } from "./video_generation_capabilities";

// -- Constants ----------------------------------------------------------------

const MAX_POLL_COUNT = 40; // ~18 min total
const VIDEO_OUTPUT_UPLOAD_PATH = "/video-output-upload";
const TERMINAL_GENERATION_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "timedOut"]);

type VideoInputAttachment = {
  type?: string;
  mimeType?: string;
  url?: string;
  storageId?: Id<"_storage">;
  videoRole?: string;
};

// -- Helpers ------------------------------------------------------------------

/**
 * Snap a requested duration to the nearest supported value for a model.
 * If the exact value is supported, it's returned unchanged.
 * Otherwise, the closest supported duration (by absolute difference) is chosen.
 * Ties favor the shorter duration.
 */
export function snapToSupportedDuration(
  requested: number,
  supported: number[],
): number {
  if (supported.length === 0) return requested;
  if (supported.includes(requested)) return requested;

  let best = supported[0];
  let bestDiff = Math.abs(requested - best);
  for (let i = 1; i < supported.length; i++) {
    const diff = Math.abs(requested - supported[i]);
    if (diff < bestDiff || (diff === bestDiff && supported[i] < best)) {
      best = supported[i];
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Snap a requested aspect ratio to the nearest supported value for a model.
 * If the exact value is supported, it's returned unchanged.
 * Otherwise returns the first supported aspect ratio as a safe fallback.
 */
export function snapToSupportedAspectRatio(
  requested: string,
  supported: string[],
): string {
  if (supported.length === 0) return requested;
  if (supported.includes(requested)) return requested;
  return supported[0]; // fallback to first supported
}

/**
 * Snap a requested resolution to the nearest supported value for a model.
 * If the exact value is supported, it's returned unchanged.
 * Otherwise returns the first supported resolution as a safe fallback.
 */
export function snapToSupportedResolution(
  requested: string,
  supported: string[],
): string {
  if (supported.length === 0) return requested;
  if (supported.includes(requested)) return requested;
  return supported[0]; // fallback to first supported
}

export function modelRequiresOutputUploadUrl(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return normalized.startsWith("x-ai/grok-imagine-video");
}

export function siteUrlForVideoOutputUploads(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.CONVEX_SITE_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;

  const convexUrl = env.CONVEX_URL?.trim().replace(/\/$/, "");
  if (convexUrl?.endsWith(".convex.cloud")) {
    return convexUrl.replace(".convex.cloud", ".convex.site");
  }

  throw new Error("CONVEX_SITE_URL must be set to use Grok Imagine video output uploads.");
}

export function buildVideoOutputUploadUrl(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const siteUrl = siteUrlForVideoOutputUploads(env);
  const url = new URL(VIDEO_OUTPUT_UPLOAD_PATH, `${siteUrl}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

// -- Types --------------------------------------------------------------------

export interface SubmitVideoGenerationArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
  userMessageId: Id<"messages">;
  assistantMessageIds: Id<"messages">[];
  generationJobIds: Id<"generationJobs">[];
  participant: {
    modelId: string;
    messageId: Id<"messages">;
    jobId: Id<"generationJobs">;
  };
  userId: string;
  searchSessionId?: Id<"searchSessions">;
  drivePickerBatchId?: Id<"drivePickerBatches">;
  videoConfig?: VideoConfig;
  analytics?: AnalyticsClientMetadata;
  analyticsSource?: GenerationAnalyticsSource;
  execution?: {
    runId: Id<"executionRuns">;
    attemptId: Id<"executionAttempts">;
    fence: number;
    claimantId: string;
  };
}

export interface PollVideoGenerationArgs extends Record<string, unknown> {
  videoJobId: Id<"videoJobs">;
  chatId: Id<"chats">;
  userMessageId: Id<"messages">;
  assistantMessageIds: Id<"messages">[];
  generationJobIds: Id<"generationJobs">[];
  messageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  userId: string;
  searchSessionId?: Id<"searchSessions">;
  drivePickerBatchId?: Id<"drivePickerBatches">;
  analytics?: AnalyticsClientMetadata;
  analyticsSource?: GenerationAnalyticsSource;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
  executionClaimantId?: string;
}

function submitExecutionFields(args: SubmitVideoGenerationArgs): {
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
} {
  return args.execution
    ? {
        executionAttemptId: args.execution.attemptId,
        executionFence: args.execution.fence,
      }
    : {};
}

function submitOwnershipFields(args: SubmitVideoGenerationArgs): {
  executionRunId?: Id<"executionRuns">;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
} {
  return args.execution
    ? { executionRunId: args.execution.runId, ...submitExecutionFields(args) }
    : {};
}

function pollExecutionFields(args: PollVideoGenerationArgs): {
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
} {
  return args.executionAttemptId && args.executionFence !== undefined
    ? {
        executionAttemptId: args.executionAttemptId,
        executionFence: args.executionFence,
      }
    : {};
}

async function validatePollFence(
  ctx: ActionCtx,
  args: PollVideoGenerationArgs,
): Promise<void> {
  if (args.executionAttemptId && args.executionFence !== undefined) {
    await ctx.runMutation(internal.execution.mutations.validateFence, {
      attemptId: args.executionAttemptId,
      fence: args.executionFence,
    });
  }
}

export async function startVideoGenerationHandler(
  ctx: ActionCtx,
  args: SubmitVideoGenerationArgs,
): Promise<void> {
  await ctx.runMutation(internal.execution.workflow_starts.startVideoGeneration, args);
}

export async function failVideoWorkflowHandler(
  ctx: ActionCtx,
  args: SubmitVideoGenerationArgs & { error: string },
): Promise<void> {
  const job = await ctx.runQuery(internal.chat.queries.getGenerationJobInternal, {
    jobId: args.participant.jobId,
  });
  if (!job || TERMINAL_GENERATION_JOB_STATUSES.has(job.status)) return;
  await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
    messageId: args.participant.messageId,
    jobId: args.participant.jobId,
    chatId: args.chatId,
    content: `Error: ${args.error}`,
    status: "failed",
    error: args.error,
    userId: args.userId,
    triggerUserMessageId: args.userMessageId,
    ...submitExecutionFields(args),
  });
  if (args.execution) {
    await ctx.runMutation(internal.chat.mutations.closeVideoParentGeneration, {
      videoRunId: args.execution.runId,
      generationJobId: args.participant.jobId,
    });
  }
  await maybeFinalizeGenerationGroup(ctx, {
    chatId: args.chatId,
    userMessageId: args.userMessageId,
    assistantMessageIds: args.assistantMessageIds,
    generationJobIds: args.generationJobIds,
    userId: args.userId,
    searchSessionId: args.searchSessionId,
  });
  await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "failed");
}

async function maybeCompleteDrivePickerBatch(
  ctx: ActionCtx,
  batchId: Id<"drivePickerBatches"> | undefined,
  status: "completed" | "failed" | "cancelled",
): Promise<void> {
  if (!batchId) return;
  await ctx.runMutation(internal.drive_picker.mutations.completeBatch, {
    batchId,
    status,
  });
}

// -- Submit handler -----------------------------------------------------------

export async function submitVideoGenerationHandler(
  ctx: ActionCtx,
  args: SubmitVideoGenerationArgs,
): Promise<void> {
  const { participant, userId, chatId } = args;
  const initialGenerationJob = await ctx.runQuery(
    internal.chat.queries.getGenerationJobInternal,
    { jobId: participant.jobId },
  );
  if (!initialGenerationJob || TERMINAL_GENERATION_JOB_STATUSES.has(initialGenerationJob.status)) {
    if (initialGenerationJob?.status === "cancelled") {
      await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "cancelled");
    }
    return;
  }
  const didStartGenerationJob = await markGenerationJobStreamingIfActive(
    ctx,
    participant.jobId,
    args.execution,
  );
  if (!didStartGenerationJob) {
    const latestGenerationJob = await ctx.runQuery(
      internal.chat.queries.getGenerationJobInternal,
      { jobId: participant.jobId },
    );
    if (latestGenerationJob?.status === "cancelled") {
      await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "cancelled");
    }
    return;
  }

  let shouldCaptureStarted = false;
  try {
    shouldCaptureStarted = await markGenerationJobAnalyticsStarted(
      ctx,
      participant.jobId,
      args.execution,
    );
  } catch (error) {
    console.warn("[analytics] failed to mark video generation job analytics start", {
      jobId: participant.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
    shouldCaptureStarted = true;
  }
  if (!shouldCaptureStarted) {
    const latestGenerationJob = await ctx.runQuery(
      internal.chat.queries.getGenerationJobInternal,
      { jobId: participant.jobId },
    );
    if (latestGenerationJob?.status === "cancelled") {
      await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "cancelled");
    }
    return;
  }
  await captureAssistantResponseStartedEvent(ctx, {
    userId,
    chatId: String(chatId),
    messageId: String(participant.messageId),
    jobId: String(participant.jobId),
    modelId: participant.modelId,
    source: args.analyticsSource ?? "video_generation",
    analytics: args.analytics,
    participantCount: args.assistantMessageIds.length,
    properties: {
      video_config_present: args.videoConfig !== undefined,
    },
  });
  const completeCancelledSubmit = async () => {
    await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "cancelled");
    await captureAssistantResponseFailure(ctx, {
      userId,
      chatId: String(chatId),
      messageId: String(participant.messageId),
      jobId: String(participant.jobId),
      modelId: participant.modelId,
      source: args.analyticsSource ?? "video_generation",
      cancelled: true,
      analytics: args.analytics,
    });
  };

  let createdVideoJobId: Id<"videoJobs"> | undefined;
  try {
    // 1. Get the user's API key
    const [apiKey, preferences] = await Promise.all([
      getRequiredUserOpenRouterApiKey(ctx, userId),
      ctx.runQuery(internal.chat.queries.getUserPreferences, { userId }),
    ]);
    const requireZdr = isZdrEnabled(preferences);

    // 2. Get the user message content (prompt)
    const userMessage = await ctx.runQuery(
      internal.chat.queries.getMessageInternal,
      { messageId: args.userMessageId },
    );
    if (!userMessage) {
      throw new ConvexError({
        code: "NOT_FOUND" as const,
        message: "User message not found",
      });
    }

    // 3. Resolve image attachments → frame_images / input_references
    const frameImages: SubmitVideoJobRequest["frame_images"] = [];
    const inputReferences: SubmitVideoJobRequest["input_references"] = [];

    if (userMessage.attachments && userMessage.attachments.length > 0) {
      // Filter to image-type attachments only
      const imageAttachments = (userMessage.attachments as VideoInputAttachment[]).filter(
        (attachment) =>
          attachment.type === "image" ||
          attachment.mimeType?.startsWith("image/"),
      );

      let defaultRoleIndex = 0; // tracks smart-default assignment position
      for (const attachment of imageAttachments) {
        // Resolve URL: prefer direct url, fall back to storage
        let imageUrl: string | undefined = attachment.url;
        if (!imageUrl && attachment.storageId) {
          imageUrl = await ctx.storage.getUrl(attachment.storageId) ?? undefined;
        }
        if (!imageUrl) continue; // skip attachments with no resolvable URL

        // Determine role: explicit videoRole wins, otherwise smart defaults
        // Smart defaults: 1st image → first_frame, 2nd → last_frame, 3rd+ → reference
        const role: string =
          attachment.videoRole ??
          (defaultRoleIndex === 0
            ? "first_frame"
            : defaultRoleIndex === 1
              ? "last_frame"
              : "reference");
        defaultRoleIndex++;

        if (role === "first_frame" || role === "last_frame") {
          frameImages.push({
            type: "image_url",
            image_url: { url: imageUrl },
            frame_type: role,
          });
        } else {
          // "reference" or any unknown role → input_references
          inputReferences.push({
            type: "image_url",
            image_url: { url: imageUrl },
          });
        }
      }
    }

    // 4. Query model capabilities to validate config against supported values
    const modelCaps = await ctx.runQuery(
      internal.chat.queries.getModelCapabilities,
      { modelId: participant.modelId },
    );
    if (requireZdr) {
      assertModelSupportsZdr({
        modelId: participant.modelId,
        capabilities: modelCaps,
        feature: "Video generation",
      });
    }
    const videoCaps = modelCaps?.videoCapabilities;

    // 5. Build the video request using client videoConfig (with sensible defaults),
    //    snapping values to model-supported options when the requested value is unsupported.
    const vc = args.videoConfig;
    const requestedDuration = vc?.duration ?? 5;
    const requestedAspectRatio = vc?.aspectRatio ?? "16:9";

    const finalDuration = videoCaps?.supportedDurations?.length
      ? snapToSupportedDuration(requestedDuration, videoCaps.supportedDurations)
      : requestedDuration;
    const finalAspectRatio = videoCaps?.supportedAspectRatios?.length
      ? snapToSupportedAspectRatio(requestedAspectRatio, videoCaps.supportedAspectRatios)
      : requestedAspectRatio;

    if (finalDuration !== requestedDuration) {
      console.log(
        `Video config: snapped duration ${requestedDuration}s → ${finalDuration}s for ${participant.modelId} (supported: ${videoCaps!.supportedDurations.join(", ")})`,
      );
    }
    if (finalAspectRatio !== requestedAspectRatio) {
      console.log(
        `Video config: snapped aspect ratio ${requestedAspectRatio} → ${finalAspectRatio} for ${participant.modelId} (supported: ${videoCaps!.supportedAspectRatios.join(", ")})`,
      );
    }

    const request: SubmitVideoJobRequest = {
      model: participant.modelId,
      prompt: userMessage.content,
      duration: finalDuration,
      aspect_ratio: finalAspectRatio,
      provider: {
        ...OPENROUTER_DEFAULT_PROVIDER_SORT,
        ...(requireZdr ? { zdr: true } : {}),
      },
    };
    const generateAudio = resolveVideoAudioParameter(
      videoCaps?.generateAudio,
      vc?.generateAudio,
    );
    if (generateAudio !== undefined) {
      request.generate_audio = generateAudio;
    }
    let outputUploadId: Id<"videoOutputUploads"> | undefined;
    if (modelRequiresOutputUploadUrl(participant.modelId)) {
      const outputUploadToken = createVideoOutputUploadToken();
      const tokenHash = await hashVideoOutputUploadToken(outputUploadToken);
      outputUploadId = await ctx.runMutation(internal.chat.mutations.createVideoOutputUploadSession, {
        tokenHash,
        expiresAt: Date.now() + VIDEO_OUTPUT_UPLOAD_TTL_MS,
        messageId: participant.messageId,
        chatId,
        userId,
        ...submitOwnershipFields(args),
      });
      request.output = {
        upload_url: buildVideoOutputUploadUrl(outputUploadToken),
      };
    }
    // Only send resolution if explicitly provided; snap to supported if needed
    if (vc?.resolution) {
      const finalResolution = videoCaps?.supportedResolutions?.length
        ? snapToSupportedResolution(vc.resolution, videoCaps.supportedResolutions)
        : vc.resolution;
      if (finalResolution !== vc.resolution) {
        console.log(
          `Video config: snapped resolution ${vc.resolution} → ${finalResolution} for ${participant.modelId}`,
        );
      }
      request.resolution = finalResolution;
    }
    // Attach frame images and references only if the model supports them.
    // Models like Sora 2 Pro and Veo 3.1 have empty supportedFrameImages
    // and silently ignore these fields, but it's cleaner not to send them.
    const supportedFrames = videoCaps?.supportedFrameImages ?? [];
    if (frameImages.length > 0 && supportedFrames.length > 0) {
      // Filter to only frame types this model actually supports
      request.frame_images = frameImages.filter(
        (f) => supportedFrames.includes(f.frame_type),
      );
      if (request.frame_images.length === 0) delete request.frame_images;
    }
    if (inputReferences.length > 0 && supportedFrames.length > 0) {
      request.input_references = inputReferences;
    }

    const preSubmitGenerationJob = await ctx.runQuery(
      internal.chat.queries.getGenerationJobInternal,
      { jobId: participant.jobId },
    );
    if (!preSubmitGenerationJob || TERMINAL_GENERATION_JOB_STATUSES.has(preSubmitGenerationJob.status)) {
      if (preSubmitGenerationJob?.status === "cancelled") {
        await completeCancelledSubmit();
      }
      return;
    }

    // 6. Submit to OpenRouter behind the immutable operation journal. OpenRouter's
    // video endpoint does not expose an idempotency key, so an ambiguous dispatch
    // is never replayed automatically.
    let submission: Awaited<ReturnType<typeof submitVideoJob>>;
    const execution = args.execution;
    const operationKey = `${String(participant.jobId)}:video-provider-submit`;
    if (execution) {
      const requestBytes = new TextEncoder().encode(JSON.stringify(request));
      const digest = await crypto.subtle.digest("SHA-256", requestBytes);
      const inputHash = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      const decision = await ctx.runMutation(internal.execution.operations.prepare, {
        jobId: participant.jobId,
        attemptId: execution.attemptId,
        fence: execution.fence,
        operationKey,
        toolName: "video_provider_submit",
        toolCallId: operationKey,
        effect: "write",
        retry: "never",
        authorizationSource: args.analyticsSource === "scheduled_job"
          ? "configured_automation"
          : "explicit_user_turn",
        inputHash,
      });
      if (decision.decision === "refuse") throw new Error(decision.reason);
      if (decision.decision === "replay") {
        submission = JSON.parse(decision.resultJson) as Awaited<ReturnType<typeof submitVideoJob>>;
      } else {
        await ctx.runMutation(internal.execution.operations.markDispatched, {
          attemptId: execution.attemptId,
          fence: execution.fence,
          operationKey,
        });
        try {
          submission = await submitVideoJob(apiKey, request);
        } catch (error) {
          await ctx.runMutation(internal.execution.operations.markOutcomeUnknown, {
            attemptId: execution.attemptId,
            fence: execution.fence,
            operationKey,
            errorSummary: error instanceof Error ? error.message : String(error),
          }).catch(() => undefined);
          throw error;
        }
        try {
          await ctx.runMutation(internal.execution.operations.complete, {
            attemptId: execution.attemptId,
            fence: execution.fence,
            operationKey,
            externalId: submission.id,
            resultJson: JSON.stringify(submission),
          });
        } catch (error) {
          await ctx.runMutation(internal.execution.operations.recordObservedExternalOutcome, {
            attemptId: execution.attemptId,
            operationKey,
            externalId: submission.id,
            resultJson: JSON.stringify(submission),
          }).catch(() => undefined);
          throw error;
        }
      }
    } else {
      submission = await submitVideoJob(apiKey, request);
    }
    // 7. Persist provider ownership immediately after dispatch. This row is
    // retained even if cancellation wins the following generation-job check.
    const videoJobId: Id<"videoJobs"> = await ctx.runMutation(
      internal.chat.mutations.createVideoJob,
      {
        messageId: participant.messageId,
        chatId,
        userId,
        openRouterJobId: submission.id,
        outputUploadId,
        model: participant.modelId,
        prompt: userMessage.content,
        videoConfig: vc ? {
          resolution: vc.resolution,
          aspectRatio: vc.aspectRatio,
          duration: vc.duration,
          generateAudio: vc.generateAudio,
        } : undefined,
        ...submitOwnershipFields(args),
      },
    );
    createdVideoJobId = videoJobId;

    const latestGenerationJob = await ctx.runQuery(
      internal.chat.queries.getGenerationJobInternal,
      { jobId: participant.jobId },
    );
    if (!latestGenerationJob || TERMINAL_GENERATION_JOB_STATUSES.has(latestGenerationJob.status)) {
      if (latestGenerationJob?.status === "cancelled") {
        await ctx.runMutation(internal.chat.mutations.updateVideoJobStatus, {
          videoJobId,
          status: "failed",
          error: "Cancelled by user",
          ...submitExecutionFields(args),
        }).catch(() => undefined);
        await completeCancelledSubmit();
      }
      return;
    }

    await ctx.runMutation(internal.execution.mutations.ensureGeneration, {
      jobId: participant.jobId,
    });
  } catch (error) {
    // Finalize the message as failed
    const errorMessage =
      error instanceof Error ? error.message : "Unknown video generation error";
    if (createdVideoJobId) {
      try {
        await ctx.runMutation(internal.chat.mutations.updateVideoJobStatus, {
          videoJobId: createdVideoJobId,
          status: "failed",
          error: errorMessage,
          ...submitExecutionFields(args),
        });
      } catch {
        // Best-effort: the message generation failure below remains authoritative.
      }
    }
    await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
      messageId: participant.messageId,
      jobId: participant.jobId,
      chatId,
      content: `Error: ${errorMessage}`,
      status: "failed",
      error: errorMessage,
      userId,
      triggerUserMessageId: args.userMessageId,
      ...submitExecutionFields(args),
    });
    if (args.execution) {
      await ctx.runMutation(internal.chat.mutations.closeVideoParentGeneration, {
        videoRunId: args.execution.runId,
        generationJobId: participant.jobId,
      });
    }

    await maybeFinalizeGenerationGroup(ctx, {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageIds: args.assistantMessageIds,
      generationJobIds: args.generationJobIds,
      userId,
      searchSessionId: args.searchSessionId,
    });

    await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "failed");
    await captureAssistantResponseFailure(ctx, {
      userId,
      chatId: String(chatId),
      messageId: String(participant.messageId),
      jobId: String(participant.jobId),
      modelId: participant.modelId,
      source: args.analyticsSource ?? "video_generation",
      error,
      analytics: args.analytics,
    });
  }
}

// -- Poll handler -------------------------------------------------------------

export async function pollVideoGenerationHandler(
  ctx: ActionCtx,
  args: PollVideoGenerationArgs,
): Promise<void> {
  const { videoJobId, chatId, messageId, jobId, userId } = args;

  try {
    if (
      args.executionAttemptId
      && args.executionFence !== undefined
      && args.executionClaimantId
    ) {
      await ctx.runMutation(internal.execution.mutations.heartbeat, {
        attemptId: args.executionAttemptId,
        fence: args.executionFence,
        claimantId: args.executionClaimantId,
        leaseMs: 20 * 60 * 1000,
      });
    }
    // 1. Read the videoJobs row
    const videoJob = await ctx.runQuery(
      internal.chat.queries.getVideoJobInternal,
      { videoJobId },
    );
    if (!videoJob) {
      // Job was deleted — nothing to do
      return;
    }

    // If already terminal, bail out (race with cancellation or previous completion)
    if (videoJob.status === "completed" || videoJob.status === "failed") {
      return;
    }

    // Check if the generation job was cancelled by user
    const generationJob = await ctx.runQuery(
      internal.chat.queries.getGenerationJobInternal,
      { jobId },
    );
    if (generationJob?.status === "cancelled") {
      await ctx.runMutation(internal.chat.mutations.updateVideoJobStatus, {
        videoJobId,
        status: "failed",
        error: "Cancelled by user",
        ...pollExecutionFields(args),
      });
      await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "cancelled");
      const cancellationPrecededVideoJob =
        typeof generationJob.completedAt !== "number" ||
        generationJob.completedAt <= videoJob._creationTime;
      if (cancellationPrecededVideoJob) {
        await captureAssistantResponseFailure(ctx, {
          userId,
          chatId: String(chatId),
          messageId: String(messageId),
          jobId: String(jobId),
          modelId: videoJob.model,
          source: args.analyticsSource ?? "video_generation",
          cancelled: true,
          analytics: args.analytics,
          properties: {
            video_job_id: String(videoJobId),
          },
        });
      }
      return;
    }

    // 2. Get the user's API key
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, userId);

    // 3. Poll OpenRouter
    const pollResult = await pollVideoJobStatus(apiKey, videoJob.openRouterJobId);
    await validatePollFence(ctx, args);

    // 4. Update the videoJobs row with poll count.
    // NOTE: When OpenRouter reports "completed", we keep the videoJob as
    // "in_progress" here — handleVideoCompleted sets the final terminal
    // status after verifying the content URL exists and the video is stored.
    // This avoids a window where getVideoJobStatus reports "completed" but
    // the message is actually "failed" due to a missing URL.
    const newPollCount = videoJob.pollCount + 1;
    await ctx.runMutation(internal.chat.mutations.updateVideoJobPoll, {
      videoJobId,
      status: pollResult.status === "in_progress"
        || pollResult.status === "completed"
        || pollResult.status === "failed"
          ? "in_progress"
          : "pending",
      pollCount: newPollCount,
      error: pollResult.status === "failed" ? "Video generation failed" : undefined,
      ...pollExecutionFields(args),
    });

    // Provider quiescence is a separate fact from our local publication
    // outcome. Record it only when the provider explicitly reports terminal;
    // local poll timeouts, transport errors, and storage failures must remain
    // eligible for provider reconciliation.
    if (pollResult.status === "completed" || pollResult.status === "failed") {
      await ctx.runMutation(internal.chat.mutations.markVideoProviderTerminal, {
        videoJobId,
        status: pollResult.status,
      });
    }

    // 5. Handle terminal states
    if (pollResult.status === "completed") {
      await handleVideoCompleted(ctx, args, pollResult, apiKey, {
        _creationTime: videoJob._creationTime,
        createdAt: videoJob.createdAt,
        openRouterJobId: videoJob.openRouterJobId,
        outputUploadId: videoJob.outputUploadId,
        pollCount: newPollCount,
        model: videoJob.model,
      });
      return;
    }

    if (pollResult.status === "failed") {
      const errorMsg = "Video generation failed";
      await ctx.runMutation(internal.chat.mutations.settleVideoGeneration, {
        videoJobId,
        messageId,
        jobId,
        chatId,
        content: `Error: ${errorMsg}`,
        status: "failed",
        error: errorMsg,
        userId,
        triggerUserMessageId: args.userMessageId,
        ...pollExecutionFields(args),
      });

      await maybeFinalizeGenerationGroup(ctx, {
        chatId: args.chatId,
        userMessageId: args.userMessageId,
        assistantMessageIds: args.assistantMessageIds,
        generationJobIds: args.generationJobIds,
        userId,
        searchSessionId: args.searchSessionId,
      });
      await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "failed");
      await captureAssistantResponseFailure(ctx, {
        userId,
        chatId: String(chatId),
        messageId: String(messageId),
        jobId: String(jobId),
        modelId: videoJob.model,
        source: args.analyticsSource ?? "video_generation",
        error: new Error(
          [pollResult.error?.code, pollResult.error?.message]
            .filter((part): part is string => typeof part === "string" && part.length > 0)
            .join(" ") || "Video generation failed",
        ),
        analytics: args.analytics,
      });
      return;
    }

    // 6. If still pending/in_progress, check max polls
    if (newPollCount >= MAX_POLL_COUNT) {
      const timeoutMsg = `Video generation timed out after ${newPollCount} polls`;
      await ctx.runMutation(internal.chat.mutations.settleVideoGeneration, {
        videoJobId,
        messageId,
        jobId,
        chatId,
        content: `Error: ${timeoutMsg}`,
        status: "failed",
        error: timeoutMsg,
        userId,
        triggerUserMessageId: args.userMessageId,
        ...pollExecutionFields(args),
      });

      await maybeFinalizeGenerationGroup(ctx, {
        chatId: args.chatId,
        userMessageId: args.userMessageId,
        assistantMessageIds: args.assistantMessageIds,
        generationJobIds: args.generationJobIds,
        userId,
        searchSessionId: args.searchSessionId,
      });
      await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "failed");
      await captureAssistantResponseFailure(ctx, {
        userId,
        chatId: String(chatId),
        messageId: String(messageId),
        jobId: String(jobId),
        modelId: videoJob.model,
        source: args.analyticsSource ?? "video_generation",
        error: new Error("Video generation timed out"),
        analytics: args.analytics,
      });
      return;
    }

    // Convex Workflow owns the sleep before the next poll.
  } catch (error) {
    // Non-retryable error — finalize as failed
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error during video poll";
    let modelId: string | null = null;
    let currentVideoStatus: string | null = null;
    try {
      const videoJob = await ctx.runQuery(
        internal.chat.queries.getVideoJobInternal,
        { videoJobId },
      );
      modelId = videoJob?.model ?? null;
      currentVideoStatus = videoJob?.status ?? null;
    } catch {
      // Best-effort analytics enrichment only.
    }
    if (currentVideoStatus === "completed" || currentVideoStatus === "failed") return;

    await ctx.runMutation(internal.chat.mutations.settleVideoGeneration, {
      videoJobId,
      messageId,
      jobId,
      chatId,
      content: `Error: ${errorMessage}`,
      status: "failed",
      error: errorMessage,
      userId,
      triggerUserMessageId: args.userMessageId,
      ...pollExecutionFields(args),
    });

    await maybeFinalizeGenerationGroup(ctx, {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageIds: args.assistantMessageIds,
      generationJobIds: args.generationJobIds,
      userId,
      searchSessionId: args.searchSessionId,
    });
    await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "failed");
    await captureAssistantResponseFailure(ctx, {
      userId,
      chatId: String(chatId),
      messageId: String(messageId),
      jobId: String(jobId),
      modelId,
      source: args.analyticsSource ?? "video_generation",
      error,
      analytics: args.analytics,
    });
  }
}

// -- Video completion handler -------------------------------------------------

async function handleVideoCompleted(
  ctx: ActionCtx,
  args: PollVideoGenerationArgs,
  pollResult: { usage?: { cost?: number; is_byok?: boolean }; generation_id?: string },
  apiKey: string,
  videoJob: {
    _creationTime?: number;
    createdAt?: number;
    openRouterJobId: string;
    outputUploadId?: Id<"videoOutputUploads">;
    pollCount: number;
    model?: string;
  },
): Promise<void> {
  const { chatId, messageId, jobId, userId } = args;

  let storageId: Id<"_storage"> | undefined;
  let storedByThisAction = false;
  let storedMimeType = "video/mp4";
  let storedSizeBytes: number | undefined;

  if (!videoJob.outputUploadId) {
    const videoData = await downloadVideoContent(apiKey, videoJob.openRouterJobId);
    await validatePollFence(ctx, args);
    const blob = new Blob([videoData], { type: storedMimeType });
    storageId = await ctx.storage.store(blob);
    storedByThisAction = true;
    storedSizeBytes = videoData.byteLength;
    try {
      await validatePollFence(ctx, args);
    } catch (error) {
      await ctx.storage.delete(storageId).catch(() => undefined);
      throw error;
    }
  } else {
    const upload = await ctx.runQuery(
      internal.chat.queries.getVideoOutputUploadById,
      { uploadId: videoJob.outputUploadId },
    );
    if (upload?.storageId) {
      await validatePollFence(ctx, args);
      storageId = upload.storageId;
      storedMimeType = upload.mimeType ?? storedMimeType;
      storedSizeBytes = upload.sizeBytes;
    } else if (videoJob.pollCount < MAX_POLL_COUNT) {
      return;
    }
  }

  if (!storageId) {
    const errorMsg = videoJob.outputUploadId
      ? "Video completed but provider upload did not arrive"
      : "Video completed but no content URL returned";
    // Mark the videoJob as failed — OpenRouter said "completed" but gave no URL
    await ctx.runMutation(internal.chat.mutations.settleVideoGeneration, {
      videoJobId: args.videoJobId,
      messageId,
      jobId,
      chatId,
      content: `Error: ${errorMsg}`,
      status: "failed",
      error: errorMsg,
      userId,
      triggerUserMessageId: args.userMessageId,
      ...pollExecutionFields(args),
    });

    await maybeFinalizeGenerationGroup(ctx, {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageIds: args.assistantMessageIds,
      generationJobIds: args.generationJobIds,
      userId,
      searchSessionId: args.searchSessionId,
    });
    await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "failed");
    await captureAssistantResponseFailure(ctx, {
      userId,
      chatId: String(chatId),
      messageId: String(messageId),
      jobId: String(jobId),
      modelId: videoJob.model,
      source: args.analyticsSource ?? "video_generation",
      error: new Error("Video completed without stored output"),
      analytics: args.analytics,
    });
    return;
  }

  const videoUrl = await ctx.storage.getUrl(storageId);
  if (!videoUrl) {
    const errorMsg = "Failed to get storage URL for video";
    if (storedByThisAction) {
      await ctx.storage.delete(storageId).catch(() => undefined);
    }
    await ctx.runMutation(internal.chat.mutations.settleVideoGeneration, {
      videoJobId: args.videoJobId,
      messageId,
      jobId,
      chatId,
      content: `Error: ${errorMsg}`,
      status: "failed",
      error: errorMsg,
      userId,
      triggerUserMessageId: args.userMessageId,
      ...pollExecutionFields(args),
    });

    await maybeFinalizeGenerationGroup(ctx, {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageIds: args.assistantMessageIds,
      generationJobIds: args.generationJobIds,
      userId,
      searchSessionId: args.searchSessionId,
    });
    await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "failed");
    await captureAssistantResponseFailure(ctx, {
      userId,
      chatId: String(chatId),
      messageId: String(messageId),
      jobId: String(jobId),
      modelId: videoJob.model,
      source: args.analyticsSource ?? "video_generation",
      error: new Error("Video storage URL unavailable"),
      analytics: args.analytics,
    });
    return;
  }

  // 4. Build usage object if available
  const usage = pollResult.usage
    ? {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cost: pollResult.usage.cost,
        isByok: pollResult.usage.is_byok,
      }
    : undefined;

  // 5. Publish every durable completion write in one fenced transaction.
  try {
    await ctx.runMutation(internal.chat.mutations.settleVideoGeneration, {
      videoJobId: args.videoJobId,
      messageId,
      jobId,
      chatId,
      content: "",
      status: "completed",
      videoUrls: [videoUrl],
      usage,
      userId,
      triggerUserMessageId: args.userMessageId,
      media: {
        storageId,
        mimeType: storedMimeType,
        sizeBytes: storedSizeBytes,
      },
      ...pollExecutionFields(args),
    });
  } catch (error) {
    if (storedByThisAction) {
      await ctx.storage.delete(storageId).catch(() => undefined);
    }
    throw error;
  }

  // 6. Finalize the generation group
  await maybeFinalizeGenerationGroup(ctx, {
    chatId: args.chatId,
    userMessageId: args.userMessageId,
    assistantMessageIds: args.assistantMessageIds,
    generationJobIds: args.generationJobIds,
    userId,
    searchSessionId: args.searchSessionId,
  });
  await maybeCompleteDrivePickerBatch(ctx, args.drivePickerBatchId, "completed");
  await captureAssistantResponseCompleted(ctx, {
    userId,
    chatId: String(chatId),
    messageId: String(messageId),
    jobId: String(jobId),
    modelId: videoJob.model,
    source: args.analyticsSource ?? "video_generation",
    usage,
    analytics: args.analytics,
    durationMs: typeof (videoJob._creationTime ?? videoJob.createdAt) === "number"
      ? Date.now() - (videoJob._creationTime ?? videoJob.createdAt ?? Date.now())
      : undefined,
    participantCount: args.assistantMessageIds.length,
    properties: {
      video_job_id: String(args.videoJobId),
    },
  });
}
