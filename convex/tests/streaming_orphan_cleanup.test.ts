import assert from "node:assert/strict";
import test from "node:test";
import { cleanOrphanedStreamingMessagesHandler } from
  "../chat/streaming_orphan_cleanup";

test("streaming orphan cleanup deletes only old missing or terminal projections", async () => {
  const rows = [
    { _id: "missing", messageId: "missing_message", status: "streaming", updatedAt: 10 },
    { _id: "terminal", messageId: "terminal_message", status: "cancelled", updatedAt: 20 },
    { _id: "active", messageId: "active_message", status: "streaming", updatedAt: 30 },
    { _id: "recent", messageId: "missing_recent", status: "pending", updatedAt: 200 },
  ];
  const messages = new Map([
    ["terminal_message", { _id: "terminal_message", status: "failed" }],
    ["active_message", { _id: "active_message", status: "streaming" }],
  ]);
  const deleted: string[] = [];
  const ctx = {
    db: {
      query: () => ({
        paginate: async () => ({
          page: rows,
          continueCursor: "done",
          isDone: true,
        }),
      }),
      get: async (id: string) => messages.get(id) ?? null,
      delete: async (id: string) => deleted.push(id),
    },
    scheduler: { runAfter: async () => undefined },
  };

  const result = await cleanOrphanedStreamingMessagesHandler(ctx as never, {
    before: 100,
  });

  assert.deepEqual(deleted, ["missing", "terminal"]);
  assert.deepEqual(result, {
    scanned: 4,
    deleted: 2,
    retained: 2,
    continued: false,
  });
});

test("streaming orphan cleanup schedules a bounded continuation", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      query: () => ({
        paginate: async () => ({
          page: [],
          continueCursor: "next",
          isDone: false,
        }),
      }),
      get: async () => null,
      delete: async () => undefined,
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  };

  const result = await cleanOrphanedStreamingMessagesHandler(ctx as never, {
    before: 100,
    cursor: "current",
  });

  assert.equal(result.continued, true);
  assert.deepEqual(scheduled, [{ before: 100, cursor: "next" }]);
});
