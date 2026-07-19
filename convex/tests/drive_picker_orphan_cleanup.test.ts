import assert from "node:assert/strict";
import test from "node:test";
import { deleteDeletedParentBatchesHandler } from
  "../drive_picker/orphan_cleanup";

test("Drive picker orphan cleanup deletes only old batches with every parent gone", async () => {
  const batches = [
    {
      _id: "orphan",
      status: "awaiting_pick",
      updatedAt: 10,
      parentJobId: "missing_job",
      parentMessageId: "missing_message",
      chatId: "missing_chat",
    },
    {
      _id: "owned",
      status: "awaiting_pick",
      updatedAt: 20,
      parentJobId: "job",
      parentMessageId: "message",
      chatId: "chat",
    },
    {
      _id: "recent",
      status: "awaiting_pick",
      updatedAt: 200,
      parentJobId: "missing_job_2",
      parentMessageId: "missing_message_2",
      chatId: "missing_chat_2",
    },
  ];
  const parents = new Map([
    ["job", { _id: "job" }],
    ["message", { _id: "message" }],
    ["chat", { _id: "chat" }],
  ]);
  const deleted: string[] = [];
  const scheduled: unknown[] = [];
  const ctx = {
    db: {
      query: () => ({
        withIndex: (_name: string, build: (query: unknown) => unknown) => {
          let status: string | undefined;
          let before = Number.POSITIVE_INFINITY;
          const chain = {
            eq: (_field: string, value: string) => {
              status = value;
              return chain;
            },
            lt: (_field: string, value: number) => {
              before = value;
              return chain;
            },
          };
          build(chain);
          return {
            paginate: async () => ({
              page: batches.filter((batch) =>
                batch.status === status && batch.updatedAt < before),
              continueCursor: "done",
              isDone: true,
            }),
          };
        },
      }),
      get: async (id: string) => parents.get(id) ?? null,
      delete: async (id: string) => deleted.push(id),
    },
    scheduler: {
      runAfter: async (...args: unknown[]) => scheduled.push(args),
    },
  };

  const result = await deleteDeletedParentBatchesHandler(ctx as never, {
    status: "awaiting_pick",
    before: 100,
  });

  assert.deepEqual(result, {
    scanned: 2,
    deleted: 1,
    retained: 1,
    continued: false,
  });
  assert.deepEqual(deleted, ["orphan"]);
  assert.equal(scheduled.length, 0);
});

test("Drive picker orphan cleanup continues bounded scans", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          paginate: async () => ({
            page: [],
            continueCursor: "next",
            isDone: false,
          }),
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

  const result = await deleteDeletedParentBatchesHandler(ctx as never, {
    status: "resuming",
    before: 100,
  });

  assert.equal(result.continued, true);
  assert.deepEqual(scheduled, [{
    status: "resuming",
    before: 100,
    cursor: "next",
  }]);
});
