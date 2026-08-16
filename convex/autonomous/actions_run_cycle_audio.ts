import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { normalizeInlineAudioOutput } from "../chat/audio_output_persistence";

export interface PersistedAutonomousAudio {
  audioStorageId: Id<"_storage">;
  audioDurationMs: number;
  audioGeneratedAt: number;
  audioMimeType: string;
  audioSizeBytes: number;
}

/**
 * Store model-authored audio from an Autonomous Discussion turn using the
 * same byte-signature normalization as ordinary chat generation.
 */
export async function persistAutonomousAudioOutput(
  ctx: ActionCtx,
  audioBase64: string,
): Promise<PersistedAutonomousAudio> {
  const normalized = normalizeInlineAudioOutput(audioBase64);
  const audioStorageId = await ctx.storage.store(
    new Blob([new Uint8Array(normalized.bytes)], { type: normalized.mimeType }),
  );

  return {
    audioStorageId,
    audioDurationMs: normalized.durationMs,
    audioGeneratedAt: Date.now(),
    audioMimeType: normalized.mimeType,
    audioSizeBytes: normalized.sizeBytes,
  };
}
