import type { OpenRouterMessage } from "../lib/openrouter";

// Preparation-only metadata: never serialized into a provider request.
type MessageSource = { messageId: string; participantId: string | null; text: string };
const sources = new WeakMap<OpenRouterMessage, readonly MessageSource[]>();
export function recordMessageSource(message: OpenRouterMessage, messageId: string, participantId: string | null): void {
  const text = typeof message.content === "string" ? message.content
    : (message.content ?? []).flatMap(part => part.type === "text" ? [part.text] : []).join("\n");
  sources.set(message, [{ messageId, participantId, text: text.trim() }]);
}
export function messageSource(message: OpenRouterMessage) {
  const records = messageSources(message);
  return records.length === 1 ? records[0] : undefined;
}
export function messageSources(message: OpenRouterMessage): readonly MessageSource[] {
  return sources.get(message) ?? [];
}
export function inheritMessageSources(message: OpenRouterMessage, contributors: readonly OpenRouterMessage[]): void {
  sources.set(message, contributors.flatMap(contributor => [...messageSources(contributor)]));
}
