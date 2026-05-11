import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
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

test("document extraction updates handle missing versions, ready timestamps, and error states", async () => {
  assert.equal(await (updateVersionExtraction as any)._handler({ db: dbFor({}).db }, {
    versionId: "missing",
    status: "ready",
  }), null);

  const ready = dbFor({
    documents: [{ _id: "doc_1", status: "pending" }],
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
    documents: [{ _id: "doc_2", status: "ready" }],
    documentVersions: [{ _id: "version_2", documentId: "doc_2" }],
  });
  await (updateVersionExtraction as any)._handler({ db: failed.db }, {
    versionId: "version_2",
    status: "unsupported",
    extractionError: "unsupported",
  });
  assert.equal(failed.patches[1].patch.status, "error");
  assert.equal(failed.patches[1].patch.lastExtractedAt, undefined);
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
  assert.equal(localAhead.patches[0].patch.syncState, "local_ahead");

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
