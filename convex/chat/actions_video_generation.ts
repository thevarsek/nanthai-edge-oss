// convex/chat/actions_video_generation.ts
// =============================================================================
// Self-scheduling video generation actions.
//
// Flow:
//   1. submitVideoGeneration  — called by runGenerationParticipant when the
//      model has hasVideoGeneration. Submits the job to OpenRouter, creates a
//      videoJobs row, and schedules the first poll.
//   2. pollVideoGeneration    — self-scheduling action that polls OpenRouter,
//      downloads the video on completion, stores it in Convex _storage, and
//      finalizes the message.
//
// Polling intervals: 15s for the first 4 polls, 30s after.
// Max polls: 40 (giving ~18 minutes total, well within reason for video gen).
// =============================================================================

"use node";

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import {
  submitVideoJob,
  pollVideoJobStatus,
  downloadVideoContent,
  type SubmitVideoJobRequest,
} from "../lib/openrouter_video";
import { maybeFinalizeGenerationGroup } from "./actions_run_generation_group_finalize";
import type { VideoConfig } from "./actions_run_generation_types";

// -- Constants ----------------------------------------------------------------

const FAST_POLL_INTERVAL_MS = 15_000; // 15s for first 4 polls
const SLOW_POLL_INTERVAL_MS = 30_000; // 30s after
const FAST_POLL_COUNT = 4;
const MAX_POLL_COUNT = 40; // ~18 min total

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
  videoConfig?: VideoConfig;
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
}

// -- Submit handler -----------------------------------------------------------

export async function submitVideoGenerationHandler(
  ctx: ActionCtx,
  args: SubmitVideoGenerationArgs,
): Promise<void> {
  const { participant, userId, chatId } = args;

  try {
    // 1. Get the user's API key
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, userId);

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
      const imageAttachments = userMessage.attachments.filter(
        (a: any) => a.type === "image" || a.mimeType?.startsWith("image/"),
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
      generate_audio: vc?.generateAudio ?? true,
    };
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

    // 6. Submit to OpenRouter
    const submission = await submitVideoJob(apiKey, request);

    // 7. Create the videoJobs row
    const videoJobId: Id<"videoJobs"> = await ctx.runMutation(
      internal.chat.mutations.createVideoJob,
      {
        messageId: participant.messageId,
        chatId,
        userId,
        openRouterJobId: submission.id,
        pollingUrl: submission.polling_url,
        model: participant.modelId,
        prompt: userMessage.content,
        videoConfig: vc ? {
          resolution: vc.resolution,
          aspectRatio: vc.aspectRatio,
          duration: vc.duration,
          generateAudio: vc.generateAudio,
        } : undefined,
      },
    );

    // 8. Update the generation job to "streaming" (signals progress to clients)
    await ctx.runMutation(internal.chat.mutations.updateJobStatus, {
      jobId: participant.jobId,
      status: "streaming",
    });

    // 9. Schedule the first poll
    await ctx.scheduler.runAfter(
      FAST_POLL_INTERVAL_MS,
      internal.chat.actions.pollVideoGeneration,
      {
        videoJobId,
        chatId: args.chatId,
        userMessageId: args.userMessageId,
        assistantMessageIds: args.assistantMessageIds,
        generationJobIds: args.generationJobIds,
        messageId: participant.messageId,
        jobId: participant.jobId,
        userId,
        searchSessionId: args.searchSessionId,
      },
    );
  } catch (error) {
    // Finalize the message as failed
    const errorMessage =
      error instanceof Error ? error.message : "Unknown video generation error";
    await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
      messageId: participant.messageId,
      jobId: participant.jobId,
      chatId,
      content: `Error: ${errorMessage}`,
      status: "failed",
      error: errorMessage,
      userId,
      triggerUserMessageId: args.userMessageId,
    });

    await maybeFinalizeGenerationGroup(ctx, {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageIds: args.assistantMessageIds,
      generationJobIds: args.generationJobIds,
      userId,
      searchSessionId: args.searchSessionId,
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
      });
      return;
    }

    // 2. Get the user's API key
    const apiKey = await getRequiredUserOpenRouterApiKey(ctx, userId);

    // 3. Poll OpenRouter
    const pollResult = await pollVideoJobStatus(apiKey, videoJob.pollingUrl);

    // 4. Update the videoJobs row with poll count.
    // NOTE: When OpenRouter reports "completed", we keep the videoJob as
    // "in_progress" here — handleVideoCompleted sets the final terminal
    // status after verifying the content URL exists and the video is stored.
    // This avoids a window where getVideoJobStatus reports "completed" but
    // the message is actually "failed" due to a missing URL.
    const newPollCount = videoJob.pollCount + 1;
    await ctx.runMutation(internal.chat.mutations.updateVideoJobPoll, {
      videoJobId,
      status: pollResult.status === "failed"
        ? "failed"
        : pollResult.status === "in_progress" || pollResult.status === "completed"
          ? "in_progress"
          : "pending",
      pollCount: newPollCount,
      error: pollResult.error?.message,
    });

    // 5. Handle terminal states
    if (pollResult.status === "completed") {
      await handleVideoCompleted(ctx, args, pollResult, apiKey);
      return;
    }

    if (pollResult.status === "failed") {
      const errorMsg = pollResult.error?.message ?? "Video generation failed";
      await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
        messageId,
        jobId,
        chatId,
        content: `Error: ${errorMsg}`,
        status: "failed",
        error: errorMsg,
        userId,
        triggerUserMessageId: args.userMessageId,
      });

      await maybeFinalizeGenerationGroup(ctx, {
        chatId: args.chatId,
        userMessageId: args.userMessageId,
        assistantMessageIds: args.assistantMessageIds,
        generationJobIds: args.generationJobIds,
        userId,
        searchSessionId: args.searchSessionId,
      });
      return;
    }

    // 6. If still pending/in_progress, check max polls
    if (newPollCount >= MAX_POLL_COUNT) {
      const timeoutMsg = `Video generation timed out after ${newPollCount} polls`;
      await ctx.runMutation(internal.chat.mutations.updateVideoJobStatus, {
        videoJobId,
        status: "failed",
        error: timeoutMsg,
      });
      await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
        messageId,
        jobId,
        chatId,
        content: `Error: ${timeoutMsg}`,
        status: "failed",
        error: timeoutMsg,
        userId,
        triggerUserMessageId: args.userMessageId,
      });

      await maybeFinalizeGenerationGroup(ctx, {
        chatId: args.chatId,
        userMessageId: args.userMessageId,
        assistantMessageIds: args.assistantMessageIds,
        generationJobIds: args.generationJobIds,
        userId,
        searchSessionId: args.searchSessionId,
      });
      return;
    }

    // 7. Schedule the next poll
    const interval =
      newPollCount < FAST_POLL_COUNT
        ? FAST_POLL_INTERVAL_MS
        : SLOW_POLL_INTERVAL_MS;

    await ctx.scheduler.runAfter(
      interval,
      internal.chat.actions.pollVideoGeneration,
      args,
    );
  } catch (error) {
    // Non-retryable error — finalize as failed
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error during video poll";

    // Try to mark the video job as failed
    try {
      await ctx.runMutation(internal.chat.mutations.updateVideoJobStatus, {
        videoJobId,
        status: "failed",
        error: errorMessage,
      });
    } catch {
      // Best-effort — the videoJob row may not exist
    }

    await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
      messageId,
      jobId,
      chatId,
      content: `Error: ${errorMessage}`,
      status: "failed",
      error: errorMessage,
      userId,
      triggerUserMessageId: args.userMessageId,
    });

    await maybeFinalizeGenerationGroup(ctx, {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageIds: args.assistantMessageIds,
      generationJobIds: args.generationJobIds,
      userId,
      searchSessionId: args.searchSessionId,
    });
  }
}

// -- Video completion handler -------------------------------------------------

async function handleVideoCompleted(
  ctx: ActionCtx,
  args: PollVideoGenerationArgs,
  pollResult: { unsigned_urls?: string[]; usage?: { cost?: number; is_byok?: boolean }; generation_id?: string },
  apiKey: string,
): Promise<void> {
  const { chatId, messageId, jobId, userId } = args;

  const contentUrl = pollResult.unsigned_urls?.[0];
  if (!contentUrl) {
    const errorMsg = "Video completed but no content URL returned";
    // Mark the videoJob as failed — OpenRouter said "completed" but gave no URL
    await ctx.runMutation(internal.chat.mutations.updateVideoJobStatus, {
      videoJobId: args.videoJobId,
      status: "failed",
      error: errorMsg,
    });
    await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
      messageId,
      jobId,
      chatId,
      content: `Error: ${errorMsg}`,
      status: "failed",
      error: errorMsg,
      userId,
      triggerUserMessageId: args.userMessageId,
    });

    await maybeFinalizeGenerationGroup(ctx, {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageIds: args.assistantMessageIds,
      generationJobIds: args.generationJobIds,
      userId,
      searchSessionId: args.searchSessionId,
    });
    return;
  }

  // 1. Download the video
  const videoData = await downloadVideoContent(apiKey, contentUrl);

  // 2. Store in Convex _storage
  const blob = new Blob([videoData], { type: "video/mp4" });
  const storageId = await ctx.storage.store(blob);

  // 3. Get a serving URL for the video
  const videoUrl = await ctx.storage.getUrl(storageId);
  if (!videoUrl) {
    const errorMsg = "Failed to get storage URL for video";
    await ctx.runMutation(internal.chat.mutations.updateVideoJobStatus, {
      videoJobId: args.videoJobId,
      status: "failed",
      error: errorMsg,
    });
    await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
      messageId,
      jobId,
      chatId,
      content: `Error: ${errorMsg}`,
      status: "failed",
      error: errorMsg,
      userId,
      triggerUserMessageId: args.userMessageId,
    });

    await maybeFinalizeGenerationGroup(ctx, {
      chatId: args.chatId,
      userMessageId: args.userMessageId,
      assistantMessageIds: args.assistantMessageIds,
      generationJobIds: args.generationJobIds,
      userId,
      searchSessionId: args.searchSessionId,
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

  // 5. Mark the videoJob as completed — URL is verified, video is stored
  await ctx.runMutation(internal.chat.mutations.updateVideoJobStatus, {
    videoJobId: args.videoJobId,
    status: "completed",
  });

  // 6. Finalize the message with videoUrls
  await ctx.runMutation(internal.chat.mutations.finalizeGeneration, {
    messageId,
    jobId,
    chatId,
    content: "", // Video messages have no text content
    status: "completed",
    videoUrls: [videoUrl],
    usage,
    userId,
    triggerUserMessageId: args.userMessageId,
  });

  // 7. Insert generatedMedia row for Knowledge Base (Phase 0.8 prep)
  await ctx.runMutation(internal.chat.mutations.insertGeneratedMedia, {
    userId,
    chatId,
    messageId,
    storageId,
    type: "video",
    mimeType: "video/mp4",
    sizeBytes: videoData.byteLength,
  });

  // 8. Finalize the generation group
  await maybeFinalizeGenerationGroup(ctx, {
    chatId: args.chatId,
    userMessageId: args.userMessageId,
    assistantMessageIds: args.assistantMessageIds,
    generationJobIds: args.generationJobIds,
    userId,
    searchSessionId: args.searchSessionId,
  });
}
