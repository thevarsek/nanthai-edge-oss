import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  appendAttachmentsAndMarkResuming,
  cancelBatch,
  completeBatch,
  createBatch,
  getBatchForUser,
  scheduleResume,
} from "../drive_picker/mutations";

function makeRows() {
  return {
    messages: [
      { _id: "parent", userId: "user_1", chatId: "chat_1", status: "pending" },
      { _id: "source", userId: "user_1", chatId: "chat_1", attachments: [{ storageId: "s_existing" }] },
      { _id: "streaming", status: "pending" },
    ],
    generationJobs: [{ _id: "job", streamingMessageId: "streaming", status: "pending" }],
    drivePickerBatches: [{
      _id: "batch",
      parentMessageId: "parent",
      sourceUserMessageId: "source",
      parentJobId: "job",
      chatId: "chat_1",
      userId: "user_1",
      status: "awaiting_pick",
      paramsSnapshot: { searchMode: "web" },
      participantSnapshot: { participant: { assistantMessageId: "parent", modelId: "model" } },
    }],
    fileAttachments: [] as any[],
    streamingMessages: [] as any[],
  } as Record<string, any[]>;
}

function makeDb(rows = makeRows()) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deletes: string[] = [];
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  return {
    rows,
    patches,
    deletes,
    inserts,
    db: {
      get: async (id: string) => Object.values(rows).flat().find((row) => row._id === id) ?? null,
      query: (table: string) => ({
        withIndex: () => ({
          unique: async () => rows[table]?.[0] ?? null,
          first: async () => rows[table]?.[0] ?? null,
          collect: async () => rows[table] ?? [],
        }),
      }),
      insert: async (table: string, row: Record<string, unknown>) => {
        inserts.push({ table, row });
        const id = `${table}_${inserts.length}`;
        rows[table] = rows[table] ?? [];
        rows[table].push({ _id: id, ...row });
        return id;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        const row = Object.values(rows).flat().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      },
      delete: async (id: string) => deletes.push(id),
    },
  };
}

test("Drive picker batch creation, lookup, cancellation, completion, and scheduling branch by lifecycle", async () => {
  const createdRows = makeRows();
  createdRows.drivePickerBatches = [];
  const created = makeDb(createdRows);
  const result = await (createBatch as any)._handler({ db: created.db }, {
    parentMessageId: "parent",
    sourceUserMessageId: "source",
    parentJobId: "job",
    chatId: "chat_1",
    userId: "user_1",
    toolCallId: "call_1",
    toolCallArguments: "{}",
    toolRoundCalls: [],
    toolRoundResults: [],
    resumeConversationSeed: [],
    paramsSnapshot: {},
    participantSnapshot: {},
  });
  assert.equal(result.batchId, "drivePickerBatches_1");
  assert.equal(created.patches.some((patch) => patch.id === "streaming"), true);

  const store = makeDb();
  assert.equal(await (getBatchForUser as any)._handler({ db: store.db }, { batchId: "missing", userId: "user_1" }), null);
  assert.equal(await (getBatchForUser as any)._handler({ db: store.db }, { batchId: "batch", userId: "other" }), null);
  assert.equal((await (getBatchForUser as any)._handler({ db: store.db }, { batchId: "batch", userId: "user_1" }))._id, "batch");

  assert.deepEqual(await (cancelBatch as any)._handler({ db: store.db }, { batchId: "missing", userId: "user_1" }), { cancelled: false });
  assert.deepEqual(await (cancelBatch as any)._handler({ db: store.db }, { batchId: "batch", userId: "other" }), { cancelled: false });
  store.rows.drivePickerBatches[0].status = "resuming";
  assert.deepEqual(await (cancelBatch as any)._handler({ db: store.db }, { batchId: "batch", userId: "user_1" }), { cancelled: false });
  store.rows.drivePickerBatches[0].status = "awaiting_pick";
  assert.deepEqual(await (cancelBatch as any)._handler({ db: store.db }, { batchId: "batch", userId: "user_1" }), { cancelled: true });
  assert.deepEqual(store.deletes, ["streaming"]);

  await (completeBatch as any)._handler({ db: store.db }, { batchId: "missing", status: "failed" });
  await (completeBatch as any)._handler({ db: store.db }, { batchId: "batch", status: "completed" });
  await (scheduleResume as any)._handler({ db: store.db }, { batchId: "missing", scheduledFunctionId: "sched_1" });
  await (scheduleResume as any)._handler({ db: store.db }, { batchId: "batch", scheduledFunctionId: "sched_1" });
  assert.equal(store.patches.some((patch) => patch.id === "job" && patch.patch.scheduledFunctionId === "sched_1"), true);
});

test("Drive picker append validates ownership, state, source rows, snapshots, and attachment dedupe", async () => {
  await assert.rejects(
    (appendAttachmentsAndMarkResuming as any)._handler({ db: makeDb().db }, {
      batchId: "batch",
      userId: "other",
      pickedFileIds: [],
      attachments: [],
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );

  const notAwaiting = makeDb();
  notAwaiting.rows.drivePickerBatches[0].status = "cancelled";
  await assert.rejects(
    (appendAttachmentsAndMarkResuming as any)._handler({ db: notAwaiting.db }, {
      batchId: "batch",
      userId: "user_1",
      pickedFileIds: [],
      attachments: [],
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "VALIDATION",
  );

  const missingSnapshot = makeDb();
  missingSnapshot.rows.drivePickerBatches[0].participantSnapshot = {};
  await assert.rejects(
    (appendAttachmentsAndMarkResuming as any)._handler({ db: missingSnapshot.db }, {
      batchId: "batch",
      userId: "user_1",
      pickedFileIds: [],
      attachments: [],
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "INTERNAL_ERROR",
  );

  const success = makeDb();
  success.rows.generationJobs[0].streamingMessageId = undefined;
  const resumed = await (appendAttachmentsAndMarkResuming as any)._handler({ db: success.db }, {
    batchId: "batch",
    userId: "user_1",
    pickedFileIds: ["drive_1"],
    attachments: [
      { type: "file", url: "https://files/existing", storageId: "s_existing", name: "old.pdf", mimeType: "application/pdf" },
      { type: "file", url: "https://files/new", storageId: "s_new", name: "new.pdf", mimeType: "application/pdf", sizeBytes: 10, driveFileId: "drive_1" },
    ],
  });
  assert.equal(resumed.participant.streamingMessageId, "streamingMessages_2");
  assert.equal(success.inserts.some((insert) => insert.table === "fileAttachments"), true);
  assert.equal(success.patches.some((patch) => patch.id === "batch" && patch.patch.status === "resuming"), true);
});
