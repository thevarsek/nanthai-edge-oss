"use node";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import {
  buildVideoOutputUploadUrl,
  modelRequiresOutputUploadUrl,
} from "../chat/actions_video_generation";
import {
  createVideoOutputUploadToken,
  hashVideoOutputUploadToken,
  VIDEO_OUTPUT_UPLOAD_TTL_MS,
} from "../chat/video_output_upload_policy";
import { OPENROUTER_DEFAULT_PROVIDER_SORT } from "../lib/model_constants";
import { assertModelSupportsZdr } from "../lib/openrouter_zdr";
import { submitVideoJob, type SubmitVideoJobRequest } from "../lib/openrouter_video";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import type {
  DeferredVideoWorkflowArgs,
  ToolVideoExecution,
} from "./video_generation_contract";

type ToolVideoArgs = DeferredVideoWorkflowArgs & { execution: ToolVideoExecution };

async function buildRequest(
  ctx: ActionCtx,
  job: Doc<"videoJobs">,
): Promise<{ request: SubmitVideoJobRequest; inputIdentity: Record<string, unknown> }> {
  const capabilities = await ctx.runQuery(internal.chat.queries.getModelCapabilities, {
    modelId: job.model,
  });
  if (!capabilities?.hasVideoGeneration) {
    throw new Error(`Model '${job.model}' is unavailable for video generation.`);
  }
  if (job.requireZdr) {
    assertModelSupportsZdr({ modelId: job.model, capabilities, feature: "Video generation" });
  }
  const config = job.videoConfig;
  const request: SubmitVideoJobRequest = {
    model: job.model,
    prompt: job.prompt,
    resolution: config?.resolution,
    aspect_ratio: config?.aspectRatio,
    duration: config?.duration,
    generate_audio: config?.generateAudio,
    seed: config?.seed,
    provider: {
      ...OPENROUTER_DEFAULT_PROVIDER_SORT,
      ...(job.requireZdr ? { zdr: true } : {}),
    },
  };
  const source = job.sourceUserMessageId
    ? await ctx.runQuery(internal.chat.queries.getMessageInternal, {
        messageId: job.sourceUserMessageId,
      })
    : null;
  const supportedFrames = capabilities.videoCapabilities?.supportedFrameImages ?? [];
  const images = (source?.attachments ?? []).filter((attachment) =>
    attachment.type === "image" || attachment.mimeType?.startsWith("image/")
  );
  const frames: NonNullable<SubmitVideoJobRequest["frame_images"]> = [];
  const references: NonNullable<SubmitVideoJobRequest["input_references"]> = [];
  const sourceImages: Array<Record<string, unknown>> = [];
  for (const [index, attachment] of images.entries()) {
    const url = attachment.storageId
      ? await ctx.storage.getUrl(attachment.storageId)
      : attachment.url;
    if (!url) continue;
    const role = attachment.videoRole ?? (
      index === 0 ? "first_frame" : index === 1 ? "last_frame" : "reference"
    );
    sourceImages.push({
      storageId: attachment.storageId,
      externalUrl: attachment.storageId ? undefined : attachment.url,
      role,
    });
    if ((role === "first_frame" || role === "last_frame") && supportedFrames.includes(role)) {
      frames.push({ type: "image_url", image_url: { url }, frame_type: role });
    } else if (supportedFrames.length > 0) {
      references.push({ type: "image_url", image_url: { url } });
    }
  }
  if (frames.length > 0) request.frame_images = frames;
  if (references.length > 0) request.input_references = references;
  return {
    request,
    inputIdentity: {
      model: job.model,
      prompt: job.prompt,
      videoConfig: job.videoConfig,
      requireZdr: job.requireZdr === true,
      sourceUserMessageId: job.sourceUserMessageId,
      sourceImages,
    },
  };
}

interface JournaledVideoSubmission {
  submission: Awaited<ReturnType<typeof submitVideoJob>>;
  outputUploadId?: Id<"videoOutputUploads">;
}

function replayedSubmission(resultJson: string): JournaledVideoSubmission {
  const parsed = JSON.parse(resultJson) as JournaledVideoSubmission | JournaledVideoSubmission["submission"];
  return "submission" in parsed ? parsed : { submission: parsed };
}

async function submitWithJournal(
  ctx: ActionCtx,
  args: ToolVideoArgs,
  job: Doc<"videoJobs">,
  request: SubmitVideoJobRequest,
  inputIdentity: Record<string, unknown>,
): Promise<JournaledVideoSubmission> {
  const operationKey = `${String(args.videoJobId)}:provider-submit`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(inputIdentity)),
  );
  const inputHash = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const decision = await ctx.runMutation(internal.execution.operations.prepare, {
    jobId: args.jobId,
    attemptId: args.execution.attemptId,
    fence: args.execution.fence,
    operationKey,
    toolName: "video_provider_submit",
    toolCallId: args.toolCallId,
    effect: "write",
    retry: "never",
    authorizationSource: "explicit_user_turn",
    inputHash,
  });
  if (decision.decision === "refuse") throw new Error(decision.reason);
  if (decision.decision === "replay") {
    return replayedSubmission(decision.resultJson);
  }
  const apiKey = await getRequiredUserOpenRouterApiKey(ctx, args.userId);
  let outputUploadId: Id<"videoOutputUploads"> | undefined;
  if (modelRequiresOutputUploadUrl(job.model)) {
    const token = createVideoOutputUploadToken();
    outputUploadId = await ctx.runMutation(
      internal.tools.video_generation_submission_mutations.createToolVideoOutputUploadSession,
      {
        videoJobId: args.videoJobId,
        userId: args.userId,
        generationJobId: args.jobId,
        toolCallId: args.toolCallId,
        executionAttemptId: args.execution.attemptId,
        executionFence: args.execution.fence,
        tokenHash: await hashVideoOutputUploadToken(token),
        expiresAt: Date.now() + VIDEO_OUTPUT_UPLOAD_TTL_MS,
      },
    );
    request.output = { upload_url: buildVideoOutputUploadUrl(token) };
  }
  await ctx.runMutation(internal.execution.operations.markDispatched, {
    attemptId: args.execution.attemptId,
    fence: args.execution.fence,
    operationKey,
  });
  let result: Awaited<ReturnType<typeof submitVideoJob>>;
  try {
    result = await submitVideoJob(apiKey, request);
  } catch (error) {
    await ctx.runMutation(internal.execution.operations.markOutcomeUnknown, {
      attemptId: args.execution.attemptId,
      fence: args.execution.fence,
      operationKey,
      errorSummary: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
  const journaled = { submission: result, outputUploadId };
  const resultJson = JSON.stringify(journaled);
  const outcomeArgs = {
    videoJobId: args.videoJobId,
    userId: args.userId,
    generationJobId: args.jobId,
    toolCallId: args.toolCallId,
    executionAttemptId: args.execution.attemptId,
    operationKey,
    openRouterJobId: result.id,
    outputUploadId,
    resultJson,
  };
  try {
    await ctx.runMutation(
      internal.tools.video_generation_submission_mutations.recordToolVideoSubmissionOutcome,
      outcomeArgs,
    );
  } catch {
    // Convex mutations are atomic, so retry the same idempotent adoption
    // mutation. Keeping the operation and video row in one transaction avoids
    // a cancellation window where only the provider outcome is recorded.
    await ctx.runMutation(
      internal.tools.video_generation_submission_mutations.recordToolVideoSubmissionOutcome,
      outcomeArgs,
    );
  }
  return journaled;
}

export async function prepareToolVideoSubmission(
  ctx: ActionCtx,
  args: ToolVideoArgs,
  job: Doc<"videoJobs">,
) {
  const { request, inputIdentity } = await buildRequest(ctx, job);
  return await submitWithJournal(ctx, args, job, request, inputIdentity);
}
