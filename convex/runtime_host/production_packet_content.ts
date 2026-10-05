import { messageSource } from "../chat/message_provenance";
import type { PreparedParticipantTurn } from "../chat/prepared_participant_turn";
import type { OpenRouterMessage } from "../lib/openrouter";
import type { AuthorizedFetchHandle } from "./protocol_common";
import type { RuntimeContentPart, RuntimeMessage } from "./protocol_packet";

export class RuntimePacketMaterializationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RuntimePacketMaterializationError";
    this.code = code;
  }
}

export interface RuntimeImageSource {
  sourceUrl?: string;
  name: string | null;
  mimeType: string;
  altText: string | null;
  fetch: AuthorizedFetchHandle;
}

export async function materializeRuntimeMessages(input: {
  sourceMessageId: string;
  sourceImages?: RuntimeImageSource[];
  personaPrompt?: string | null;
  preparedTurn: PreparedParticipantTurn;
}): Promise<{
  messages: RuntimeMessage[];
  systemInstructions: Array<{
    instructionId: string;
    name: string;
    text: string;
    sourceHash: string;
  }>;
}> {
  const messages: RuntimeMessage[] = [];
  const systemInstructions = [];
  let sourceWasMaterialized = false;
  for (let index = 0; index < input.preparedTurn.providerMessages.length; index += 1) {
    const providerMessage = input.preparedTurn.providerMessages[index];
    if (providerMessage.role === "system") {
      const text = textContent(providerMessage);
      if (!text || text === input.personaPrompt?.trim()) continue;
      systemInstructions.push(await runtimePacketInstruction(
        `system-${systemInstructions.length + 1}`,
        "NanthAI context",
        text,
      ));
      continue;
    }
    const provenance = messageSource(providerMessage);
    const isSource = provenance?.messageId === input.sourceMessageId;
    const content = materializeContent(
      providerMessage,
      messages.length,
      isSource ? input.sourceImages ?? [] : undefined,
      input.sourceImages,
    );
    if (content.length === 0) continue;
    sourceWasMaterialized ||= isSource;
    messages.push({
      ordinal: messages.length,
      messageId: provenance?.messageId ?? (isSource
        ? input.sourceMessageId
        : `context-${await sha256Text(JSON.stringify(providerMessage))}-${index + 1}`),
      role: providerMessage.role,
      name: providerMessage.name?.trim() || null,
      participantId: provenance?.participantId ?? null,
      content,
    });
  }
  if (!sourceWasMaterialized) {
    throw new RuntimePacketMaterializationError("RUNTIME_SOURCE_NOT_DELIVERED", "Context assembly omitted the requested source message");
  }
  if (messages.length === 0) {
    throw new RuntimePacketMaterializationError(
      "RUNTIME_CONTEXT_EMPTY",
      "The local Runtime Host turn has no materialized conversation context",
    );
  }
  return { messages, systemInstructions };
}

export async function runtimePacketInstruction(id: string, name: string, text: string) {
  return {
    instructionId: id,
    name,
    text,
    sourceHash: await sha256Text(text),
  };
}

function materializeContent(
  message: OpenRouterMessage,
  messageIndex: number,
  sourceImages?: RuntimeImageSource[],
  allImages?: RuntimeImageSource[],
): RuntimeContentPart[] {
  if (typeof message.content === "string") {
    if (sourceImages && sourceImages.some((image) => !image.sourceUrl)) {
      throw new RuntimePacketMaterializationError(
        "RUNTIME_IMAGE_FETCH_UNAVAILABLE",
        "Canonical source images were not preserved by context assembly",
      );
    }
    const text = message.content.trim();
    return text ? [{ type: "text", partId: `part-${messageIndex}-1`, text }] : [];
  }
  if (!Array.isArray(message.content)) return [];
  const content: RuntimeContentPart[] = [];
  let sourceImageIndex = 0;
  for (let partIndex = 0; partIndex < message.content.length; partIndex += 1) {
    const part = message.content[partIndex];
    if (part.type === "text" && part.text?.trim()) {
      content.push({
        type: "text",
        partId: `part-${messageIndex}-${partIndex + 1}`,
        text: part.text.trim(),
      });
      continue;
    }
    if (part.type === "image_url") {
      const sourceImage = allImages?.find((image) => image.sourceUrl === part.image_url?.url)
        ?? sourceImages?.filter((image) => !image.sourceUrl)[sourceImageIndex];
      if (!sourceImage) {
        throw new RuntimePacketMaterializationError(
          "RUNTIME_IMAGE_FETCH_UNAVAILABLE",
          "Local Runtime Host images require canonical storage-backed fetch handles",
        );
      }
      content.push(runtimeImagePart(sourceImage, messageIndex, partIndex));
      sourceImageIndex += 1;
      continue;
    }
    throw new RuntimePacketMaterializationError(
      "RUNTIME_MULTIMODAL_FETCH_NOT_READY",
      `Local Runtime Host input does not yet support ${part.type} transport`,
    );
  }
  if (sourceImages && sourceImages.every((image) => !image.sourceUrl) && sourceImageIndex !== sourceImages.length) {
    throw new RuntimePacketMaterializationError(
      "RUNTIME_IMAGE_FETCH_UNAVAILABLE",
      "Canonical source images were not preserved by context assembly",
    );
  }
  return content;
}

function runtimeImagePart(
  source: RuntimeImageSource,
  messageIndex: number,
  partIndex: number,
): RuntimeContentPart {
  return {
    type: "image",
    partId: `part-${messageIndex}-${partIndex + 1}`,
    name: source.name,
    fetch: source.fetch,
    mimeType: source.mimeType,
    altText: source.altText,
  };
}

function textContent(message: OpenRouterMessage): string | null {
  if (typeof message.content === "string") return message.content.trim() || null;
  if (!Array.isArray(message.content)) return null;
  const text = message.content
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n");
  return text || null;
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
