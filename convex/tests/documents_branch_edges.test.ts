import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  commitProposedDocxEdits,
  makeCurrentVersion,
  syncDocumentFoldersForChat,
  updateVersionExtraction,
} from "../documents/mutations";

const auth = {
  getUserIdentity: async () => ({ subject: "user_1" }),
};

function dbFor(rows: Record<string, any[]>) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  return {
    patches,
    db: {
      get: async (id: string) => Object.values(rows).flat().find((row) => row._id === id) ?? null,
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => rows[table] ?? [],
        }),
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        const row = Object.values(rows).flat().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, patch);
      },
    },
  };
}

function indexedDbFor(rows: Record<string, any[]>) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; id: string; value: Record<string, unknown> }> = [];
  const counters = new Map<string, number>();
  const allRows = rows;
  const findRow = (id: string) => Object.values(allRows).flat().find((row) => row._id === id) ?? null;

  return {
    patches,
    inserts,
    rows: allRows,
    db: {
      get: async (id: string) => findRow(id),
      insert: async (table: string, value: Record<string, unknown>) => {
        const next = (counters.get(table) ?? 0) + 1;
        counters.set(table, next);
        const id = `${table}_${next}`;
        const row = { _id: id, _creationTime: next, ...value };
        allRows[table] = [...(allRows[table] ?? []), row];
        inserts.push({ table, id, value });
        return id;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        const row = findRow(id);
        if (row) Object.assign(row, patch);
      },
      query: (table: string) => ({
        withIndex: (_indexName: string, build: (q: any) => any) => {
          const filters: Array<{ field: string; value: unknown }> = [];
          const builder = {
            eq: (field: string, value: unknown) => {
              filters.push({ field, value });
              return builder;
            },
          };
          build(builder);
          const filtered = () => (allRows[table] ?? []).filter((row) =>
            filters.every((filter) => row[filter.field] === filter.value)
          );
          const query = {
            collect: async () => filtered(),
            first: async () => filtered()[0] ?? null,
            order: (_direction: "asc" | "desc") => ({
              first: async () => filtered().sort((a, b) =>
                (b.versionNumber ?? 0) - (a.versionNumber ?? 0)
              )[0] ?? null,
            }),
          };
          return query;
        },
      }),
    },
  };
}

test("document extraction updates handle missing versions, ready timestamps, and error states", async () => {
  assert.equal(await (updateVersionExtraction as any)._handler({ db: dbFor({}).db }, {
    versionId: "missing",
    status: "ready",
  }), null);

  const ready = dbFor({
    documents: [{ _id: "doc_1", status: "pending", currentVersionId: "version_1" }],
    documentVersions: [{ _id: "version_1", documentId: "doc_1" }],
  });
  await (updateVersionExtraction as any)._handler({ db: ready.db }, {
    versionId: "version_1",
    status: "ready",
    extractionTextStorageId: "text_1",
    pageCount: 2,
    wordCount: 50,
  });
  assert.equal(ready.patches[0].patch.extractionStatus, "ready");
  assert.equal(ready.patches[1].patch.status, "ready");
  assert.equal(typeof ready.patches[1].patch.lastExtractedAt, "number");

  const failed = dbFor({
    documents: [{ _id: "doc_2", status: "ready", currentVersionId: "version_2" }],
    documentVersions: [{ _id: "version_2", documentId: "doc_2" }],
  });
  await (updateVersionExtraction as any)._handler({ db: failed.db }, {
    versionId: "version_2",
    status: "unsupported",
    extractionError: "unsupported",
  });
  assert.equal(failed.patches[1].patch.status, "error");
  assert.equal(failed.patches[1].patch.lastExtractedAt, undefined);

  const stale = dbFor({
    documents: [{ _id: "doc_3", status: "ready", currentVersionId: "version_current" }],
    documentVersions: [{ _id: "version_old", documentId: "doc_3" }],
  });
  await (updateVersionExtraction as any)._handler({ db: stale.db }, {
    versionId: "version_old",
    status: "unsupported",
    extractionError: "unsupported",
  });
  assert.deepEqual(stale.patches.map((patch) => patch.id), ["version_old"]);
});

test("document folder sync and current-version promotion preserve ownership and sync-state branches", async () => {
  const folders = dbFor({
    documents: [
      { _id: "doc_1", userId: "user_1", originChatId: "chat_1" },
      { _id: "doc_2", userId: "other", originChatId: "chat_1" },
    ],
  });
  await (syncDocumentFoldersForChat as any)._handler({ db: folders.db }, {
    userId: "user_1",
    chatId: "chat_1",
    folderId: "folder_1",
  });
  assert.deepEqual(folders.patches.map((patch) => patch.id), ["doc_1"]);

  const localAhead = dbFor({
    documents: [{
      _id: "doc_3",
      userId: "user_1",
      currentVersionId: "version_old",
      externalSyncedVersionId: "version_drive",
      syncState: "current",
      source: "upload",
    }],
    documentVersions: [{
      _id: "version_edit",
      documentId: "doc_3",
      userId: "user_1",
      storageId: "storage_edit",
      filename: "edit.md",
      mimeType: "text/markdown",
      source: "assistant_edit",
    }],
  });
  await (makeCurrentVersion as any)._handler({ auth, db: localAhead.db }, {
    documentId: "doc_3",
    versionId: "version_edit",
  });
  assert.equal(localAhead.patches[0].patch.syncState, "current");

  const driveLocalAhead = dbFor({
    documents: [{
      _id: "doc_3_drive",
      userId: "user_1",
      currentVersionId: "version_old",
      externalSyncedVersionId: "version_drive",
      syncState: "current",
      source: "drive",
      driveFileId: "drive_file_1",
    }],
    documentVersions: [{
      _id: "version_edit_drive",
      documentId: "doc_3_drive",
      userId: "user_1",
      storageId: "storage_edit_drive",
      filename: "edit.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      source: "assistant_edit",
    }],
  });
  await (makeCurrentVersion as any)._handler({ auth, db: driveLocalAhead.db }, {
    documentId: "doc_3_drive",
    versionId: "version_edit_drive",
  });
  assert.equal(driveLocalAhead.patches[0].patch.syncState, "local_ahead");

  const externalCurrent = dbFor({
    documents: [{
      _id: "doc_4",
      userId: "user_1",
      currentVersionId: "version_old",
      externalSyncedVersionId: "version_import",
      syncState: "external_update_available",
    }],
    documentVersions: [{
      _id: "version_import",
      documentId: "doc_4",
      userId: "user_1",
      storageId: "storage_import",
      filename: "drive.pdf",
      mimeType: "application/pdf",
      source: "drive_import",
    }],
  });
  await (makeCurrentVersion as any)._handler({ auth, db: externalCurrent.db }, {
    documentId: "doc_4",
    versionId: "version_import",
  });
  assert.equal(externalCurrent.patches[0].patch.syncState, "current");

  await assert.rejects(
    (makeCurrentVersion as any)._handler({ auth, db: dbFor({ documents: [] }).db }, {
      documentId: "missing",
      versionId: "version",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );
});

test("proposed DOCX edits reuse one generated file and preserve attachment size metadata", async () => {
  const state = indexedDbFor({
    documents: [{
      _id: "doc_1",
      userId: "user_1",
      currentVersionId: "version_1",
      source: "generated",
    }],
    documentVersions: [{
      _id: "version_1",
      documentId: "doc_1",
      userId: "user_1",
      storageId: "storage_1",
      filename: "Agreement.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      versionNumber: 1,
    }],
    messages: [{ _id: "message_1", generatedFileIds: [], documentEvents: [], documentEditAnnotations: [] }],
    documentEditBatches: [],
    documentEdits: [],
    generatedFiles: [],
  });

  const first = await (commitProposedDocxEdits as any)._handler({ db: state.db }, {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    generationKey: "generation_1",
    documentId: "doc_1",
    sourceVersionId: "version_1",
    storageId: "storage_2",
    filename: "Agreement.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 12600,
    changes: [{
      changeId: "change_1",
      deletedText: "old clause",
      insertedText: "new clause",
    }],
  });
  const second = await (commitProposedDocxEdits as any)._handler({ db: state.db }, {
    userId: "user_1",
    chatId: "chat_1",
    messageId: "message_1",
    generationKey: "generation_1",
    documentId: "doc_1",
    sourceVersionId: first.versionId,
    storageId: "storage_3",
    filename: "Agreement.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 12700,
    changes: [{
      changeId: "change_2",
      deletedText: "another old clause",
      insertedText: "another new clause",
    }],
  });

  assert.equal(first.generatedFileId, second.generatedFileId);
  assert.equal(state.inserts.filter((insert) => insert.table === "generatedFiles").length, 1);
  assert.equal(state.rows.generatedFiles[0]?.sizeBytes, 12700);
  assert.deepEqual(state.rows.messages[0]?.generatedFileIds, [first.generatedFileId]);
  assert.equal(state.rows.messages[0]?.documentEvents[0]?.sizeBytes, 12600);
  assert.equal(state.rows.messages[0]?.documentEvents[1]?.sizeBytes, 12700);
  assert.equal(state.rows.messages[0]?.documentEditAnnotations.length, 2);
});

test("proposed DOCX edits reject stale source versions before advancing document", async () => {
  const state = indexedDbFor({
    documents: [{
      _id: "doc_1",
      userId: "user_1",
      currentVersionId: "version_2",
      source: "generated",
    }],
    documentVersions: [{
      _id: "version_1",
      documentId: "doc_1",
      userId: "user_1",
      storageId: "storage_1",
      filename: "Agreement.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      versionNumber: 1,
    }],
    messages: [{ _id: "message_1", generatedFileIds: [], documentEvents: [], documentEditAnnotations: [] }],
    documentEditBatches: [],
    documentEdits: [],
    generatedFiles: [],
  });

  await assert.rejects(
    (commitProposedDocxEdits as any)._handler({ db: state.db }, {
      userId: "user_1",
      chatId: "chat_1",
      messageId: "message_1",
      generationKey: "generation_1",
      documentId: "doc_1",
      sourceVersionId: "version_1",
      storageId: "storage_2",
      filename: "Agreement.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 12600,
      changes: [{
        changeId: "change_1",
        deletedText: "old clause",
        insertedText: "new clause",
      }],
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "SUPERSEDED_VERSION",
  );
  assert.equal(state.inserts.length, 0);
  assert.equal(state.patches.length, 0);
});
