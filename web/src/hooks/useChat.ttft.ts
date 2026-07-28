import { useCallback, useEffect, useRef } from "react";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import { captureAnalytics } from "@/lib/analytics";

interface ResponseTimingRegistration {
  clientEventId: string;
  startedAtMs: number;
  mutationAckAtMs: number;
  assistantMessageIds: Id<"messages">[];
  modelIds: string[];
  source: "send" | "retry";
}

interface PendingResponseTiming extends ResponseTimingRegistration {
  modelIdByMessageId: Map<string, string>;
}

function firstVisibleMessage(
  pending: PendingResponseTiming,
  messages: Message[],
): { message: Message; kind: "content" | "reasoning" } | null {
  const assistantIds = new Set(pending.assistantMessageIds.map(String));
  for (const message of messages) {
    if (!assistantIds.has(String(message._id))) continue;
    if (message.content.trim().length > 0) {
      return { message, kind: "content" };
    }
    if ((message.reasoning?.trim().length ?? 0) > 0) {
      return { message, kind: "reasoning" };
    }
  }
  return null;
}

export function useFirstVisibleResponseAnalytics(
  chatId: Id<"chats"> | null | undefined,
  messages: Message[],
): (registration: ResponseTimingRegistration) => void {
  const pendingRef = useRef(new Map<string, PendingResponseTiming>());

  const captureVisibleResponses = useCallback(() => {
    const now = Date.now();
    for (const [clientEventId, pending] of pendingRef.current) {
      const visible = firstVisibleMessage(pending, messages);
      if (!visible) continue;
      const assistantMessageId = String(visible.message._id);
      captureAnalytics("assistant_first_token", {
        feature_area: "chat",
        chat_id: chatId ? String(chatId) : null,
        assistant_message_id: assistantMessageId,
        assistant_message_count: pending.assistantMessageIds.length,
        model_id: visible.message.modelId
          ?? pending.modelIdByMessageId.get(assistantMessageId)
          ?? null,
        source: pending.source,
        first_visible_kind: visible.kind,
        ttft_ms: now - pending.startedAtMs,
        mutation_ack_ms: pending.mutationAckAtMs - pending.startedAtMs,
        post_ack_to_first_token_ms: now - pending.mutationAckAtMs,
        client_event_id: clientEventId,
      });
      pendingRef.current.delete(clientEventId);
    }
  }, [chatId, messages]);

  useEffect(() => {
    pendingRef.current.clear();
  }, [chatId]);

  useEffect(() => {
    captureVisibleResponses();
  }, [captureVisibleResponses]);

  return useCallback((registration: ResponseTimingRegistration) => {
    if (registration.assistantMessageIds.length === 0) return;
    pendingRef.current.set(registration.clientEventId, {
      ...registration,
      modelIdByMessageId: new Map(
        registration.assistantMessageIds.map((messageId, index) => [
          String(messageId),
          registration.modelIds[index] ?? "",
        ]),
      ),
    });
    captureVisibleResponses();
  }, [captureVisibleResponses]);
}
