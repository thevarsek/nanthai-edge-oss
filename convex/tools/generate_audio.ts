"use node";

import { createTool } from "./registry";
import { executeAudioGeneration } from "./audio_generation";

export const generateMusic = createTool({
  name: "generate_music",
  description: "Generate original music from a prompt with the user's configured music model. Returns an attached audio file and owned storage ID.",
  parameters: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Describe style, mood, instrumentation, structure, vocals, lyrics, and other musical intent." },
      model_id: { type: "string", description: "Optional explicit OpenRouter music model ID. Omit to use Chat Defaults." },
    },
    required: ["prompt"],
  },
  execute: async (toolCtx, args) => await executeAudioGeneration("music", toolCtx, args),
});

export const generateSpeech = createTool({
  name: "generate_speech",
  description: "Generate spoken audio from supplied text with the user's configured speech model and preferred voice. For a consented voice-reference request, the backend supplies the selected model and recordings automatically: omit reference_storage_ids and voice. Never guess recording IDs from filenames. Optional synthesis controls are filtered to the selected model's capabilities. Returns an attached audio file and owned storage ID.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "The exact text to speak." },
      reference_storage_ids: { type: "array", items: { type: "string" }, description: "Optional explicitly selected, consented request reference IDs, in their original order. NanthAI applies the request's references and selected model automatically; arbitrary attachments are not permission to clone a voice." },
      voice: { type: "string", description: "Requested voice. An unavailable voice resolves to a valid configured or model-supported voice." },
      speed: { type: "number", description: "Requested synthesis speed. Applied only when the selected model supports speed control." },
      output_format: { type: "string", enum: ["mp3", "pcm"], description: "Requested audio format. The selected model's supported format is used when this is unavailable." },
      instructions: { type: "string", description: "Speaking direction. Applied only when the selected model supports instructions." },
      style: { type: "string", description: "Expressive speaking style. Applied only when the selected model supports styles." },
      style_degree: { type: "number", description: "Requested style intensity. Applied only when the selected model supports styles." },
      model_id: { type: "string", description: "Explicit OpenRouter speech model override. Omit to use the request-selected cloning model, or Chat Defaults for ordinary speech." },
    },
    required: ["text"],
  },
  execute: async (toolCtx, args) => await executeAudioGeneration("speech", toolCtx, args),
});
