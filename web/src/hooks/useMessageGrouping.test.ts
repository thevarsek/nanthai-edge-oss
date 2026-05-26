import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "./useChat";
import { groupMessages } from "./useMessageGrouping";

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
});
