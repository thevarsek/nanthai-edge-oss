import assert from "node:assert/strict";
import test from "node:test";
import {
  addUploadToKnowledgeBase,
  bindKnowledgeBaseUploadSession,
  createKnowledgeBaseUploadUrl,
  deleteKnowledgeBaseFileHandler,
  updateDriveAttachmentStorage,
} from "../knowledge_base/mutations";
import {
  getFileAttachmentByStorageInternal,
  getKnowledgeBaseFilesByStorageIdsHandler,
  listKnowledgeBaseFilesHandler,
} from "../knowledge_base/queries";
import {
  importDriveFileToKnowledgeBase,
  refreshDriveStorageIfStale,
} from "../knowledge_base/actions";

function buildAuth(userId: string | null = "user_1") {
  return { getUserIdentity: async () => (userId ? { subject: userId } : null) };
}

function queryRows(rows: Record<string, any[]>, table: string) {
  let filters: Array<{ field: string; value: unknown }> = [];
  const applyFilters = () => (rows[table] ?? []).filter((row) =>
    filters.every((filter) => row[filter.field] === filter.value),
  );
  const chain = {
    withIndex: (_indexName: string, builder?: (q: any) => unknown) => {
      filters = [];
      if (builder) {
        builder({
          eq: (field: string, value: unknown) => {
            filters.push({ field, value });
            return { eq: (nextField: string, nextValue: unknown) => {
              filters.push({ field: nextField, value: nextValue });
              return {};
            } };
          },
        });
      }
      return chain;
    },
    order: () => chain,
    first: async () => applyFilters()[0] ?? null,
    collect: async () => applyFilters(),
    take: async (n: number) => applyFilters().slice(0, n),
  };
  return chain;
}

function buildDb(rows: Record<string, any[]>, events: Array<Record<string, unknown>> = []) {
  return {
    get: async (id: string) => Object.values(rows).flat().find((row) => row._id === id) ?? null,
    query: (table: string) => queryRows(rows, table),
    insert: async (table: string, value: Record<string, unknown>) => {
      const id = `${table}_${(rows[table]?.length ?? 0) + 1}`;
      rows[table] = rows[table] ?? [];
      rows[table].push({ _id: id, ...value });
      events.push({ op: "insert", table, id, value });
      return id;
    },
    patch: async (id: string, value: Record<string, unknown>) => {
      events.push({ op: "patch", id, value });
      const row = Object.values(rows).flat().find((candidate) => candidate._id === id);
      if (row) Object.assign(row, value);
    },
    delete: async (id: string) => {
      events.push({ op: "delete", id });
      for (const tableRows of Object.values(rows)) {
        const idx = tableRows.findIndex((row) => row._id === id);
        if (idx >= 0) tableRows.splice(idx, 1);
      }
    },
  };
}

test("Knowledge Base upload flow creates, binds, consumes, and rejects duplicate registrations", async () => {
  const rows: Record<string, any[]> = { kbUploadSessions: [], fileAttachments: [] };
  const events: Array<Record<string, unknown>> = [];
  const ctx = {
    auth: buildAuth(),
    db: buildDb(rows, events),
    storage: { generateUploadUrl: async () => "https://upload.example/session" },
  };

  const created = await (createKnowledgeBaseUploadUrl as any)._handler(ctx, {});
  assert.equal(created.uploadUrl, "https://upload.example/session");
  await (bindKnowledgeBaseUploadSession as any)._handler(ctx, {
    uploadSessionId: created.uploadSessionId,
    storageId: "storage_1",
  });
  const fileAttachmentId = await (addUploadToKnowledgeBase as any)._handler(ctx, {
    uploadSessionId: created.uploadSessionId,
    storageId: "storage_1",
    filename: "notes.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
  });

  assert.equal(fileAttachmentId, "fileAttachments_1");
  assert.equal(rows.kbUploadSessions[0].status, "consumed");
  assert.equal(rows.fileAttachments[0].filename, "notes.pdf");
  await assert.rejects(
    () => (addUploadToKnowledgeBase as any)._handler(ctx, {
      uploadSessionId: created.uploadSessionId,
      storageId: "storage_1",
      filename: "notes.pdf",
      mimeType: "application/pdf",
    }),
    /Upload session is missing or does not match this file/,
  );
});

test("Knowledge Base upload rejects files over the Settings KB size cap before consuming the session", async () => {
  const rows: Record<string, any[]> = {
    kbUploadSessions: [{ _id: "session_1", userId: "user_1", status: "pending", storageId: "storage_big" }],
    fileAttachments: [],
  };
  await assert.rejects(
    () => (addUploadToKnowledgeBase as any)._handler({
      auth: buildAuth(),
      db: buildDb(rows),
    }, {
      uploadSessionId: "session_1",
      storageId: "storage_big",
      filename: "huge.zip",
      mimeType: "application/zip",
      sizeBytes: 26 * 1024 * 1024,
    }),
    /File is too large/,
  );
  assert.equal(rows.kbUploadSessions[0].status, "pending");
});

test("deleteKnowledgeBaseFile removes message references but preserves shared storage blobs", async () => {
  const rows: Record<string, any[]> = {
    fileAttachments: [
      { _id: "fa_1", userId: "user_1", storageId: "storage_shared", filename: "a.pdf", mimeType: "application/pdf", messageId: "msg_1" },
      { _id: "fa_2", userId: "user_1", storageId: "storage_shared", filename: "b.pdf", mimeType: "application/pdf" },
    ],
    messages: [{ _id: "msg_1", userId: "user_1", attachments: [{ storageId: "storage_shared" }, { storageId: "other" }] }],
    documents: [],
    googleDriveFileGrants: [{ _id: "grant_1", userId: "user_1", cachedStorageId: "storage_shared" }],
  };
  const events: Array<Record<string, unknown>> = [];
  const storageDeletes: string[] = [];

  await deleteKnowledgeBaseFileHandler({
    auth: buildAuth(),
    db: buildDb(rows, events),
    storage: { delete: async (id: string) => storageDeletes.push(id) },
  } as any, { source: "upload", storageId: "storage_shared" as any, fileAttachmentId: "fa_1" as any });

  assert.deepEqual(rows.messages[0].attachments, [{ storageId: "other" }]);
  assert.deepEqual(storageDeletes, []);
  assert.ok(rows.fileAttachments.some((row) => row._id === "fa_2"));
  assert.ok(rows.googleDriveFileGrants.some((row) => row._id === "grant_1"));
  assert.ok(events.some((event) => event.op === "delete" && event.id === "fa_1"));
});

test("deleteKnowledgeBaseFile cleans generated media documents, extraction blobs, grant cache, and storage", async () => {
  const rows: Record<string, any[]> = {
    generatedFiles: [],
    generatedMedia: [{ _id: "media_1", userId: "user_1", storageId: "storage_media", type: "video", mimeType: "video/mp4" }],
    fileAttachments: [],
    generatedMediaRefs: [],
    googleDriveFileGrants: [{ _id: "grant_1", userId: "user_1", cachedStorageId: "storage_media" }],
    documents: [{ _id: "doc_1", userId: "user_1", generatedMediaId: "media_1", currentVersionId: "version_1" }],
    documentVersions: [{ _id: "version_1", documentId: "doc_1", storageId: "storage_version", extractionTextStorageId: "text_1", extractionMarkdownStorageId: "md_1" }],
  };
  const events: Array<Record<string, unknown>> = [];
  const storageDeletes: string[] = [];

  await deleteKnowledgeBaseFileHandler({
    auth: buildAuth(),
    db: buildDb(rows, events),
    storage: { delete: async (id: string) => storageDeletes.push(id) },
  } as any, { source: "generated", storageId: "storage_media" as any });

  assert.deepEqual(storageDeletes, ["storage_version", "text_1", "md_1", "storage_media"]);
  assert.deepEqual(events.filter((event) => event.op === "delete").map((event) => event.id), [
    "version_1",
    "doc_1",
    "media_1",
    "grant_1",
  ]);
});

test("listKnowledgeBaseFiles hydrates folder metadata and unfiled filters across upload and Drive rows", async () => {
  const rows: Record<string, any[]> = {
    generatedFiles: [],
    generatedMedia: [],
    fileAttachments: [
      { _id: "fa_drive", userId: "user_1", storageId: "storage_drive", filename: "drive.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", chatId: "chat_1", driveFileId: "drive_1", createdAt: 30 },
      { _id: "fa_upload", userId: "user_1", storageId: "storage_upload", filename: "loose.txt", mimeType: "text/plain", createdAt: 20 },
    ],
    chats: [{ _id: "chat_1", userId: "user_1", folderId: "folder_1" }],
    documents: [{ _id: "doc_1", userId: "user_1", fileAttachmentId: "fa_drive", currentVersionId: "version_1", externalSyncedVersionId: "version_2", folderId: "folder_1", status: "ready", syncState: "current" }],
    documentVersions: [
      { _id: "version_1", storageId: "storage_drive", versionNumber: 1, extractionStatus: "ready" },
      { _id: "version_2", storageId: "storage_drive_external", versionNumber: 2 },
    ],
  };
  const result = await listKnowledgeBaseFilesHandler({
    auth: buildAuth(),
    db: buildDb(rows),
    storage: { getUrl: async (id: string) => `https://cdn.example/${id}` },
  } as any, { source: "all", folderFilter: "unfiled", limit: 10 });

  assert.equal(result.length, 1);
  assert.equal(result[0].filename, "loose.txt");
  assert.equal(result[0].documentFolderId, undefined);

  const folderResult = await listKnowledgeBaseFilesHandler({
    auth: buildAuth(),
    db: buildDb(rows),
    storage: { getUrl: async (id: string) => `https://cdn.example/${id}` },
  } as any, { source: "drive", folderId: "folder_1" as any, limit: 10 });
  assert.equal(folderResult[0].documentExternalSyncedDownloadUrl, "https://cdn.example/storage_drive_external");
  assert.equal(folderResult[0].isReadableDocument, true);
});

test("storage-id KB lookup returns owned generated media and Drive attachments once", async () => {
  const rows: Record<string, any[]> = {
    generatedFiles: [],
    generatedMedia: [{ _id: "gm_1", userId: "user_1", storageId: "storage_media", type: "image", mimeType: "image/png", createdAt: 20 }],
    fileAttachments: [{ _id: "fa_1", userId: "user_1", storageId: "storage_drive", filename: "drive.pdf", mimeType: "application/pdf", driveFileId: "drive_1", createdAt: 10 }],
  };
  const result = await getKnowledgeBaseFilesByStorageIdsHandler({
    auth: buildAuth(),
    db: buildDb(rows),
    storage: { getUrl: async (id: string) => `https://cdn.example/${id}` },
  } as any, { storageIds: ["storage_media", "storage_drive", "storage_media"] as any });

  assert.deepEqual(result.map((file) => file.source), ["generated", "drive"]);
  assert.equal(result[0].filename, "generated-image.png");
  assert.equal(result[1].driveFileId, "drive_1");
});

test("Drive refresh action handles missing and non-Drive attachments without external fetches", async () => {
  await assert.rejects(
    () => (refreshDriveStorageIfStale as any)._handler({
      runQuery: async () => null,
    }, { fileAttachmentId: "missing" }),
    /File attachment not found/,
  );

  const result = await (refreshDriveStorageIfStale as any)._handler({
    runQuery: async () => ({ _id: "fa_1", userId: "user_1", storageId: "storage_upload", filename: "a.txt", mimeType: "text/plain" }),
  }, { fileAttachmentId: "fa_1" });
  assert.deepEqual(result, { storageId: "storage_upload", refreshed: false });
});

test("Drive import action rejects blank file ids and internal storage query resolves attachment metadata", async () => {
  await assert.rejects(
    () => (importDriveFileToKnowledgeBase as any)._handler({
      auth: buildAuth(),
    }, { fileId: "   " }),
    /Drive fileId is required/,
  );

  const rows = {
    fileAttachments: [{ _id: "fa_1", storageId: "storage_1", driveFileId: "drive_1" }],
  };
  const found = await (getFileAttachmentByStorageInternal as any)._handler({
    db: buildDb(rows),
  }, { storageId: "storage_1" });
  assert.deepEqual(found, { _id: "fa_1", driveFileId: "drive_1" });
});

test("Drive refresh updates scheduled job references when storage changes", async () => {
  const rows: Record<string, any[]> = {
    fileAttachments: [{ _id: "fa_drive", userId: "user_1", storageId: "old_storage", filename: "drive.pdf", mimeType: "application/pdf" }],
    documents: [],
    scheduledJobs: [{
      _id: "job_1",
      userId: "user_1",
      knowledgeBaseFileIds: ["old_storage", "other_storage"],
      steps: [{ type: "prompt", knowledgeBaseFileIds: ["old_storage"] }],
    }],
  };
  const events: Array<Record<string, unknown>> = [];
  await (updateDriveAttachmentStorage as any)._handler({
    db: buildDb(rows, events),
  }, {
    fileAttachmentId: "fa_drive",
    storageId: "new_storage",
    filename: "drive.pdf",
    mimeType: "application/pdf",
    lastRefreshedAt: 123,
  });

  const jobPatch = events.find((event) => event.op === "patch" && event.id === "job_1")?.value as any;
  assert.deepEqual(jobPatch.knowledgeBaseFileIds, ["new_storage", "other_storage"]);
  assert.deepEqual(jobPatch.steps[0].knowledgeBaseFileIds, ["new_storage"]);
});
