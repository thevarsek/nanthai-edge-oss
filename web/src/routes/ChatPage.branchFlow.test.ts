import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import {
  hasVisiblePendingAssistant,
  resolvedBranchPath,
  shouldShowPendingResponsePlaceholder,
  visibleMessagesForPath,
} from "./ChatPage.branchFlow";

describe("ChatPage branch flow helpers", () => {
  it("falls back to all message ids when branch hook has not resolved a path", () => {
    const messages = [message("root"), message("child")];

    expect(resolvedBranchPath(messages, [])).toEqual(["root", "child"]);
    expect(resolvedBranchPath(messages, ["child" as Id<"messages">])).toEqual(["child"]);
  });

  it("maps visible messages from path and drops stale ids", () => {
    const messages = [message("root"), message("child")];

    expect(visibleMessagesForPath(messages, [
      "missing" as Id<"messages">,
      "child" as Id<"messages">,
    ])).toEqual([messages[1]]);
  });

  it("detects pending visible assistant and suppresses duplicate pending placeholder", () => {
    const pending = message("assistant_1", "assistant", "pending");

    expect(hasVisiblePendingAssistant([pending])).toBe(true);
    expect(shouldShowPendingResponsePlaceholder({
      isGenerating: true,
      visibleMessages: [pending],
    })).toBe(false);
    expect(shouldShowPendingResponsePlaceholder({
      isGenerating: true,
      visibleMessages: [message("user_1", "user", "completed")],
    })).toBe(true);
  });
});

function message(
  id: string,
  role: Message["role"] = "assistant",
  status: Message["status"] = "completed",
): Message {
  return {
    _id: id as Id<"messages">,
    _creationTime: 1,
    chatId: "chat_1" as Id<"chats">,
    role,
    content: "",
    status,
    createdAt: 1,
  };
}
