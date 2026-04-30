import test from "node:test";
import assert from "node:assert/strict";

import { sidebarChatMatchesSearch } from "./sidebarSearch";

test("sidebar search matches title, preview, and containing folder", () => {
  assert.equal(sidebarChatMatchesSearch({ title: "Research note" }, "research"), true);
  assert.equal(sidebarChatMatchesSearch({ lastMessagePreview: "Deep research summary" }, "research"), true);
  assert.equal(sidebarChatMatchesSearch({ title: "Untitled", folderName: "Research" }, "research"), true);
  assert.equal(sidebarChatMatchesSearch({ title: "Cooking", folderName: "Personal" }, "research"), false);
});
