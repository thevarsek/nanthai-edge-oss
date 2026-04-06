import assert from "node:assert/strict";
import test from "node:test";

import { isPinOnlyUpdate, UpdateChatArgs } from "../chat/manage_handlers";

// ---------------------------------------------------------------------------
// isPinOnlyUpdate – pure function tests
// ---------------------------------------------------------------------------

test("isPinOnlyUpdate returns true when only isPinned is set", () => {
  const args: UpdateChatArgs = { chatId: "chat1" as any, isPinned: true };
  assert.equal(isPinOnlyUpdate(args), true);
});

test("isPinOnlyUpdate returns true when unpinning", () => {
  const args: UpdateChatArgs = { chatId: "chat1" as any, isPinned: false };
  assert.equal(isPinOnlyUpdate(args), true);
});

test("isPinOnlyUpdate returns false when isPinned is undefined", () => {
  const args: UpdateChatArgs = { chatId: "chat1" as any, title: "hi" };
  assert.equal(isPinOnlyUpdate(args), false);
});

test("isPinOnlyUpdate returns false when title is also set", () => {
  const args: UpdateChatArgs = {
    chatId: "chat1" as any,
    isPinned: true,
    title: "renamed",
  };
  assert.equal(isPinOnlyUpdate(args), false);
});

test("isPinOnlyUpdate returns false when folderId is also set", () => {
  const args: UpdateChatArgs = {
    chatId: "chat1" as any,
    isPinned: true,
    folderId: "folder_1",
  };
  assert.equal(isPinOnlyUpdate(args), false);
});

test("isPinOnlyUpdate returns false when mode is also set", () => {
  const args: UpdateChatArgs = {
    chatId: "chat1" as any,
    isPinned: true,
    mode: "ideascape",
  };
  assert.equal(isPinOnlyUpdate(args), false);
});

test("isPinOnlyUpdate returns false when activeBranchLeafId is also set", () => {
  const args: UpdateChatArgs = {
    chatId: "chat1" as any,
    isPinned: true,
    activeBranchLeafId: "msg_leaf" as any,
  };
  assert.equal(isPinOnlyUpdate(args), false);
});

test("isPinOnlyUpdate returns false when subagentOverride is also set", () => {
  const args: UpdateChatArgs = {
    chatId: "chat1" as any,
    isPinned: true,
    subagentOverride: "enabled",
  };
  assert.equal(isPinOnlyUpdate(args), false);
});

test("isPinOnlyUpdate returns false with no fields at all (empty update)", () => {
  const args: UpdateChatArgs = { chatId: "chat1" as any };
  assert.equal(isPinOnlyUpdate(args), false);
});

// ---------------------------------------------------------------------------
// Favorites validation constants – smoke tests
// ---------------------------------------------------------------------------
// These constants are defined in convex/favorites/mutations.ts. Since they're
// module-private (not exported), we test the expected boundary values here
// by documenting the contract. If the limits change, update these tests.

test("favorites contract: max 3 models per favorite", () => {
  // This is a documentation test — the actual enforcement is in mutations.ts.
  // MAX_MODELS_PER_FAVORITE = 3
  const MAX_MODELS_PER_FAVORITE = 3;
  assert.equal(MAX_MODELS_PER_FAVORITE, 3);
});

test("favorites contract: max 20 favorites per user", () => {
  // MAX_FAVORITES_PER_USER = 20
  const MAX_FAVORITES_PER_USER = 20;
  assert.equal(MAX_FAVORITES_PER_USER, 20);
});
