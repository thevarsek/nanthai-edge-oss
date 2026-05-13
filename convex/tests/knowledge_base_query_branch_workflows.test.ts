import assert from "node:assert/strict";
import test from "node:test";

import {
  getFileAttachmentByStorageInternal,
  getFileAttachmentInternal,
  getKnowledgeBaseFilesByStorageIdsHandler,
  listKnowledgeBaseFilesHandler,
} from "../knowledge_base/queries";

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
      builder?.({
        eq: (field: string, value: unknown) => {
          filters.push({ field, value });
          return {
            eq: (nextField: string, nextValue: unknown) => {
              filters.push({ field: nextField, value: nextValue });
              return {};
            },
          };
        },
      });
      return chain;
    },
    order: () => chain,
    first: async () => applyFilters()[0] ?? null,
    take: async (n: number) => applyFilters().slice(0, n),
  };
  return chain;
}

function buildDb(rows: Record<string, any[]>, includeGet = true) {
  const db = {
    query: (table: string) => queryRows(rows, table),
  };
  if (!includeGet) return db;
  return {
    ...db,
    get: async (id: string) =>
      Object.values(rows).flat().find((row) => row._id === id) ?? null,
  };
}

test("folder-scoped KB listing merges generated files, media, uploads, and Drive rows for owned chats", async () => {
  const rows: Record<string, any[]> = {
    chats: [
      { _id: "chat_1", userId: "user_1", folderId: "folder_1" },
      { _id: "chat_2", userId: "user_2", folderId: "folder_1" },
    ],
    generatedFiles: [
      { _id: "gf_1", userId: "user_1", storageId: "storage_generated", filename: "brief.pdf", mimeType: "application/pdf", sizeBytes: 100, toolName: "generate_pdf", chatId: "chat_1", messageId: "msg_1", createdAt: 40 },
      { _id: "gf_foreign", userId: "user_2", storageId: "storage_foreign", filename: "foreign.pdf", mimeType: "application/pdf", chatId: "chat_1", createdAt: 90 },
    ],
    generatedMedia: [
      { _id: "gm_1", userId: "user_1", storageId: "storage_video", type: "video", mimeType: "video/mp4", sizeBytes: 200, chatId: "chat_1", messageId: "msg_2", createdAt: 50 },
    ],
    fileAttachments: [
      { _id: "fa_upload", userId: "user_1", storageId: "storage_upload", filename: undefined, mimeType: "text/plain", chatId: "chat_1", messageId: "msg_3", createdAt: 30 },
      { _id: "fa_drive", userId: "user_1", storageId: "storage_drive", filename: "drive.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", chatId: "chat_1", driveFileId: "drive_1", lastRefreshedAt: 123, createdAt: 20 },
    ],
    documents: [],
    documentVersions: [],
  };

  const result = await listKnowledgeBaseFilesHandler({
    auth: buildAuth(),
    db: buildDb(rows),
    storage: { getUrl: async (id: string) => `https://cdn.example/${id}` },
  } as any, { folderId: "folder_1" as any, source: "all", limit: 10 });

  assert.deepEqual(result.map((file) => file.storageId), [
    "storage_video",
    "storage_generated",
    "storage_upload",
    "storage_drive",
  ]);
  assert.equal(result[0].filename, "generated-video.mp4");
  assert.equal(result[0].toolName, "video_generation");
  assert.equal(result[1].documentFolderId, "folder_1");
  assert.equal(result[2].filename, "attachment");
  assert.equal(result[3].source, "drive");
  assert.equal(result[3].driveFileId, "drive_1");
});

test("KB listing applies source and search filters without document hydration support", async () => {
  const rows: Record<string, any[]> = {
    generatedFiles: [
      { _id: "gf_1", userId: "user_1", storageId: "storage_report", filename: "monthly-report.pdf", mimeType: "application/pdf", createdAt: 30 },
      { _id: "gf_2", userId: "user_1", storageId: "storage_notes", filename: "notes.pdf", mimeType: "application/pdf", createdAt: 20 },
    ],
    generatedMedia: [
      { _id: "gm_1", userId: "user_1", storageId: "storage_image", type: "image", mimeType: "image/png", createdAt: 10 },
    ],
    fileAttachments: [
      { _id: "fa_drive", userId: "user_1", storageId: "storage_drive", filename: "monthly-drive.pdf", mimeType: "application/pdf", driveFileId: "drive_1", createdAt: 40 },
      { _id: "fa_upload", userId: "user_1", storageId: "storage_upload", filename: "monthly-upload.pdf", mimeType: "application/pdf", createdAt: 35 },
    ],
  };

  const generated = await listKnowledgeBaseFilesHandler({
    auth: buildAuth(),
    db: buildDb(rows, false),
    storage: { getUrl: async (id: string) => `https://cdn.example/${id}` },
  } as any, { source: "generated", search: "report", limit: 10 });

  assert.deepEqual(generated.map((file) => file.storageId), ["storage_report"]);
  assert.equal(generated[0].documentId, undefined);

  const uploads = await listKnowledgeBaseFilesHandler({
    auth: buildAuth(),
    db: buildDb(rows, false),
    storage: { getUrl: async (id: string) => `https://cdn.example/${id}` },
  } as any, { source: "upload", search: "monthly", limit: 10 });

  assert.deepEqual(uploads.map((file) => file.storageId), ["storage_upload"]);
});

test("KB listing hydrates document metadata, filters filed rows from unfiled view, and dedupes storage IDs", async () => {
  const rows: Record<string, any[]> = {
    generatedFiles: [
      { _id: "gf_1", userId: "user_1", storageId: "storage_doc", filename: "contract.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", createdAt: 50 },
      { _id: "gf_dup", userId: "user_1", storageId: "storage_doc", filename: "contract-copy.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", createdAt: 40 },
      { _id: "gf_filed", userId: "user_1", storageId: "storage_filed", filename: "filed.pdf", mimeType: "application/pdf", chatId: "chat_filed", createdAt: 60 },
    ],
    generatedMedia: [],
    fileAttachments: [
      { _id: "fa_1", userId: "user_1", storageId: "storage_upload", filename: "notes.txt", mimeType: "text/plain", chatId: "chat_unfiled", createdAt: 30 },
    ],
    chats: [
      { _id: "chat_filed", userId: "user_1", folderId: "folder_1" },
      { _id: "chat_unfiled", userId: "user_1", folderId: undefined },
    ],
    documents: [
      {
        _id: "doc_1",
        sourceStorageId: "storage_doc",
        currentVersionId: "version_1",
        externalSyncedVersionId: "version_external",
        status: "ready",
        syncState: "synced",
      },
      {
        _id: "doc_filed",
        sourceStorageId: "storage_filed",
        currentVersionId: "version_filed",
        folderId: "folder_1",
        status: "ready",
      },
    ],
    documentVersions: [
      { _id: "version_1", extractionStatus: "ready", versionNumber: 2 },
      { _id: "version_external", storageId: "storage_external", versionNumber: 7 },
      { _id: "version_filed", extractionStatus: "ready", versionNumber: 1 },
    ],
  };

  const result = await listKnowledgeBaseFilesHandler({
    auth: buildAuth(),
    db: buildDb(rows),
    storage: { getUrl: async (id: string) => `https://cdn.example/${id}` },
  } as any, { folderFilter: "unfiled", source: "all", limit: 0 });

  assert.deepEqual(result.map((file) => file.storageId), ["storage_doc"]);
  assert.equal(result[0].documentId, "doc_1");
  assert.equal(result[0].documentVersionId, "version_1");
  assert.equal(result[0].documentVersionNumber, 2);
  assert.equal(result[0].documentExternalSyncedVersionId, "version_external");
  assert.equal(result[0].documentExternalSyncedVersionNumber, 7);
  assert.equal(result[0].documentExternalSyncedDownloadUrl, "https://cdn.example/storage_external");
  assert.equal(result[0].isReadableDocument, true);
  assert.equal(result[0].downloadUrl, "https://cdn.example/storage_doc");
});

test("storage-id KB lookup preserves request order, dedupes, and ignores foreign or missing rows", async () => {
  const rows: Record<string, any[]> = {
    generatedFiles: [
      { _id: "gf_1", userId: "user_1", storageId: "storage_generated", filename: "analysis.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", toolName: "generate_xlsx", chatId: "chat_1", messageId: "msg_1", createdAt: 30 },
      { _id: "gf_foreign", userId: "user_2", storageId: "storage_foreign", filename: "private.pdf", mimeType: "application/pdf", createdAt: 50 },
    ],
    generatedMedia: [
      { _id: "gm_1", userId: "user_1", storageId: "storage_video", type: "video", mimeType: "video/mp4", createdAt: 20 },
    ],
    fileAttachments: [
      { _id: "fa_1", userId: "user_1", storageId: "storage_upload", filename: undefined, mimeType: "text/plain", createdAt: 10 },
    ],
  };

  const result = await getKnowledgeBaseFilesByStorageIdsHandler({
    auth: buildAuth(),
    db: buildDb(rows),
    storage: { getUrl: async (id: string) => `https://cdn.example/${id}` },
  } as any, {
    storageIds: [
      "storage_upload",
      "storage_generated",
      "storage_generated",
      "storage_foreign",
      "missing",
      "storage_video",
    ] as any,
  });

  assert.deepEqual(result.map((file) => file.storageId), [
    "storage_upload",
    "storage_generated",
    "storage_video",
  ]);
  assert.equal(result[0].filename, "attachment");
  assert.equal(result[1].toolName, "generate_xlsx");
  assert.equal(result[2].filename, "generated-video.mp4");
});

test("KB query auth guards and attachment metadata lookup protect private storage", async () => {
  const rows: Record<string, any[]> = {
    fileAttachments: [
      { _id: "fa_1", userId: "user_1", storageId: "storage_1", filename: "drive.pdf", mimeType: "application/pdf", sizeBytes: 42, driveFileId: "drive_1", lastRefreshedAt: 456 },
    ],
  };

  const unauthenticatedList = await listKnowledgeBaseFilesHandler({
    auth: buildAuth(null),
    db: buildDb(rows),
    storage: { getUrl: async () => "unused" },
  } as any, { source: "all" });
  assert.deepEqual(unauthenticatedList, []);

  const emptyLookup = await getKnowledgeBaseFilesByStorageIdsHandler({
    auth: buildAuth(),
    db: buildDb(rows),
    storage: { getUrl: async () => "unused" },
  } as any, { storageIds: [] as any });
  assert.deepEqual(emptyLookup, []);

  const metadata = await (getFileAttachmentInternal as any)._handler({
    db: buildDb(rows),
  }, { fileAttachmentId: "fa_1" });
  assert.deepEqual(metadata, {
    _id: "fa_1",
    userId: "user_1",
    storageId: "storage_1",
    filename: "drive.pdf",
    mimeType: "application/pdf",
    sizeBytes: 42,
    driveFileId: "drive_1",
    lastRefreshedAt: 456,
  });

  const missing = await (getFileAttachmentInternal as any)._handler({
    db: buildDb(rows),
  }, { fileAttachmentId: "missing" });
  assert.equal(missing, null);
});

test("KB lookup guards unauthenticated storage requests and resolves attachment by storage id", async () => {
  const rows: Record<string, any[]> = {
    fileAttachments: [
      { _id: "fa_1", userId: "user_1", storageId: "storage_1", driveFileId: "drive_1" },
    ],
  };

  const unauthenticated = await getKnowledgeBaseFilesByStorageIdsHandler({
    auth: buildAuth(null),
    db: buildDb(rows),
    storage: { getUrl: async () => "unused" },
  } as any, { storageIds: ["storage_1"] as any });
  assert.deepEqual(unauthenticated, []);

  const attachment = await (getFileAttachmentByStorageInternal as any)._handler({
    db: buildDb(rows),
  }, { storageId: "storage_1" });
  assert.deepEqual(attachment, { _id: "fa_1", driveFileId: "drive_1" });

  const missing = await (getFileAttachmentByStorageInternal as any)._handler({
    db: buildDb(rows),
  }, { storageId: "missing" });
  assert.equal(missing, null);
});
