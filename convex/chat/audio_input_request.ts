import { ContentPart, OpenRouterMessage } from "../lib/openrouter";
import { bytesToBase64, guessAudioInputFormat, isAudioAttachment } from "./audio_runtime";

/** Matches the per-turn attachment cap enforced when the message is sent. */
export const MAX_AUDIO_INPUT_BYTES = 25 * 1024 * 1024;

/** Reads a stored blob; the action passes `ctx.storage.get`. */
export type AudioStorageReader = (storageId: string) => Promise<Blob | null>;

type ContextMessage = {
  _id: string;
  content: string;
  attachments?: Array<{
    type?: string;
    url?: string;
    storageId?: string;
    name?: string;
    mimeType?: string;
  }>;
};

function asContentParts(content: OpenRouterMessage["content"]): ContentPart[] {
  if (Array.isArray(content)) return [...content];
  if (typeof content === "string" && content.trim().length > 0) {
    return [{ type: "text", text: content }];
  }
  return [];
}

/**
 * Stored audio is read from Convex storage and inline audio from its `data:`
 * URL. Any other URL is ignored: the backend never fetches attachment hosts.
 */
async function readAudioAttachmentBase64(
  attachment: { url?: string; storageId?: string },
  readStorage: AudioStorageReader,
): Promise<string> {
  if (attachment.storageId) {
    const blob = await readStorage(attachment.storageId);
    if (!blob) return "";
    if (blob.size > MAX_AUDIO_INPUT_BYTES) throw new Error("Audio attachment is too large.");
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  }
  if (attachment.url?.startsWith("data:")) return attachment.url.split(",", 2)[1] ?? "";
  return "";
}

export async function appendCurrentTurnAudioInput(
  requestMessages: OpenRouterMessage[],
  currentUserMessage: ContextMessage | undefined,
  modelSupportsAudioInput: boolean | undefined,
  readStorage: AudioStorageReader,
): Promise<OpenRouterMessage[]> {
  if (!currentUserMessage || !modelSupportsAudioInput) {
    return requestMessages;
  }

  const audioAttachment = currentUserMessage.attachments?.find((attachment) =>
    isAudioAttachment(attachment),
  );
  if (!audioAttachment) {
    return requestMessages;
  }

  const base64Data = await readAudioAttachmentBase64(audioAttachment, readStorage);
  if (!base64Data) {
    return requestMessages;
  }

  const audioPart: ContentPart = {
    type: "input_audio",
    input_audio: {
      data: base64Data,
      format: guessAudioInputFormat(audioAttachment.mimeType, audioAttachment.name),
    },
  };

  const nextMessages = [...requestMessages];
  for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
    const message = nextMessages[index];
    if (message.role !== "user") continue;
    nextMessages[index] = {
      ...message,
      content: [...asContentParts(message.content), audioPart],
    };
    return nextMessages;
  }

  return nextMessages;
}
