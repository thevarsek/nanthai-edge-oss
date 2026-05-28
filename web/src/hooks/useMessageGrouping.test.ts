import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "./useChat";
import { groupMessages, messageGroupKey, useMessageGrouping } from "./useMessageGrouping";

function message(id: string, groupId?: string): Message {
  return {
    _id: id as Id<"messages">,
    _creationTime: 1,
    chatId: "chat_1" as Id<"chats">,
    role: "assistant",
    content: id,
    status: "completed",
    createdAt: 1,
    multiModelGroupId: groupId,
    isMultiModelResponse: !!groupId,
  };
}

describe("groupMessages", () => {
  it("groups only consecutive multi-model responses", () => {
    const grouped = groupMessages([
      message("a1", "group_a"),
      message("single"),
      message("a2", "group_a"),
    ]);

    expect(grouped).toEqual([
      { type: "multi", groupId: "group_a", messages: [expect.objectContaining({ _id: "a1" })] },
      { type: "single", message: expect.objectContaining({ _id: "single" }) },
      { type: "multi", groupId: "group_a", messages: [expect.objectContaining({ _id: "a2" })] },
    ]);
  });

  it("creates stable keys for single and multi-message groups", () => {
    const single = { type: "single" as const, message: message("single") };
    const multi = { type: "multi" as const, groupId: "group_a", messages: [message("a1", "group_a")] };

    expect(messageGroupKey(single)).toBe("single");
    expect(messageGroupKey(multi)).toBe("group-group_a");
  });

  it("memoizes grouped output until visible messages change", () => {
    const firstMessages = [message("a1", "group_a"), message("a2", "group_a")];
    const secondMessages = [message("single")];
    const { result, rerender } = renderHook(
      ({ messages }) => useMessageGrouping(messages),
      { initialProps: { messages: firstMessages } },
    );
    const firstResult = result.current;

    rerender({ messages: firstMessages });
    expect(result.current).toBe(firstResult);

    rerender({ messages: secondMessages });
    expect(result.current).not.toBe(firstResult);
    expect(result.current).toEqual([
      { type: "single", message: expect.objectContaining({ _id: "single" }) },
    ]);
  });
});
