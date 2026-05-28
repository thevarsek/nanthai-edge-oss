import { renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "./useChat";
import { useBranching } from "./useBranching";

const chatId = "chat_1" as Id<"chats">;

function message(id: string, overrides: Partial<Message> = {}): Message {
  return {
    _id: id as Id<"messages">,
    _creationTime: 1,
    chatId,
    role: "assistant",
    content: id,
    status: "completed",
    createdAt: 1,
    ...overrides,
  };
}

describe("useBranching", () => {
  test("matches mobile sibling semantics by grouping messages that share any direct parent", () => {
    const sharedParent = "parent_a" as Id<"messages">;
    const leftOnlyParent = "parent_b" as Id<"messages">;
    const rightOnlyParent = "parent_c" as Id<"messages">;
    const active = "child_ab" as Id<"messages">;
    const otherMergeContext = "child_ac" as Id<"messages">;

    const { result } = renderHook(() => useBranching([
      message("parent_a", { createdAt: 1 }),
      message("parent_b", { createdAt: 2 }),
      message("parent_c", { createdAt: 3 }),
      message("child_ab", { createdAt: 4, parentMessageIds: [sharedParent, leftOnlyParent] }),
      message("child_ac", { createdAt: 5, parentMessageIds: [sharedParent, rightOnlyParent] }),
    ], { activeLeafId: active }));

    expect(result.current.branchNodes.get(active)?.siblings).toEqual([active, otherMergeContext]);
  });

  test("navigates to the equivalent descendant branch when switching siblings", () => {
    const root = "root" as Id<"messages">;
    const branchA = "branch_a" as Id<"messages">;
    const branchB = "branch_b" as Id<"messages">;

    const { result } = renderHook(() => useBranching([
      message("root", { createdAt: 1 }),
      message("branch_a", { createdAt: 2, parentMessageIds: [root] }),
      message("branch_b", { createdAt: 3, parentMessageIds: [root] }),
      message("branch_a_first", { createdAt: 4, parentMessageIds: [branchA] }),
      message("branch_a_second", { createdAt: 5, parentMessageIds: [branchA] }),
      message("branch_b_first", { createdAt: 6, parentMessageIds: [branchB] }),
      message("branch_b_second", { createdAt: 7, parentMessageIds: [branchB] }),
    ], { activeLeafId: "branch_a_second" as Id<"messages"> }));

    expect(result.current.navigate(branchA, "next")).toEqual({
      currentSiblingId: "branch_a",
      targetSiblingId: "branch_b",
      optimisticLeafId: "branch_b_second",
    });
    expect(result.current.navigate(branchA, "prev")).toBeUndefined();
  });

  test("prefers the latest non-failed leaf when no active leaf is supplied", () => {
    const root = "root" as Id<"messages">;

    const { result } = renderHook(() => useBranching([
      message("root", { createdAt: 1 }),
      message("successful_leaf", { createdAt: 2, parentMessageIds: [root], status: "completed" }),
      message("failed_leaf", { createdAt: 3, parentMessageIds: [root], status: "failed" }),
    ]));

    expect(result.current.activePath).toEqual([
      "root" as Id<"messages">,
      "successful_leaf" as Id<"messages">,
    ]);
  });
});
