import assert from "node:assert/strict";
import test from "node:test";
import type { QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { listCreatedChats } from "../chat/queries_created_chats";

type Row = Pick<Doc<"chats">, "_id" | "_creationTime" | "createdAt" | "userId"> & { title: string; isPinned?: boolean; updatedAt: number };
function fixture() {
  const rows: Row[] = Array.from({ length: 25 }, (_, i) => ({ _id: `chat${i}` as Id<"chats">,
    _creationTime: i, createdAt: Math.floor(i / 2), userId: "owner", title: i === 0 ? "Ancient target" : `Chat ${i}`,
    updatedAt: 100 - i, isPinned: i === 0 }));
  let searched = "";
  const ctx = { db: {
    get: async (id: string) => rows.find(row => row._id === id) ?? { userId: "foreign" },
    query: () => {
      let boundary: number | undefined;
      const range = { eq: () => range, lte: (_field: string, value: number) => { boundary = value; return range; },
        search: (_field: string, value: string) => { searched = value; return range; } };
      const chain = {
        withIndex: (_name: string, apply: (q: typeof range) => unknown) => { apply(range); return chain; },
        withSearchIndex: (_name: string, apply: (q: typeof range) => unknown) => { apply(range); return chain; },
        order: () => chain, filter: () => chain,
        // Return candidates to exercise helper ordering and cursor ownership; DB filtering is separately indexed.
        take: async () => rows.filter(row => (boundary === undefined || row.createdAt <= boundary) && (!searched || row.title.includes(searched))).reverse(),
      };
      return chain;
    },
  } } as unknown as QueryCtx;
  return { ctx, getSearch: () => searched };
}

test("creation ordering ignores pin/update order and loads older chats without losing timestamp ties", async () => {
  const { ctx } = fixture();
  const page = await listCreatedChats(ctx, "owner", { order: "created" }, 20);
  assert.equal(page.length, 20);
  assert.equal(page[0]._id, "chat24");
  const older = await listCreatedChats(ctx, "owner", { order: "created", beforeChatId: page.at(-1)?._id }, 20);
  assert.deepEqual(older.map(row => row._id), ["chat4", "chat3", "chat2", "chat1", "chat0"]);
  assert.deepEqual(await listCreatedChats(ctx, "owner", { beforeChatId: "foreign" as Id<"chats"> }, 20), []);
});

test("search queries the owned search indexes outside the initially loaded page", async () => {
  const fixtureData = fixture();
  const matches = await listCreatedChats(fixtureData.ctx, "owner", { searchQuery: "Ancient" }, 20);
  assert.deepEqual(matches.map(row => row._id), ["chat0"]);
  assert.equal(fixtureData.getSearch(), "Ancient");
});
