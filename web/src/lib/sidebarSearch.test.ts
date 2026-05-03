import { expect, test } from "vitest";

import { sidebarChatMatchesSearch } from "./sidebarSearch";

test("sidebar search matches title, preview, and containing folder", () => {
  expect(sidebarChatMatchesSearch({ title: "Research note" }, "research")).toBe(true);
  expect(sidebarChatMatchesSearch({ lastMessagePreview: "Deep research summary" }, "research")).toBe(true);
  expect(sidebarChatMatchesSearch({ title: "Untitled", folderName: "Research" }, "research")).toBe(true);
  expect(sidebarChatMatchesSearch({ title: "Cooking", folderName: "Personal" }, "research")).toBe(false);
});
