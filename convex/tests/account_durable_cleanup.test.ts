import assert from "node:assert/strict";
import test from "node:test";
import { deleteDurableOrchestrationBatch } from "../account/mutations_durable_cleanup";

type Row = Record<string, unknown> & { _id: string };
type IndexQuery = { eq: (field: string, value: unknown) => IndexQuery };

function fixture(initial: Record<string, Row[]>) {
  const rows = new Map(Object.entries(initial));
  const deleted: string[] = [];
  const patched: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const blobs: string[] = [];
  const ctx = {
    db: {
      get: async (id: string) => [...rows.values()].flat().find((row) => row._id === id) ?? null,
      query: (table: string) => ({
        withIndex: (_index: string, apply?: (query: IndexQuery) => unknown) => {
          const filters: Array<[string, unknown]> = [];
          const query: IndexQuery = {
            eq: (field, value) => {
              filters.push([field, value]);
              return query;
            },
          };
          apply?.(query);
          const matching = () => (rows.get(table) ?? []).filter((row) =>
            filters.every(([field, value]) => row[field] === value)
          );
          return { take: async (count: number) => matching().slice(0, count) };
        },
      }),
      delete: async (id: string) => {
        deleted.push(id);
        for (const tableRows of rows.values()) {
          const index = tableRows.findIndex((row) => row._id === id);
          if (index >= 0) tableRows.splice(index, 1);
        }
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patched.push({ id, patch });
        const row = [...rows.values()].flat().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      },
    },
    storage: { delete: async (id: string) => void blobs.push(id) },
  } as never;
  return { ctx, rows, deleted, patched, blobs };
}

test("durable account cleanup deletes owned analytics intents and their blobs", async () => {
  const state = fixture({
    analyticsArtifactIntents: [
      { _id: "owned", userId: "user_1", storageId: "blob_1" },
      { _id: "foreign", userId: "user_2", storageId: "blob_2" },
    ],
  });
  const processed = await deleteDurableOrchestrationBatch(
    state.ctx,
    "analyticsArtifactIntents",
    "user_1",
    200,
  );
  assert.equal(processed, 1);
  assert.deepEqual(state.deleted, ["owned"]);
  assert.deepEqual(state.blobs, ["blob_1"]);
});

test("durable account cleanup backfills foreign legacy rows and deletes owned legacy rows", async () => {
  const state = fixture({
    streamingMessages: [
      { _id: "legacy_owned", userId: undefined, chatId: "chat_owned" },
      { _id: "legacy_foreign", userId: undefined, chatId: "chat_foreign" },
    ],
    chats: [
      { _id: "chat_owned", userId: "user_1" },
      { _id: "chat_foreign", userId: "user_2" },
    ],
  });
  const processed = await deleteDurableOrchestrationBatch(
    state.ctx,
    "streamingMessages",
    "user_1",
    200,
  );
  assert.equal(processed, 2);
  assert.deepEqual(state.deleted, ["legacy_owned"]);
  assert.deepEqual(state.patched, [{ id: "legacy_foreign", patch: { userId: "user_2" } }]);
});
