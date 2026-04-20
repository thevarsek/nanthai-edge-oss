import { ContentPart, OpenRouterMessage } from "../lib/openrouter";
import { fetchBinaryAsBase64, guessAudioInputFormat, isAudioAttachment } from "./audio_runtime";

type ContextMessage = {
  _id: string;
  content: string;
  attachments?: Array<{
    type?: string;
    url?: string;
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

export async function appendCurrentTurnAudioInput(
  requestMessages: OpenRouterMessage[],
  currentUserMessage: ContextMessage | undefined,
  modelSupportsAudioInput: boolean | undefined,
): Promise<OpenRouterMessage[]> {
  if (!currentUserMessage || !modelSupportsAudioInput) {
    return requestMessages;
  }

  const audioAttachment = currentUserMessage.attachments?.find((attachment) =>
    isAudioAttachment(attachment),
  );
  if (!audioAttachment?.url) {
    return requestMessages;
  }

  const base64Data = audioAttachment.url.startsWith("data:")
    ? audioAttachment.url.split(",", 2)[1] ?? ""
    : await fetchBinaryAsBase64(audioAttachment.url);
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
