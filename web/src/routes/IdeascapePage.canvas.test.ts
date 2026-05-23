import { describe, expect, it } from "vitest";

import {
  collectIdeascapeBranchIds,
  nextActiveBranchFocusOrder,
  resolveIdeascapeBranchLeafId,
} from "./IdeascapePage.branchFocus";

describe("IdeascapePage canvas branch focus", () => {
  it("advances focus order beyond local and server values for stale-write protection", () => {
    expect(nextActiveBranchFocusOrder(0, undefined)).toBe(1);
    expect(nextActiveBranchFocusOrder(2, 10)).toBe(11);
    expect(nextActiveBranchFocusOrder(12, 10)).toBe(13);
  });

  it("persists the resolved branch leaf when focusing an ancestor node", () => {
    const messages = [
      { _id: "root", createdAt: 1 },
      { _id: "first", createdAt: 2, parentMessageIds: ["root"] },
      { _id: "second", createdAt: 3, parentMessageIds: ["first"] },
    ];

    expect(resolveIdeascapeBranchLeafId(messages, "root", "second")).toBe("second");
  });

  it("falls back to the newest descendant leaf when no preferred leaf matches", () => {
    const messages = [
      { _id: "root", createdAt: 1 },
      { _id: "branch_a", createdAt: 2, parentMessageIds: ["root"] },
      { _id: "branch_b", createdAt: 3, parentMessageIds: ["root"] },
      { _id: "branch_a_leaf", createdAt: 4, parentMessageIds: ["branch_a"] },
    ];

    expect(resolveIdeascapeBranchLeafId(messages, "root", null)).toBe("branch_a_leaf");
  });

  it("stops branch leaf resolution when malformed parent links cycle", () => {
    const messages = [
      { _id: "a", createdAt: 1, parentMessageIds: ["b"] },
      { _id: "b", createdAt: 2, parentMessageIds: ["a"] },
    ];

    expect(resolveIdeascapeBranchLeafId(messages, "a", null)).toBe("a");
  });

  it("renders the active branch from the resolved leaf instead of the clicked ancestor", () => {
    const messages = [
      { _id: "root", createdAt: 1 },
      { _id: "first", createdAt: 2, parentMessageIds: ["root"] },
      { _id: "second", createdAt: 3, parentMessageIds: ["first"] },
    ];

    expect(Array.from(collectIdeascapeBranchIds(messages, ["second"])).sort()).toEqual([
      "first",
      "root",
      "second",
    ]);
  });

  it("includes multi-model siblings touched by the active branch", () => {
    const messages = [
      { _id: "root", createdAt: 1 },
      { _id: "first", createdAt: 2, parentMessageIds: ["root"], multiModelGroupId: "group_1" },
      { _id: "second", createdAt: 3, parentMessageIds: ["root"], multiModelGroupId: "group_1" },
    ];

    expect(Array.from(collectIdeascapeBranchIds(messages, ["first"])).sort()).toEqual([
      "first",
      "root",
      "second",
    ]);
  });
});
