import assert from "node:assert/strict";
import test from "node:test";

import { ensureDocumentsForChat } from "../documents/mutations";
import {
  getDocument,
  getDocumentVersionDownloadUrl,
  getVersionForExtraction,
  listDocumentVersions,
} from "../documents/queries";

type Rows = Record<string, any[]>;

function makeDb(rows: Rows) {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const counters: Record<string, number> = {};
  const allRows = () => Object.values(rows).flat();

  return {
    inserts,
    patches,
    db: {
      get: async (id: string) => allRows().find((row) => row._id === id) ?? null,
      query: (table: string) => ({
        withIndex: (indexName: string, builder: (q: any) => unknown) => {
          const eqs: Record<string, unknown> = {};
          const q = {
            eq: (field: string, value: unknown) => {
              eqs[field] = value;
              return q;
            },
          };
          builder(q);
          const matches = () => (rows[table] ?? []).filter((row) =>
            Object.entries(eqs).every(([field, value]) => row[field] === value)
          );
          return {
            collect: async () => matches(),
            first: async () => {
              if (table === "documents" && indexName === "by_source_storage") {
                return matches().find((row) => row.sourceStorageId === eqs.sourceStorageId) ?? null;
              }
              return matches()[0] ?? null;
            },
          };
        },
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        counters[table] = (counters[table] ?? 0) + 1;
        const id = `${table}_${counters[table]}`;
        rows[table] = rows[table] ?? [];
        rows[table].push({ _id: id, ...value });
        inserts.push({ table, value });
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
        const row = allRows().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, value);
      },
    },
  };
}

const auth = {
  getUserIdentity: async () => ({ subject: "user_1" }),
};

test("ensureDocumentsForChat filters unreadable rows and canonicalizes upload, generated, and Drive files", async () => {
  const rows: Rows = {
    chats: [{ _id: "chat_1", userId: "user_1", folderId: "folder_current" }],
    fileAttachments: [
      {
        _id: "fa_upload",
        userId: "user_1",
        chatId: "chat_1",
        storageId: "storage_upload",
        filename: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 11,
      },
      {
        _id: "fa_drive",
        userId: "user_1",
        chatId: "chat_1",
        storageId: "storage_drive",
        filename: "brief.pdf",
        mimeType: "application/pdf",
        driveFileId: "drive_1",
      },
      {
        _id: "fa_existing_orphan",
        userId: "user_1",
        chatId: "chat_1",
        storageId: "storage_orphan",
        filename: "orphan.txt",
        mimeType: "text/plain",
      },
      {
        _id: "fa_other",
        userId: "other",
        chatId: "chat_1",
        storageId: "storage_other",
        filename: "other.md",
        mimeType: "text/markdown",
      },
      {
        _id: "fa_unreadable",
        userId: "user_1",
        chatId: "chat_1",
        storageId: "storage_image",
        filename: "image.png",
        mimeType: "image/png",
      },
    ],
    generatedFiles: [
      {
        _id: "gf_existing",
        userId: "user_1",
        chatId: "chat_1",
        storageId: "storage_generated",
        filename: "generated.pdf",
        mimeType: "application/pdf",
      },
      {
        _id: "gf_unreadable",
        userId: "user_1",
        chatId: "chat_1",
        storageId: "storage_zip",
        filename: "archive.zip",
        mimeType: "application/zip",
      },
    ],
    documents: [
      {
        _id: "doc_orphan",
        userId: "user_1",
        title: "orphan.txt",
        filename: "orphan.txt",
        mimeType: "text/plain",
        source: "upload",
        sourceStorageId: "storage_orphan",
        originChatId: "chat_1",
        status: "ready",
      },
      {
        _id: "doc_generated",
        userId: "user_1",
        title: "generated.pdf",
        filename: "generated.pdf",
        mimeType: "application/pdf",
        source: "generated",
        sourceStorageId: "storage_generated",
        generatedFileId: "gf_existing",
        currentVersionId: "version_generated",
        folderId: "folder_old",
        status: "ready",
      },
    ],
    documentVersions: [{
      _id: "version_generated",
      documentId: "doc_generated",
      userId: "user_1",
      storageId: "storage_generated",
      filename: "generated.pdf",
      mimeType: "application/pdf",
      versionNumber: 2,
      source: "generated_file",
      extractionStatus: "ready",
    }],
  };
  const { db, inserts, patches } = makeDb(rows);

  const result = await (ensureDocumentsForChat as any)._handler({ db }, {
    userId: "user_1",
    chatId: "chat_1",
  });

  assert.deepEqual(result.map((document: any) => document.filename), [
    "notes.md",
    "brief.pdf",
    "orphan.txt",
    "generated.pdf",
  ]);
  assert.equal(result.find((document: any) => document.filename === "brief.pdf").syncState, "current");
  assert.equal(result.find((document: any) => document.filename === "generated.pdf").versionNumber, 2);
  assert.equal(inserts.filter((insert) => insert.table === "documents").length, 2);
  assert.equal(inserts.filter((insert) => insert.table === "documentVersions").length, 3);
  assert.equal(
    rows.documents.find((document) => document.filename === "brief.pdf")?.externalSyncedVersionId,
    rows.documents.find((document) => document.filename === "brief.pdf")?.currentVersionId,
  );
  assert.ok(patches.some((patch) => patch.id === "doc_generated" && patch.value.folderId === "folder_current"));
  assert.ok(patches.some((patch) => patch.id === "doc_orphan" && patch.value.currentVersionId === "documentVersions_3"));
});

test("document queries enforce ownership and expose storage URLs for authorized versions", async () => {
  const rows: Rows = {
    documents: [
      { _id: "doc_1", userId: "user_1", title: "Plan", filename: "plan.md", mimeType: "text/markdown", source: "upload", currentVersionId: "version_1", status: "ready", createdAt: 1, updatedAt: 2 },
      { _id: "doc_other", userId: "other", title: "Other", filename: "other.md", mimeType: "text/markdown", source: "upload", currentVersionId: "version_other", status: "ready", createdAt: 1, updatedAt: 2 },
    ],
    documentVersions: [
      { _id: "version_1", documentId: "doc_1", userId: "user_1", storageId: "storage_1", filename: "plan.md", mimeType: "text/markdown", versionNumber: 1, source: "upload", extractionStatus: "ready", extractionTextStorageId: "text_1", pageCount: 1, wordCount: 20, createdAt: 3 },
      { _id: "version_other", documentId: "doc_other", userId: "other", storageId: "storage_other", filename: "other.md", mimeType: "text/markdown", versionNumber: 1, source: "upload", extractionStatus: "ready", createdAt: 4 },
      { _id: "version_foreign_doc", documentId: "doc_other", userId: "user_1", storageId: "storage_foreign", filename: "foreign.md", mimeType: "text/markdown", versionNumber: 2, source: "upload", extractionStatus: "ready", createdAt: 5 },
    ],
  };
  const { db } = makeDb(rows);
  const ctx = {
    auth,
    db,
    storage: {
      getUrl: async (storageId: string) => storageId === "storage_1" ? "https://files.local/plan.md" : null,
    },
  };

  assert.equal(await (getVersionForExtraction as any)._handler({ db }, { versionId: "missing" }), null);
  assert.equal(
    (await (getVersionForExtraction as any)._handler({ db }, { versionId: "version_1" })).extractionTextStorageId,
    "text_1",
  );
  assert.deepEqual(await (listDocumentVersions as any)._handler(ctx, { documentId: "doc_other" }), []);
  assert.equal((await (listDocumentVersions as any)._handler(ctx, { documentId: "doc_1" }))[0].downloadUrl, "https://files.local/plan.md");
  assert.equal(await (getDocumentVersionDownloadUrl as any)._handler(ctx, { versionId: "missing" }), null);
  assert.equal(await (getDocumentVersionDownloadUrl as any)._handler(ctx, { versionId: "version_foreign_doc" }), null);
  assert.equal((await (getDocumentVersionDownloadUrl as any)._handler(ctx, { versionId: "version_1" })).downloadUrl, "https://files.local/plan.md");
  assert.equal(await (getDocument as any)._handler(ctx, { documentId: "doc_other" }), null);
  assert.equal((await (getDocument as any)._handler(ctx, { documentId: "doc_1" })).title, "Plan");
});
