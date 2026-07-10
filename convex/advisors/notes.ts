import type { OpenRouterMessage } from "../lib/openrouter_types";

const NOTES_TAG = "<private_advisor_notes>";

export function injectAdvisorNotes(
  messages: OpenRouterMessage[],
  notes: string | null | undefined,
): OpenRouterMessage[] {
  if (!notes?.trim() || messages.some(hasAdvisorNotes)) return messages;
  const next = [...messages];
  let insertionIndex = 0;
  while (insertionIndex < next.length && next[insertionIndex].role === "system") {
    insertionIndex += 1;
  }
  next.splice(insertionIndex, 0, { role: "system", content: notes.trim() });
  return next;
}

function hasAdvisorNotes(message: OpenRouterMessage): boolean {
  if (typeof message.content === "string") return message.content.includes(NOTES_TAG);
  return message.content?.some((part) => part.text?.includes(NOTES_TAG)) ?? false;
}
