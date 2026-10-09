"use node";

import { internal } from "../_generated/api";
import { normalizeInlineAudioOutput } from "../chat/audio_output_persistence";
import type { ToolExecutionContext, ToolResult } from "./registry";
import type { RequiredMediaToolContext } from "./media_generation_context";

function filenameStem(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "audio";
}

export async function publishGeneratedAudio(
  toolCtx: ToolExecutionContext,
  context: RequiredMediaToolContext,
  args: {
    kind: "music" | "speech"; modelId: string; prompt: string; audioBase64: string;
    requestedFormat: string; audioTranscript: string; effectiveVoice?: string;
    effectiveSpeechOptions?: Record<string, unknown>; references?: { referenceCount: number };
  },
): Promise<ToolResult> {
  if (!toolCtx.operationIdempotencyKey) throw new Error("Audio publication requires an operation key.");
  const { kind, modelId, prompt, audioBase64, requestedFormat, audioTranscript,
    effectiveVoice, effectiveSpeechOptions, references } = args;
  const audio = normalizeInlineAudioOutput(audioBase64, requestedFormat);
  const storageId = await toolCtx.ctx.storage.store(
    new Blob([new Uint8Array(audio.bytes)], { type: audio.mimeType }),
  );
  let audioUrl: string | null;
  try {
    audioUrl = await toolCtx.ctx.storage.getUrl(storageId);
  } catch (error) {
    await toolCtx.ctx.storage.delete(storageId).catch(() => undefined);
    throw error;
  }
  if (!audioUrl) {
    await toolCtx.ctx.storage.delete(storageId).catch(() => undefined);
    throw new Error("Generated audio could not be retrieved from storage.");
  }
  if (kind === "speech" && !effectiveVoice && !references) {
    await toolCtx.ctx.storage.delete(storageId).catch(() => undefined);
    throw new Error("Speech generation completed without a provider voice ID.");
  }
  const filename = `${filenameStem(kind === "music" ? prompt : "generated-speech")}.${audio.extension}`;
  const operationResultData = {
    kind,
    modelId,
    prompt,
    storageId,
    audioStorageId: storageId,
    audioUrl,
    mimeType: audio.mimeType,
    audioMimeType: audio.mimeType,
    sizeBytes: audio.sizeBytes,
    audioDurationMs: audio.durationMs,
    audioTranscript: kind === "speech" ? (audioTranscript || prompt) : audioTranscript,
    filename,
    toolName: kind === "music" ? "generate_music" : "generate_speech",
    ...(kind === "speech"
      ? {
          voice: effectiveVoice,
          speechOptions: effectiveSpeechOptions,
          ...(references ? { voiceCloning: { modelId, referenceCount: references.referenceCount } } : {}),
        }
      : {}),
  };
  const publicationArgs = {
    userId: toolCtx.userId,
    chatId: context.chatId,
    messageId: context.messageId,
    jobId: context.jobId,
    executionAttemptId: context.executionAttemptId,
    executionFence: context.executionFence,
    operationKey: toolCtx.operationIdempotencyKey,
    operationResultDataJson: JSON.stringify(operationResultData),
    storageId,
    filename,
    mimeType: audio.mimeType,
    sizeBytes: audio.sizeBytes,
    toolName: kind === "music"
      ? "generate_music" as const
      : "generate_speech" as const,
  };
  let persisted;
  try {
    persisted = await toolCtx.ctx.runMutation(
      internal.tools.media_generation_mutations.insertGeneratedAudioFile,
      publicationArgs,
    );
  } catch {
    try {
      persisted = await toolCtx.ctx.runMutation(
        internal.tools.media_generation_mutations.insertGeneratedAudioFile,
        publicationArgs,
      );
    } catch (error) {
      await toolCtx.ctx.runMutation(
        internal.tools.media_generation_mutations.deleteUnreferencedMediaStorage,
        { storageIds: [storageId] },
      ).catch(() => undefined);
      throw error;
    }
  }
  return JSON.parse(persisted.resultJson) as ToolResult;
}
