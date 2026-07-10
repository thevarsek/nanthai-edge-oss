import type { ContentPart, OpenRouterMessage } from "../lib/openrouter_types";

const OMITTED_IMAGE_CONTEXT = "[Image omitted because this model does not support image input.]";

/**
 * Adapts already-built conversation context to the target participant. Image
 * models still receive the untouched context for generation/editing; chat
 * participants without vision never receive an unsupported `image_url` part.
 */
export function adaptMessagesForImageInput(
  messages: OpenRouterMessage[],
  hasImageInput: boolean,
): OpenRouterMessage[] {
  if (hasImageInput) return messages;

  return messages.map((message) => {
    if (!Array.isArray(message.content)) return message;
    const supported = message.content.filter((part) => part.type !== "image_url");
    if (supported.length === message.content.length) return message;
    return {
      ...message,
      content: supported.length > 0
        ? supported
        : [{ type: "text", text: OMITTED_IMAGE_CONTEXT } satisfies ContentPart],
    };
  });
}
