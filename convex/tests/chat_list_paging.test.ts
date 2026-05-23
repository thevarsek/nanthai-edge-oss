import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChatListPage,
  chatMatchesSearch,
  chatMatchesSource,
  mergeUserSourceRecentChats,
} from "../chat/queries_handlers_public";

type TestChat = {
  _id: string;
  isPinned?: boolean;
};

test("buildChatListPage keeps all pinned chats outside the unpinned page limit", () => {
  const pinnedChats: TestChat[] = [
    { _id: "pinned_1", isPinned: true },
    { _id: "pinned_2", isPinned: true },
  ];
  const recentChats: TestChat[] = [
    { _id: "recent_1" },
    pinnedChats[0],
    { _id: "recent_2" },
    pinnedChats[1],
    { _id: "recent_3" },
  ];

  const page = buildChatListPage(pinnedChats, recentChats, 2);

  assert.deepEqual(page.map((chat) => chat._id), [
    "pinned_1",
    "pinned_2",
    "recent_1",
    "recent_2",
  ]);
});

test("buildChatListPage does not let pinned chats consume unpinned slots", () => {
  const pinnedChats: TestChat[] = [
    { _id: "pinned_old", isPinned: true },
  ];
  const recentChats: TestChat[] = [
    { _id: "recent_1" },
    pinnedChats[0],
    { _id: "recent_2" },
    { _id: "recent_3" },
  ];

  const page = buildChatListPage(pinnedChats, recentChats, 3);

  assert.deepEqual(page.map((chat) => chat._id), [
    "pinned_old",
    "recent_1",
    "recent_2",
    "recent_3",
  ]);
});

test("chatMatchesSearch uses the shared untitled chat label", () => {
  assert.equal(
    chatMatchesSearch({}, "new conversation", new Map()),
    true,
  );
  assert.equal(
    chatMatchesSearch({}, "new chat", new Map()),
    false,
  );
});

test("chatMatchesSource treats legacy missing source as user-authored", () => {
  assert.equal(chatMatchesSource({}, "user"), true);
  assert.equal(chatMatchesSource({ source: "user" }, "user"), true);
  assert.equal(chatMatchesSource({ source: "scheduled_job" }, "user"), false);
  assert.equal(chatMatchesSource({}, "scheduled_job"), false);
});

test("mergeUserSourceRecentChats keeps indexed user chats visible ahead of newer scheduled chats", () => {
  const explicitUserChats = [
    { _id: "recent_user", createdAt: 50, updatedAt: 140, source: "user" },
    { _id: "shared", createdAt: 90, updatedAt: 90, source: "user" },
  ];
  const legacyUserChats = [
    { _id: "scheduled_candidate", createdAt: 120, updatedAt: 120, source: "scheduled_job" },
    { _id: "shared", createdAt: 90, updatedAt: 90 },
    { _id: "legacy_user", createdAt: 80, updatedAt: 80 },
  ];

  const merged = mergeUserSourceRecentChats(explicitUserChats, legacyUserChats)
    .filter((chat) => chatMatchesSource(chat, "user"));

  assert.deepEqual(merged.map((chat) => chat._id), ["recent_user", "shared", "legacy_user"]);
});
