"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ToolExecutionContext } from "./registry";
import type { OpenRouterSpeechRequest } from "../lib/openrouter_speech";
import { validateReferencePlaceholders, validateVoiceCloningRequest } from "../chat/voice_cloning_contract";

export async function resolveSpeechReferences(
  toolCtx: ToolExecutionContext,
  messageId: Id<"messages">,
  prompt: string,
  requestedModelId: string | undefined,
  requestedReferences: unknown,
  requireZdr: boolean,
) {
  // Empty optional arrays are emitted by some tool callers for omitted fields.
  const explicitReferences = Array.isArray(requestedReferences) && requestedReferences.length === 0
    ? undefined : requestedReferences;
  const selected = await toolCtx.ctx.runQuery(internal.chat.voice_cloning.getTurnReferences, {
    messageId, userId: toolCtx.userId,
  });
  if (!selected) {
    if (explicitReferences !== undefined) throw new Error("Voice cloning requires request-specific audio selection and permission in NanthAI.");
    return undefined;
  }
  const { request, references } = selected;
  if (requestedModelId && requestedModelId !== request.modelId) {
    throw new Error("Use the speech model explicitly selected for this voice-cloning request.");
  }
  if (explicitReferences !== undefined && (!Array.isArray(explicitReferences)
    || explicitReferences.length !== references.length
    || explicitReferences.some((id, index) => id !== references[index].storageId))) {
    throw new Error("Use exactly the voice references explicitly selected for this request, in their selected order.");
  }
  const model = await toolCtx.ctx.runQuery(internal.chat.queries.getModelCapabilities, { modelId: request.modelId });
  validateVoiceCloningRequest(request, model?.speechCapabilities, requireZdr, references);
  validateReferencePlaceholders(request.modelId, prompt, references.length);
  const inputReferences: NonNullable<OpenRouterSpeechRequest["inputReferences"]> = [];
  for (const reference of references) {
    inputReferences.push({ type: "input_audio", input_audio: { url: reference.url } });
    if (reference.transcript) inputReferences.push({ type: "text", text: reference.transcript });
  }
  return { modelId: request.modelId, inputReferences, referenceCount: references.length };
}
