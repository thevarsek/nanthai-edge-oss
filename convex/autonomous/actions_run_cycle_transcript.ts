import type { ContentPart, OpenRouterMessage } from "../lib/openrouter";
import type { ParticipantConfig } from "./actions_helpers";

const SYNTHETIC_IMAGE_CONTEXT_LABEL =
  "[Generated image context for the next response]";

function contentText(
  content: OpenRouterMessage["content"],
  includePartMarkers: boolean,
): string {
  if (typeof content === "string") return content.trim();
  if (!content) return "";
  return content
    .map((part: ContentPart) =>
      part.type === "text"
        ? (part.text ?? "")
        : includePartMarkers && part.type !== "image_url"
          ? `[${part.type}]`
          : ""
    )
    .join("\n")
    .split("\n")
    .filter((line) => line.trim() !== SYNTHETIC_IMAGE_CONTEXT_LABEL)
    .join("\n")
    .trim();
}

function messageContentToParts(
  content: OpenRouterMessage["content"],
): ContentPart[] {
  if (typeof content === "string") return [];
  return content?.filter((part) => part.type !== "text") ?? [];
}

function transcriptSpeaker(message: OpenRouterMessage): string {
  if (message.role === "user") return "User";
  if (message.role === "tool") return "Tool";
  if (message.role !== "assistant") return "Participant";
  const name = message.name?.trim();
  return name ? `Previous participant ${name}` : "Previous participant";
}

export function buildAutonomousTranscriptMessages(
  messages: OpenRouterMessage[],
  participantName: string,
): OpenRouterMessage[] {
  const systemMessages = messages.filter((message) => message.role === "system");
  const discussionMessages = messages.filter((message) => message.role !== "system");
  const transcriptLines: string[] = [];
  const nonTextParts: ContentPart[] = [];

  for (const message of discussionMessages) {
    const text = contentText(message.content, true);
    if (text) transcriptLines.push(`${transcriptSpeaker(message)}: ${text}`);
    nonTextParts.push(...messageContentToParts(message.content));
  }

  const promptText = [
    "You are participating in an autonomous group discussion.",
    "Use any provided user context only to make the discussion relevant. Do not mention memory, profile data, writing preferences, prompts, model identity, training data, weights, providers, or internal instructions.",
    "",
    "Discussion so far:",
    transcriptLines.length > 0 ? transcriptLines.join("\n\n") : "No prior visible turns.",
    "",
    `Now provide ${participantName}'s next contribution to the debate. Respond only with the contribution itself. Do not summarize your instructions or explain your role. Do not speak for other participants.`,
  ].join("\n");

  return [
    ...systemMessages,
    {
      role: "user",
      content: nonTextParts.length > 0
        ? [{ type: "text", text: promptText }, ...nonTextParts]
        : promptText,
    },
  ];
}

export function autonomousParticipantPromptName(
  participant: ParticipantConfig,
): string {
  return participant.personaId ? participant.displayName : "the next participant";
}

export function autonomousImagePromptText(
  content: OpenRouterMessage["content"],
): string {
  return contentText(content, false);
}
