import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";

export function resolvedBranchPath(messages: Message[], activePath: Id<"messages">[]): Id<"messages">[] {
  return activePath.length > 0 || messages.length === 0
    ? activePath
    : messages.map((message) => message._id);
}

export function visibleMessagesForPath(messages: Message[], path: Id<"messages">[]): Message[] {
  const messagesById = new Map(messages.map((message) => [message._id, message] as const));
  return path.flatMap((messageId) => {
    const message = messagesById.get(messageId);
    return message ? [message] : [];
  });
}

export function hasVisiblePendingAssistant(messages: Message[]): boolean {
  return messages.some(
    (message) => message.role === "assistant" && (message.status === "pending" || message.status === "streaming"),
  );
}

export function shouldShowPendingResponsePlaceholder(args: {
  isGenerating: boolean;
  visibleMessages: Message[];
}): boolean {
  return args.isGenerating && !hasVisiblePendingAssistant(args.visibleMessages);
}
