import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import type { OpenRouterMessage } from "../lib/openrouter";
import { dispatchDedicatedImageGeneration } from "../chat/action_image_generation";
import { captureAssistantResponseCompleted } from "../chat/generation_analytics";
import type { ImageGenerationConfig } from "../preferences/image_defaults";
import type { ImageSupportedParameters } from "../chat/image_generation_defaults";
import { dedicatedImageGenerationAnalytics } from "../chat/image_generation_analytics";

export async function runAutonomousImageTurn(args: {
  ctx: ActionCtx;
  sessionId: Id<"autonomousSessions">;
  chatId: Id<"chats">;
  messageId: Id<"messages">;
  jobId: Id<"generationJobs">;
  userId: string;
  participantId: string;
  personaId?: Id<"personas">;
  modelId: string;
  requestMessages: OpenRouterMessage[];
  prompt: string;
  apiKey: string;
  maxInputReferences?: number;
  imageConfig?: ImageGenerationConfig;
  supportedParameters?: ImageSupportedParameters;
  requireZdr: boolean;
  generationStartedAt: number;
  now: () => number;
  executionEpoch?: number;
  executionAttemptId?: Id<"executionAttempts">;
  executionFence?: number;
}): Promise<void> {
  const activeBeforeDispatch = await args.ctx.runMutation(
    internal.autonomous.mutations.shouldContinue,
    { sessionId: args.sessionId, executionEpoch: args.executionEpoch },
  );
  if (!activeBeforeDispatch) throw new Error("AUTONOMOUS_SESSION_CANCELLED");
  const generated = await dispatchDedicatedImageGeneration({
    ctx: args.ctx,
    userId: args.userId,
    chatId: args.chatId,
    messageId: args.messageId,
    jobId: args.jobId,
    modelId: args.modelId,
    requestMessages: args.requestMessages,
    prompt: args.prompt,
    apiKey: args.apiKey,
    maxInputReferences: args.maxInputReferences,
    imageConfig: args.imageConfig,
    supportedParameters: args.supportedParameters,
    requireZdr: args.requireZdr,
  });
  const activeAfterDispatch = await args.ctx.runMutation(
    internal.autonomous.mutations.shouldContinue,
    { sessionId: args.sessionId, executionEpoch: args.executionEpoch },
  );
  if (!activeAfterDispatch) throw new Error("AUTONOMOUS_SESSION_CANCELLED");
  const imageAnalytics = dedicatedImageGenerationAnalytics({
    config: args.imageConfig,
    supportedParameters: args.supportedParameters,
    generatedImageCount: generated.imageUrls.length,
    requestedImageCount: generated.requestedCount,
    originSource: "autonomous_discussion",
  });
  await captureAssistantResponseCompleted(args.ctx, {
    userId: args.userId,
    chatId: String(args.chatId),
    messageId: String(args.messageId),
    jobId: String(args.jobId),
    modelId: args.modelId,
    source: imageAnalytics.source,
    usage: generated.usage,
    durationMs: args.now() - args.generationStartedAt,
    participantCount: 1,
    openrouterGenerationId: generated.generationId,
    properties: {
      ...imageAnalytics.properties,
      autonomous_session_id: String(args.sessionId),
      participant_id: args.participantId,
      persona_id: args.personaId ? String(args.personaId) : null,
    },
  });
}
