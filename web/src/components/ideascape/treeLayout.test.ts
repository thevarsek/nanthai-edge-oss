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

  it("anchors missing multi-model siblings to stored first-member positions", () => {
    const positions = computeTreeLayout(
      [
        message("root", [], 1, "user"),
        message("first", ["root"], 2, "assistant", "group_1"),
        message("second", ["root"], 3, "assistant", "group_1"),
      ],
      [{ messageId: "first", x: 1000, y: 640 }],
    );

    expect(positions.get("first")).toEqual({ x: 1000, y: 640 });
    expect(positions.get("second")?.y).toBe(640);
    expect(positions.get("second")?.x).toBeGreaterThan(1200);
  });

  it("preserves stored positions for non-first multi-model siblings", () => {
    const positions = computeTreeLayout(
      [
        message("root", [], 1, "user"),
        message("first", ["root"], 2, "assistant", "group_1"),
        message("second", ["root"], 3, "assistant", "group_1"),
      ],
      [
        { messageId: "first", x: 1000, y: 640 },
        { messageId: "second", x: -320, y: 240 },
      ],
    );

    expect(positions.get("second")).toEqual({ x: -320, y: 240 });
  });
});

function message(
  id: string,
  parentMessageIds: string[],
  createdAt: number,
  role: Message["role"] = "assistant",
  multiModelGroupId?: string,
): Message {
  return {
    _id: id,
    _creationTime: createdAt,
    chatId: "chat",
    role,
    content: "",
    status: "completed",
    parentMessageIds,
    multiModelGroupId,
    createdAt,
  } as Message;
}
