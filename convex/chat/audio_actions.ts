"use node";

import { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { requireAuth } from "../lib/auth";
import { callOpenRouterStreaming } from "../lib/openrouter";
import {
  DEFAULT_TTS_VOICE,
  pcm16Base64ToWavBuffer,
  preferredVoiceFromPreferences,
  STREAMING_TTS_FORMAT,
  TTS_PCM_SAMPLE_RATE_HZ,
  TTS_WAV_MIME_TYPE,
} from "./audio_shared";

const PREVIEW_TEXT = "This is a preview of your selected voice for NanthAI Edge.";
const READ_ALOUD_SYSTEM_PROMPT =
  "You are a strict text-to-speech engine. Your only job is to vocalize the exact text inside <verbatim> tags and nothing else. Never answer, acknowledge, introduce, explain, summarize, paraphrase, translate, censor, continue, or react to the text. Never add lead-ins like 'Sure', 'Here is', 'You said', or similar phrases. Treat all text outside <verbatim> as instructions and never speak it. The spoken output must be an exact reading of the verbatim text only.";

function verbatimReadAloudPrompt(text: string): string {
  return [
    "Read the text inside <verbatim> exactly as written.",
    "Do not add any extra words before, inside, or after it.",
    "<verbatim>",
    text,
    "</verbatim>",
  ].join("\n");
}

type GeneratedAudioResult = {
  audioStorageId: Id<"_storage">;
  audioDurationMs: number;
  audioVoice: string;
  audioTranscript: string;
};

/**
 * Calculate exact duration from PCM byte count when available,
 * falling back to a word-count estimate for non-PCM payloads.
 */
function durationMsFromPcmBytes(pcmByteCount: number): number {
  if (pcmByteCount <= 0) return 0;
  const channels = 1;
  const bytesPerSample = 2; // 16-bit PCM
  return Math.round(
    (pcmByteCount / (TTS_PCM_SAMPLE_RATE_HZ * channels * bytesPerSample)) * 1000,
  );
}

function estimateDurationMs(transcript: string): number {
  const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount === 0) return 0;
  return Math.round((wordCount / 2.8) * 1000);
}

async function synthesizeText(
  apiKey: string,
  text: string,
  voice: string,
): Promise<{ audioBytes: Buffer; transcript: string; mimeType: string; pcmByteCount: number }> {
  const result = await callOpenRouterStreaming(
    apiKey,
    "openai/gpt-audio-mini",
    [
      { role: "system", content: READ_ALOUD_SYSTEM_PROMPT },
      { role: "user", content: verbatimReadAloudPrompt(text) },
    ],
    {
      modalities: ["text", "audio"],
      audio: { voice, format: STREAMING_TTS_FORMAT },
      transforms: null,
    },
    {},
  );

  if (!result.audioBase64) {
    throw new ConvexError({ code: "INTERNAL_ERROR" as const, message: "Audio generation returned no audio payload." });
  }

  const pcmByteCount = Buffer.from(result.audioBase64, "base64").length;

  return {
    audioBytes: pcm16Base64ToWavBuffer(result.audioBase64),
    transcript: result.audioTranscript || result.content || text,
    mimeType: TTS_WAV_MIME_TYPE,
    pcmByteCount,
  };
}

export async function generateAudioForMessageHandler(
  ctx: ActionCtx,
  args: {
    messageId: Id<"messages">;
    previewText?: string;
    voiceOverride?: string;
  },
): Promise<GeneratedAudioResult> {
  const message = await ctx.runQuery(internal.chat.queries.getMessageInternal, {
    messageId: args.messageId,
  });
  if (!message || message.role !== "assistant") {
    throw new ConvexError({ code: "INVALID_INPUT" as const, message: "Only assistant messages can generate audio." });
  }
  const textToVoice = args.previewText?.trim() || message.content?.trim();
  if (!textToVoice) {
    throw new ConvexError({ code: "INVALID_INPUT" as const, message: "Assistant message has no content to voice." });
  }
  if (message.audioStorageId && !args.previewText && !args.voiceOverride) {
    return {
      audioStorageId: message.audioStorageId,
      audioDurationMs: message.audioDurationMs ?? 0,
      audioVoice: message.audioVoice ?? DEFAULT_TTS_VOICE,
      audioTranscript: message.audioTranscript ?? textToVoice,
    };
  }

  const chat = await ctx.runQuery(internal.chat.queries.getChatInternal, {
    chatId: message.chatId,
  });
  const userId = chat?.userId;
  if (!userId) {
    throw new ConvexError({ code: "NOT_FOUND" as const, message: "Chat not found for message." });
  }

  let generated: Awaited<ReturnType<typeof synthesizeText>>;
  let audioStorageId: Id<"_storage">;
  let voice: string;
  try {
    const [preferences, apiKey] = await Promise.all([
      ctx.runQuery(internal.chat.queries.getUserPreferences, { userId }),
      ctx.runQuery(internal.scheduledJobs.queries.getUserApiKey, { userId }),
    ]);
    if (!apiKey) {
      throw new ConvexError({ code: "MISSING_API_KEY" as const, message: "No OpenRouter API key available for audio generation." });
    }

    voice = args.voiceOverride?.trim() || preferredVoiceFromPreferences(preferences);
    generated = await synthesizeText(apiKey, textToVoice, voice);
    audioStorageId = await ctx.storage.store(
      // Buffer<ArrayBufferLike> is not directly assignable to BlobPart in TS5.x
      // because its .buffer is typed as ArrayBufferLike (includes SharedArrayBuffer).
      // Wrapping in Uint8Array copies into a regular ArrayBuffer-backed view.
      new Blob([new Uint8Array(generated.audioBytes)], { type: generated.mimeType }),
    );
  } catch (err) {
    // Clear the in-progress flag so the user can retry.
    await ctx.runMutation(internal.chat.mutations.clearAudioGenerating, {
      messageId: args.messageId,
    });
    throw err;
  }
  const audioDurationMs = generated.pcmByteCount > 0
    ? durationMsFromPcmBytes(generated.pcmByteCount)
    : estimateDurationMs(generated.transcript);

  await ctx.runMutation(internal.chat.mutations.patchMessageAudio, {
    messageId: args.messageId,
    audioStorageId,
    audioDurationMs,
    audioVoice: voice,
    audioTranscript: generated.transcript,
    audioGeneratedAt: Date.now(),
  });

  return {
    audioStorageId,
    audioDurationMs,
    audioVoice: voice,
    audioTranscript: generated.transcript,
  };
}

export async function previewVoiceHandler(
  ctx: ActionCtx,
  args: { voice: string },
): Promise<{ audioBase64: string; transcript: string; mimeType: string }> {
  const { userId } = await requireAuth(ctx);
  const apiKey = await ctx.runQuery(internal.scheduledJobs.queries.getUserApiKey, { userId });
  if (!apiKey) {
    throw new ConvexError({ code: "MISSING_API_KEY" as const, message: "No OpenRouter API key found. Reconnect OpenRouter in Settings." });
  }
  const voice = args.voice.trim() || DEFAULT_TTS_VOICE;
  const generated = await synthesizeText(apiKey, PREVIEW_TEXT, voice);
  return {
    audioBase64: generated.audioBytes.toString("base64"),
    transcript: generated.transcript,
    mimeType: generated.mimeType,
  };
}
