// components/chat/MessageBubble.tsx
// Public wrapper that delegates to role-specific components.
// UserMessage: MessageBubble.UserMessage.tsx
// AssistantMessage: MessageBubble.AssistantMessage.tsx

import { memo, useCallback } from "react";
import type { Id } from "@convex/_generated/dataModel";
import { UserMessage } from "./MessageBubble.UserMessage";
import { AssistantMessage } from "./MessageBubble.AssistantMessage";
import type { Message, Participant } from "@/hooks/useChat";

// ─── Props ────────────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: Message;
  isStreaming: boolean;
  participants: Participant[];
  onRetry: (messageId: Id<"messages">) => void;
  onFork: (messageId: Id<"messages">) => void;
  onRetryWithDifferentModel?: (messageId: Id<"messages">) => void;
  messageCost?: number;
  showAdvancedStats?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MessageBubble = memo(function MessageBubble({
  message, isStreaming, participants,
  onRetry, onFork, onRetryWithDifferentModel,
  messageCost, showAdvancedStats,
}: MessageBubbleProps) {
  const handleRetry = useCallback(() => onRetry(message._id), [message._id, onRetry]);
  const handleFork = useCallback(() => onFork(message._id), [message._id, onFork]);
  const handleRetryDifferent = useCallback(
    () => onRetryWithDifferentModel?.(message._id),
    [message._id, onRetryWithDifferentModel],
  );

  if (message.role === "user") {
    return <UserMessage message={message} />;
  }

  if (message.role === "assistant") {
    return (
      <AssistantMessage
        message={message} isStreaming={isStreaming} participants={participants}
        onRetry={handleRetry} onFork={handleFork}
        onRetryWithDifferentModel={onRetryWithDifferentModel ? handleRetryDifferent : undefined}
        messageCost={messageCost} showAdvancedStats={showAdvancedStats}
      />
    );
  }

  // System messages
  return (
    <div className="text-center py-2">
      <span className="text-xs text-muted bg-surface-2/50 px-3 py-1 rounded-full">
        {message.content}
      </span>
    </div>
  );
});
