import assert from "node:assert/strict";
import test from "node:test";

import { buildChatListPage } from "../chat/queries_handlers_public";

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
