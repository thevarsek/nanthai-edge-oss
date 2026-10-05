import type { Id } from "../_generated/dataModel";

export interface MemorySelectionMessage {
  _id: Id<"messages">;
  role: string;
  content: string;
  parentMessageIds?: Id<"messages">[];
}

/** Retrieve for the current task, including its authorized branch history. */
export function memorySelectionContext(
  messages: MemorySelectionMessage[],
  userMessageId: Id<"messages">,
): { queryText: string; selectionText: string } {
  const current = messages.find(message => message._id === userMessageId && message.role === "user")
    ?? [...messages].reverse().find(message => message.role === "user");
  const queryText = current?.content.trim() ?? "";
  if (!current || !queryText) return { queryText, selectionText: queryText };

  const byId = new Map(messages.map(message => [message._id, message]));
  const reachable = new Set<Id<"messages">>();
  const pending = [current._id];
  while (pending.length) {
    const id = pending.pop();
    if (!id || reachable.has(id)) continue;
    reachable.add(id);
    pending.push(...(byId.get(id)?.parentMessageIds ?? []));
  }
  // Older callers without graph metadata supply an already scoped history.
  const prior = current.parentMessageIds === undefined
    ? messages.slice(0, messages.indexOf(current))
    : messages.filter(message => reachable.has(message._id) && message._id !== current._id);
  const history = prior.filter(message => message.role === "user" || message.role === "assistant")
    .slice(-8).map(message => message.content.trim().slice(0, 2_000)).filter(Boolean);
  return { queryText, selectionText: [queryText, ...history].join("\n\n") };
}
