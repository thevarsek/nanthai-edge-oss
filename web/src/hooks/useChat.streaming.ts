import type { Id } from "@convex/_generated/dataModel";
import type { Message, StreamingMessage } from "@/hooks/useChat";

export interface ChatMergeCache {
  previousMessages: Message[];
  pendingFallbackMessages: Map<Id<"messages">, Message>;
  latestOverlays: Map<Id<"messages">, StreamingMessage>;
}

export function createChatMergeCache(): ChatMergeCache {
  return {
    previousMessages: [],
    pendingFallbackMessages: new Map<Id<"messages">, Message>(),
    latestOverlays: new Map<Id<"messages">, StreamingMessage>(),
  };
}

export function mergeMessageWithFallback(previous: Message, current: Message): Message {
  return {
    ...current,
    content: previous.content,
    status: previous.status,
    reasoning: previous.reasoning,
    toolCalls: previous.toolCalls,
    activeToolCallIds: previous.activeToolCallIds,
    toolResults: previous.toolResults,
    presentationProgress: previous.presentationProgress,
  };
}

export function shouldReleasePendingStreamingFallback(
  fallback: Message,
  previous: Message,
  current: Message,
): boolean {
  const overlayStillTerminal = previous.status === fallback.status;
  const currentAdvancedPastFallbackStatus = current.status !== fallback.status;
  const currentIncludesAtLeastFallbackContent = current.content.length >= fallback.content.length;
  const currentReachedTerminal =
    current.status === "completed" ||
    current.status === "failed" ||
    current.status === "cancelled";
  return (
    !overlayStillTerminal ||
    currentAdvancedPastFallbackStatus ||
    currentIncludesAtLeastFallbackContent ||
    currentReachedTerminal
  );
}

export function reconcileStreamingMessages(
  cache: ChatMergeCache,
  base: Message[],
  streamingMessages: StreamingMessage[] | undefined,
): Message[] {
  const incomingIds = new Set((streamingMessages ?? []).map((overlay) => overlay.messageId));
  for (const messageId of cache.latestOverlays.keys()) {
    if (!incomingIds.has(messageId)) cache.latestOverlays.delete(messageId);
  }
  for (const overlay of streamingMessages ?? []) {
    const latest = cache.latestOverlays.get(overlay.messageId);
    if (!latest || (overlay.updatedAt ?? 0) >= (latest.updatedAt ?? 0)) {
      cache.latestOverlays.set(overlay.messageId, overlay);
    }
  }
  const overlays = cache.latestOverlays;
  const merged = base.map((message) => {
    const overlay = overlays.get(message._id);
    if (!overlay) return message;
    return {
      ...message,
      content: overlay.content,
      reasoning: overlay.reasoning,
      status: overlay.status,
      toolCalls: overlay.toolCalls ?? message.toolCalls,
      toolResults: overlay.toolResults ?? message.toolResults,
      activeToolCallIds: overlay.activeToolCallIds,
      presentationProgress: overlay.presentationProgress,
    };
  });

  const previousById = new Map(
    cache.previousMessages.map((message) => [message._id, message]),
  );
  const reconciled = merged.map((message) => {
    const previous = previousById.get(message._id);
    if (!previous) {
      cache.pendingFallbackMessages.delete(message._id);
      return message;
    }
    const pendingFallback = cache.pendingFallbackMessages.get(message._id);
    const hasActiveOverlay = overlays.has(message._id);

    const finalizedToTerminal =
      message.status === "completed" ||
      message.status === "failed" ||
      message.status === "cancelled";

    const lostStreamingOverlay =
      !hasActiveOverlay &&
      !finalizedToTerminal &&
      previous.status === "streaming" &&
      message.status !== "streaming" &&
      message.content.length < previous.content.length;
    const lostCancelledOverlay =
      !hasActiveOverlay &&
      !finalizedToTerminal &&
      previous.status === "cancelled" &&
      message.status !== "cancelled" &&
      message.content.length < previous.content.length;

    if (lostStreamingOverlay || lostCancelledOverlay) {
      const fallback = mergeMessageWithFallback(previous, message);
      cache.pendingFallbackMessages.set(message._id, fallback);
      return fallback;
    }

    if (hasActiveOverlay) {
      cache.pendingFallbackMessages.delete(message._id);
      return message;
    }

    if (
      pendingFallback &&
      shouldReleasePendingStreamingFallback(pendingFallback, previous, message)
    ) {
      cache.pendingFallbackMessages.delete(message._id);
      return message;
    }

    if (pendingFallback) {
      return pendingFallback;
    }

    cache.pendingFallbackMessages.delete(message._id);
    return message;
  });

  cache.previousMessages = reconciled;
  return reconciled;
}
