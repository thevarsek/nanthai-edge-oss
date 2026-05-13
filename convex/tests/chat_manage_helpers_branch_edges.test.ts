import assert from "node:assert/strict";
import test from "node:test";

import {
  areSiblingMessages,
  deriveCopiedChatMetadata,
  resolveSwitchedBranchLeaf,
} from "../chat/manage_helpers";

function msg(args: {
  id: string;
  createdAt: number;
  parents?: string[];
  group?: string;
}) {
  return {
    _id: args.id,
    createdAt: args.createdAt,
    parentMessageIds: args.parents ?? [],
    multiModelGroupId: args.group,
  } as any;
}

test("deriveCopiedChatMetadata handles empty and whitespace-only copied chats", () => {
  assert.deepEqual(deriveCopiedChatMetadata([]), {
    messageCount: 0,
    activeBranchLeafId: undefined,
    lastMessageDate: undefined,
    lastMessagePreview: undefined,
  });

  const metadata = deriveCopiedChatMetadata([
    { messageId: "m1" as any, createdAt: 10, content: "   " },
    { messageId: "m2" as any, createdAt: 20, content: "\n" },
  ]);
  assert.equal(metadata.messageCount, 2);
  assert.equal(metadata.activeBranchLeafId, "m2");
  assert.equal(metadata.lastMessageDate, undefined);
  assert.equal(metadata.lastMessagePreview, undefined);
});

test("areSiblingMessages rejects self, multimodel siblings, and branch roots without shared parents", () => {
  const root = msg({ id: "root", createdAt: 1 });
  assert.equal(areSiblingMessages(root, root), false);
  assert.equal(
    areSiblingMessages(
      msg({ id: "a", createdAt: 2, parents: ["root"], group: "group_1" }),
      msg({ id: "b", createdAt: 3, parents: ["root"], group: "group_1" }),
    ),
    false,
  );
  assert.equal(
    areSiblingMessages(
      msg({ id: "a", createdAt: 2 }),
      msg({ id: "b", createdAt: 3, parents: ["root"] }),
    ),
    false,
  );
  assert.equal(
    areSiblingMessages(
      msg({ id: "a", createdAt: 2, parents: ["a", "root"] }),
      msg({ id: "b", createdAt: 3, parents: ["root"] }),
    ),
    true,
  );
});

test("resolveSwitchedBranchLeaf handles empty, missing, unrelated, and cyclic branch selections", () => {
  assert.equal(resolveSwitchedBranchLeaf({
    messages: [],
    currentSiblingMessageId: "a",
    targetSiblingMessageId: "b",
  }), undefined);

  const messages = [
    msg({ id: "root", createdAt: 1 }),
    msg({ id: "a1", createdAt: 2, parents: ["root"] }),
    msg({ id: "b1", createdAt: 3, parents: ["root"] }),
    msg({ id: "a2", createdAt: 4, parents: ["a1"] }),
    msg({ id: "orphan", createdAt: 5, parents: ["missing"] }),
    msg({ id: "cycle_a", createdAt: 6, parents: ["cycle_b"] }),
    msg({ id: "cycle_b", createdAt: 7, parents: ["cycle_a"] }),
  ];

  assert.equal(resolveSwitchedBranchLeaf({
    messages,
    currentSiblingMessageId: "missing",
    targetSiblingMessageId: "b1",
  }), undefined);
  assert.equal(resolveSwitchedBranchLeaf({
    messages,
    activeBranchLeafId: "orphan",
    currentSiblingMessageId: "a1",
    targetSiblingMessageId: "b1",
  }), "b1");
  assert.equal(resolveSwitchedBranchLeaf({
    messages,
    activeBranchLeafId: "cycle_a",
    currentSiblingMessageId: "cycle_a",
    targetSiblingMessageId: "cycle_b",
  }), "cycle_a");
});

test("resolveSwitchedBranchLeaf preserves multimodel family indexes across target subtrees", () => {
  const messages = [
    msg({ id: "root", createdAt: 1 }),
    msg({ id: "a1", createdAt: 2, parents: ["root"] }),
    msg({ id: "b1", createdAt: 3, parents: ["root"] }),
    msg({ id: "a2_alpha", createdAt: 4, parents: ["a1"], group: "alpha" }),
    msg({ id: "a2_beta", createdAt: 5, parents: ["a1"], group: "beta" }),
    msg({ id: "a2_beta_duplicate", createdAt: 6, parents: ["a1"], group: "beta" }),
    msg({ id: "b2_alpha", createdAt: 7, parents: ["b1"], group: "alpha" }),
    msg({ id: "b2_beta", createdAt: 8, parents: ["b1"], group: "beta" }),
    msg({ id: "b2_beta_child", createdAt: 9, parents: ["b2_beta"] }),
  ];

  assert.equal(resolveSwitchedBranchLeaf({
    messages,
    activeBranchLeafId: "a2_beta",
    currentSiblingMessageId: "a1",
    targetSiblingMessageId: "b1",
  }), "b2_beta_child");
});
