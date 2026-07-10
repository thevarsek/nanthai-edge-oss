import { ConvexError } from "convex/values";
import type { OpenRouterMessage } from "../lib/openrouter_types";
import type {
  OpenRouterImageReference,
  OpenRouterImageRequest,
} from "../lib/openrouter_image";
import type { ResolvedImageGenerationOptions } from "./image_generation_defaults";

export const MAX_IMAGE_CONTEXT_CHARS = 12_000;
const MAX_IMAGE_SYSTEM_CONTEXT_CHARS = 6_000;
const GENERATED_IMAGE_LABELS = new Set([
  "[Generated image]",
  "[Generated image context for the next response]",
]);
const INLINE_IMAGE_DATA_REGEX =
  /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/gi;
const LONG_BASE64_REGEX = /\b[A-Za-z0-9+/]{256,}={0,2}\b/g;

function messageImages(message: OpenRouterMessage | undefined): string[] {
  if (!message || !Array.isArray(message.content)) return [];
  return message.content.flatMap((part) => {
    const url = part.type === "image_url" ? part.image_url?.url.trim() : "";
    return url ? [url] : [];
  });
}

/**
 * Resolve image-editing references from the branch-aware request transcript.
 *
 * Current-turn images are first so an explicit attachment/Ideascape selection
 * wins when a model accepts only one reference. Older visual context is then
 * considered newest-turn-first. This preserves generated images across an
 * intervening text-model response without pulling images from another branch;
 * `buildRequestMessages` has already projected only the selected ancestry.
 */
export function imageReferenceUrls(
  messages: OpenRouterMessage[],
  maxInputReferences: number | undefined,
): string[] {
  const limit = Math.max(0, Math.floor(maxInputReferences ?? 0));
  if (limit === 0) return [];

  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  const candidates: string[] = [];
  if (latestUserIndex >= 0) {
    candidates.push(...messageImages(messages[latestUserIndex]));
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (index === latestUserIndex) continue;
    candidates.push(...messageImages(messages[index]));
  }

  return Array.from(new Set(candidates)).slice(0, limit);
}

function textContent(message: OpenRouterMessage): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n");
}

function contextualText(message: OpenRouterMessage): string {
  return textContent(message)
    .replace(INLINE_IMAGE_DATA_REGEX, "")
    .replace(LONG_BASE64_REGEX, "")
    .split("\n")
    .filter((line) => !GENERATED_IMAGE_LABELS.has(line.trim()))
    .join("\n")
    .trim();
}

function recentConversationText(entries: string[], budget: number): string {
  if (budget <= 0 || entries.length === 0) return "";
  const selected: string[] = [];
  let used = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const separatorLength = selected.length > 0 ? 2 : 0;
    if (entry.length + separatorLength <= budget - used) {
      selected.unshift(entry);
      used += entry.length + separatorLength;
      continue;
    }
    if (selected.length === 0) {
      selected.unshift(entry.slice(Math.max(0, entry.length - budget)));
    }
    break;
  }

  return selected.join("\n\n");
}

/** Flatten branch-local chat context for the prompt-only Images API. */
export function buildContextualImagePrompt(
  messages: OpenRouterMessage[],
  currentPrompt: string,
): string {
  const prompt = currentPrompt.trim();
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  const systemText = messages
    .filter((message) => message.role === "system")
    .map(contextualText)
    .filter(Boolean)
    .join("\n\n")
    .slice(0, MAX_IMAGE_SYSTEM_CONTEXT_CHARS);
  const conversationEntries = messages.flatMap((message, index) => {
    if (
      index === latestUserIndex ||
      (message.role !== "user" && message.role !== "assistant")
    ) {
      return [];
    }
    const text = contextualText(message);
    if (!text) return [];
    const speaker = message.role === "user"
      ? "User"
      : message.name?.trim()
        ? `Assistant (${message.name.trim()})`
        : "Assistant";
    return [`${speaker}: ${text}`];
  });

  let context = "";
  if (systemText) {
    context = `System and persona guidance:\n${systemText}`;
  }
  if (conversationEntries.length > 0) {
    const separator = context ? "\n\n" : "";
    const header = "Recent selected-branch conversation:\n";
    const budget = Math.max(
      0,
      MAX_IMAGE_CONTEXT_CHARS - context.length - separator.length - header.length,
    );
    const conversation = recentConversationText(conversationEntries, budget);
    if (conversation) {
      context += `${separator}${header}${conversation}`;
    }
  }

  if (!context) return prompt;
  return `${context}\n\nCurrent image request:\n${prompt}`;
}

export function buildImageGenerationRequest(args: {
  model: string;
  prompt: string;
  messages: OpenRouterMessage[];
  maxInputReferences?: number;
  options?: ResolvedImageGenerationOptions;
}): OpenRouterImageRequest {
  const prompt = args.prompt.trim();
  if (!prompt) {
    throw new ConvexError({
      code: "VALIDATION_ERROR" as const,
      message: "Add a text prompt describing the image you want to generate.",
    });
  }

  const references: OpenRouterImageReference[] = imageReferenceUrls(
    args.messages,
    args.maxInputReferences,
  )
    .map((url) => ({ type: "image_url", image_url: { url } }));

  return {
    model: args.model,
    prompt: buildContextualImagePrompt(args.messages, prompt),
    inputReferences: references.length > 0 ? references : undefined,
    ...args.options,
  };
}
