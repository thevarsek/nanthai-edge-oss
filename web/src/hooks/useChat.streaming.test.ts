import { describe, expect, test } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message, StreamingMessage } from "@/hooks/useChat";
import {
  createChatMergeCache,
  reconcileStreamingMessages,
  shouldReleasePendingStreamingFallback,
} from "@/hooks/useChat.streaming";

const chatId = "chat_1" as Id<"chats">;
const messageId = "message_1" as Id<"messages">;

function message(overrides: Partial<Message> = {}): Message {
  return {
    _id: messageId,
    _creationTime: 1,
    chatId,
    role: "assistant",
    content: "",
    status: "pending",
    createdAt: 1,
    ...overrides,
  };
}

function overlay(overrides: Partial<StreamingMessage> = {}): StreamingMessage {
  return {
    messageId,
    content: "streaming text",
    status: "streaming",
    ...overrides,
  };
}

describe("useChat streaming reconciliation", () => {
  test("applies streaming overlays onto base messages", () => {
    const cache = createChatMergeCache();
    const result = reconcileStreamingMessages(
      cache,
      [message({ content: "", status: "pending" })],
      [overlay({ content: "hello", reasoning: "thinking" })],
    );

    expect(result[0]).toMatchObject({
      content: "hello",
      reasoning: "thinking",
      status: "streaming",
    });
  });

  test("keeps the newest cumulative tool snapshot when an older live emission arrives", () => {
    const cache = createChatMergeCache();
    const newest = overlay({
      updatedAt: 20,
      toolCalls: [
        { id: "call_1", name: "load_skill", arguments: "{}" },
        { id: "call_2", name: "create_presentation", arguments: "{}" },
        { id: "call_3", name: "create_presentation", arguments: "{}" },
      ],
      activeToolCallIds: ["call_3"],
      presentationProgress: {
        phase: "generating",
        progress: 0.58,
        title: "Roadmap",
        slideCount: 12,
      },
    });
    reconcileStreamingMessages(cache, [message()], [newest]);

    const result = reconcileStreamingMessages(
      cache,
      [message()],
      [overlay({
        updatedAt: 10,
        toolCalls: [{ id: "call_1", name: "load_skill", arguments: "{}" }],
        activeToolCallIds: [],
      })],
    );

    expect(result[0]?.toolCalls).toHaveLength(3);
    expect(result[0]?.activeToolCallIds).toEqual(["call_3"]);
    expect(result[0]?.presentationProgress?.phase).toBe("generating");
  });

  test("retains a streaming fallback when a non-terminal base snapshot loses overlay content", () => {
    const cache = createChatMergeCache();
    reconcileStreamingMessages(
      cache,
      [message({ content: "", status: "pending" })],
      [overlay({ content: "long streaming response", status: "streaming" })],
    );

    const result = reconcileStreamingMessages(
      cache,
      [message({ content: "short", status: "pending" })],
      [],
    );

    expect(result[0]).toMatchObject({
      content: "long streaming response",
      status: "streaming",
    });
    expect(cache.pendingFallbackMessages.get(messageId)?.content).toBe("long streaming response");
  });

  test("releases a fallback once base catches up to fallback content", () => {
    const cache = createChatMergeCache();
    reconcileStreamingMessages(
      cache,
      [message({ content: "", status: "pending" })],
      [overlay({ content: "long streaming response", status: "streaming" })],
    );
    reconcileStreamingMessages(cache, [message({ content: "short", status: "pending" })], []);

    const result = reconcileStreamingMessages(
      cache,
      [message({ content: "long streaming response", status: "pending" })],
      [],
    );

    expect(result[0]).toMatchObject({
      content: "long streaming response",
      status: "pending",
    });
    expect(cache.pendingFallbackMessages.has(messageId)).toBe(false);
  });

  test("keeps a pending fallback across repeated short base snapshots", () => {
    const cache = createChatMergeCache();
    reconcileStreamingMessages(
      cache,
      [message({ content: "", status: "pending" })],
      [overlay({ content: "long streaming response", status: "streaming" })],
    );
    reconcileStreamingMessages(cache, [message({ content: "short", status: "pending" })], []);

    const result = reconcileStreamingMessages(
      cache,
      [message({ content: "still short", status: "pending" })],
      [],
    );

    expect(result[0]).toMatchObject({
      content: "long streaming response",
      status: "streaming",
    });
    expect(cache.pendingFallbackMessages.get(messageId)?.content).toBe("long streaming response");
  });

  test("active overlay clears stale fallback even when overlay is shorter", () => {
    const cache = createChatMergeCache();
    reconcileStreamingMessages(
      cache,
      [message({ content: "", status: "pending" })],
      [overlay({ content: "long streaming response", status: "streaming" })],
    );
    reconcileStreamingMessages(cache, [message({ content: "short", status: "pending" })], []);

    const result = reconcileStreamingMessages(
      cache,
      [message({ content: "short", status: "pending" })],
      [overlay({ content: "new", status: "streaming" })],
    );

    expect(result[0]).toMatchObject({
      content: "new",
      status: "streaming",
    });
    expect(cache.pendingFallbackMessages.has(messageId)).toBe(false);
  });

  test("active pending overlay wins over stale streaming fallback", () => {
    const cache = createChatMergeCache();
    reconcileStreamingMessages(
      cache,
      [message({ content: "", status: "pending" })],
      [overlay({ content: "long streaming response", status: "streaming" })],
    );
    reconcileStreamingMessages(cache, [message({ content: "short", status: "pending" })], []);

    const result = reconcileStreamingMessages(
      cache,
      [message({ content: "short", status: "pending" })],
      [overlay({ content: "new", status: "pending" })],
    );

    expect(result[0]).toMatchObject({
      content: "new",
      status: "pending",
    });
    expect(cache.pendingFallbackMessages.has(messageId)).toBe(false);
  });

  test("terminal base status releases shorter finalized content", () => {
    const fallback = message({ content: "streaming content with trailing data", status: "streaming" });
    const previous = fallback;
    const current = message({ content: "streaming content", status: "completed" });

    expect(shouldReleasePendingStreamingFallback(fallback, previous, current)).toBe(true);
  });

  test("does not synthesize fallback when base directly reaches terminal status", () => {
    const cache = createChatMergeCache();
    reconcileStreamingMessages(
      cache,
      [message({ content: "", status: "pending" })],
      [overlay({ content: "long streaming response", status: "streaming" })],
    );

    const result = reconcileStreamingMessages(
      cache,
      [message({ content: "final", status: "completed" })],
      [],
    );

    expect(result[0]).toMatchObject({
      content: "final",
      status: "completed",
    });
    expect(cache.pendingFallbackMessages.has(messageId)).toBe(false);
  });
});
