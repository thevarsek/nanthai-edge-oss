import { describe, expect, it } from "vitest";
import type { Message } from "@/hooks/useChat";
import { computeTreeLayout } from "./treeLayout";

describe("computeTreeLayout", () => {
  it("skips cyclic parent references instead of recursing forever", () => {
    const positions = computeTreeLayout([
      message("a", ["b"], 1),
      message("b", ["a"], 2),
    ]);

    expect([...positions.keys()].sort()).toEqual(["a", "b"]);
  });
});

function message(id: string, parentMessageIds: string[], createdAt: number): Message {
  return {
    _id: id,
    _creationTime: createdAt,
    chatId: "chat",
    role: "assistant",
    content: "",
    status: "completed",
    parentMessageIds,
    createdAt,
  } as Message;
}
