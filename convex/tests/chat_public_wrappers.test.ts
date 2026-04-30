import assert from "node:assert/strict";
import test from "node:test";

import { createUploadUrl, createChat } from "../chat/mutations";
import { deleteKnowledgeBaseFile, updateDriveAttachmentStorage } from "../knowledge_base/mutations";
import { ensureDocumentsForChat, makeCurrentVersion } from "../documents/mutations";
import { getDocumentVersionDownloadUrl } from "../documents/queries";
import {
  listKnowledgeBaseFiles,
  getKnowledgeBaseFilesByStorageIds,
} from "../knowledge_base/queries";
import { updateChat } from "../chat/manage";
import { deleteChatGraph } from "../chat/manage_delete_helpers";
import {
  getActiveJobs,
  getAttachmentUrl,
  getGenerationStatus,
  getGeneratedFilesByMessage,
  getMessageAudioUrl,
} from "../chat/queries";
import { appendAttachmentsAndMarkResuming } from "../drive_picker/mutations";
import { deleteUserTableBatch } from "../account/mutations";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("createChat inserts up to three normalized participants and createUploadUrl proxies storage", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

  const chatId = await (createChat as any)._handler({
    auth: buildAuth(),
    db: {
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return table === "chats" ? "chat_1" : `participant_${inserts.length}`;
      },
    },
  }, {
    title: "New Chat",
    mode: "chat",
    participants: [
      { modelId: "openai/gpt-5.2" },
      { modelId: "openai/gpt-4o" },
      { modelId: "anthropic/claude-sonnet-4.5" },
      { modelId: "google/gemini-2.5-pro" },
    ],
  });

  const uploadUrl = await (createUploadUrl as any)._handler({
    auth: buildAuth(),
    storage: {
      generateUploadUrl: async () => "https://upload.example/url",
    },
  });

  assert.equal(chatId, "chat_1");
  assert.equal(inserts.filter((entry) => entry.table === "chatParticipants").length, 3);
  assert.equal(uploadUrl, "https://upload.example/url");
});

test("updateChat folder-only move preserves ordering semantics by skipping updatedAt", async () => {
  const patches: Array<Record<string, unknown>> = [];

  await (updateChat as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => {
        if (id === "chat_1") return { _id: "chat_1", userId: "user_1", title: "Chat" };
        if (id === "folder_1") return { _id: "folder_1", userId: "user_1" };
        return null;
      },
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
    },
  }, {
    chatId: "chat_1",
    folderId: "folder_1",
  });

  assert.deepEqual(patches, [{ folderId: "folder_1" }]);
});

test("deleteKnowledgeBaseFile handles generated and uploaded sources", async () => {
  const generatedDeletes: string[] = [];
  const uploadDeletes: string[] = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];

  await (deleteKnowledgeBaseFile as any)._handler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (
            table === "generatedFiles"
              ? { _id: "gf_1", userId: "user_1", messageId: "msg_1", storageId: "storage_g" }
              : null
          ),
          collect: async () => [],
        }),
      }),
      get: async () => ({ _id: "msg_1", generatedFileIds: ["gf_1", "gf_2"] }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      delete: async (id: string) => {
        generatedDeletes.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        generatedDeletes.push(id);
      },
    },
  }, { storageId: "storage_g", source: "generated" });

  await (deleteKnowledgeBaseFile as any)._handler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (
            table === "fileAttachments"
              ? { _id: "fa_1", userId: "user_1", messageId: "msg_2", storageId: "storage_u" }
              : null
          ),
          collect: async () => [],
        }),
      }),
      get: async () => ({
        _id: "msg_2",
        attachments: [
          { storageId: "storage_u", name: "report.txt" },
          { storageId: "storage_other", name: "keep.txt" },
        ],
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      delete: async (id: string) => {
        uploadDeletes.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        uploadDeletes.push(id);
      },
    },
  }, { storageId: "storage_u", source: "upload" });

  assert.deepEqual(patches[0], {
    id: "msg_1",
    value: { generatedFileIds: ["gf_2"] },
  });
  assert.deepEqual(generatedDeletes, ["gf_1", "storage_g"]);
  assert.equal((patches[1]?.value.attachments as Array<any>).length, 1);
  assert.deepEqual(uploadDeletes, ["fa_1", "storage_u"]);
});

test("deleteKnowledgeBaseFile removes Drive grant cache for deleted uploaded attachments", async () => {
  const deletes: string[] = [];

  await (deleteKnowledgeBaseFile as any)._handler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (
            table === "fileAttachments"
              ? { _id: "fa_1", userId: "user_1", messageId: "msg_1", storageId: "storage_drive" }
              : null
          ),
          collect: async () => (
            table === "googleDriveFileGrants"
              ? [{ _id: "grant_1", userId: "user_1", cachedStorageId: "storage_drive" }]
              : []
          ),
        }),
      }),
      get: async () => ({
        _id: "msg_1",
        attachments: [{ storageId: "storage_drive", name: "Tenancy Agreement.pdf" }],
      }),
      patch: async () => undefined,
      delete: async (id: string) => {
        deletes.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        deletes.push(id);
      },
    },
  }, { storageId: "storage_drive", source: "upload" });

  assert.deepEqual(deletes, ["fa_1", "grant_1", "storage_drive"]);
});

test("deleteKnowledgeBaseFile preserves shared cached Drive storage until the last reference is deleted", async () => {
  const deletes: string[] = [];

  await (deleteKnowledgeBaseFile as any)._handler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (
            table === "fileAttachments"
              ? { _id: "fa_1", userId: "user_1", storageId: "storage_shared", driveFileId: "drive_1" }
              : null
          ),
          collect: async () => (
            table === "fileAttachments"
              ? [
                  { _id: "fa_1", userId: "user_1", storageId: "storage_shared", driveFileId: "drive_1" },
                  { _id: "fa_2", userId: "user_1", storageId: "storage_shared", driveFileId: "drive_1" },
                ]
              : [{ _id: "grant_1", userId: "user_1", cachedStorageId: "storage_shared" }]
          ),
        }),
      }),
      get: async () => null,
      patch: async () => undefined,
      delete: async (id: string) => {
        deletes.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        deletes.push(id);
      },
    },
  }, { storageId: "storage_shared", source: "drive" });

  assert.deepEqual(deletes, ["fa_1"]);
});

test("deleteKnowledgeBaseFile uses fileAttachmentId to disambiguate shared storage rows", async () => {
  const deletes: string[] = [];

  await (deleteKnowledgeBaseFile as any)._handler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: (indexName: string) => ({
          first: async () => {
            if (table === "fileAttachments") {
              throw new Error("storage fallback should not be used when fileAttachmentId is provided");
            }
            assert.notEqual(indexName, "by_source_storage");
            return null;
          },
          collect: async () => [],
        }),
      }),
      get: async (id: string) => (
        id === "fa_kb"
          ? { _id: "fa_kb", userId: "user_1", storageId: "storage_shared", driveFileId: "drive_1" }
          : null
      ),
      patch: async () => undefined,
      delete: async (id: string) => {
        deletes.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        deletes.push(id);
      },
    },
  }, { storageId: "storage_shared", fileAttachmentId: "fa_kb", source: "drive" });

  assert.deepEqual(deletes, ["fa_kb", "storage_shared"]);
});

test("deleteKnowledgeBaseFile removes Drive grant cache for deleted generated files", async () => {
  const deletes: string[] = [];

  await (deleteKnowledgeBaseFile as any)._handler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (
            table === "generatedFiles"
              ? { _id: "gf_1", userId: "user_1", messageId: "msg_1", storageId: "storage_generated" }
              : null
          ),
          collect: async () => (
            table === "googleDriveFileGrants"
              ? [{ _id: "grant_2", userId: "user_1", cachedStorageId: "storage_generated" }]
              : []
          ),
        }),
      }),
      get: async () => ({ _id: "msg_1", generatedFileIds: ["gf_1"] }),
      patch: async () => undefined,
      delete: async (id: string) => {
        deletes.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        deletes.push(id);
      },
    },
  }, { storageId: "storage_generated", source: "generated" });

  assert.deepEqual(deletes, ["gf_1", "grant_2", "storage_generated"]);
});

test("deleteUserTableBatch preserves documentVersion source blobs owned by source rows", async () => {
  const storageDeletes: string[] = [];
  const rowDeletes: string[] = [];

  await (deleteUserTableBatch as any)._handler({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () => (
            table === "documentVersions"
              ? [{
                  _id: "version_1",
                  userId: "user_1",
                  storageId: "storage_source",
                  extractionTextStorageId: "storage_text",
                  extractionMarkdownStorageId: "storage_md",
                }]
              : []
          ),
          first: async () => (
            table === "fileAttachments"
              ? { _id: "fa_1", userId: "user_1", storageId: "storage_source" }
              : null
          ),
        }),
      }),
      delete: async (id: string) => {
        rowDeletes.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        storageDeletes.push(id);
      },
    },
  }, { userId: "user_1", tableName: "documentVersions" });

  assert.deepEqual(storageDeletes, ["storage_text", "storage_md"]);
  assert.deepEqual(rowDeletes, ["version_1"]);
});

test("ensureDocumentsForChat reuses an existing storage-backed KB document", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const rows: Record<string, any[]> = {
    chats: [{ _id: "chat_1", userId: "user_1" }],
    fileAttachments: [{
      _id: "fa_chat",
      userId: "user_1",
      chatId: "chat_1",
      storageId: "storage_kb",
      filename: "terms.md",
      mimeType: "text/markdown",
      createdAt: 2,
    }],
    documents: [{
      _id: "doc_kb",
      userId: "user_1",
      title: "terms.md",
      filename: "terms.md",
      mimeType: "text/markdown",
      source: "upload",
      sourceStorageId: "storage_kb",
      fileAttachmentId: "fa_settings",
      currentVersionId: "version_kb",
      status: "ready",
      createdAt: 1,
      updatedAt: 1,
    }],
    documentVersions: [{
      _id: "version_kb",
      documentId: "doc_kb",
      userId: "user_1",
      storageId: "storage_kb",
      filename: "terms.md",
      mimeType: "text/markdown",
      versionNumber: 1,
      extractionStatus: "ready",
      extractionTextStorageId: "storage_text",
      createdAt: 1,
    }],
  };

  const result = await (ensureDocumentsForChat as any)._handler({
    db: {
      get: async (id: string) =>
        Object.values(rows).flat().find((row) => row._id === id) ?? null,
      query: (table: string) => ({
        withIndex: (indexName: string, _builder: unknown) => ({
          collect: async () => {
            if (table === "fileAttachments" && indexName === "by_chat") {
              return rows.fileAttachments.filter((row) => row.chatId === "chat_1");
            }
            if (table === "generatedFiles" && indexName === "by_chat") return [];
            return rows[table] ?? [];
          },
          first: async () => {
            if (table === "documents" && indexName === "by_file_attachment") return null;
            if (table === "documents" && indexName === "by_source_storage") {
              return rows.documents.find((row) => row.sourceStorageId === "storage_kb") ?? null;
            }
            return null;
          },
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        const id = `${table}_new`;
        rows[table] = rows[table] ?? [];
        rows[table].push({ _id: id, ...value });
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  }, { userId: "user_1", chatId: "chat_1" });

  assert.equal(result.length, 1);
  assert.equal(result[0].documentId, "doc_kb");
  assert.equal(result[0].versionId, "version_kb");
  assert.deepEqual(inserts, []);
  assert.deepEqual(patches, []);
});

test("ensureDocumentsForChat does not reuse a document from a different origin chat", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const rows: Record<string, any[]> = {
    chats: [{ _id: "chat_2", userId: "user_1" }],
    fileAttachments: [{
      _id: "fa_chat_2",
      userId: "user_1",
      chatId: "chat_2",
      storageId: "storage_shared",
      filename: "brief.md",
      mimeType: "text/markdown",
      createdAt: 2,
    }],
    documents: [{
      _id: "doc_chat_1",
      userId: "user_1",
      title: "brief.md",
      filename: "brief.md",
      mimeType: "text/markdown",
      source: "upload",
      sourceStorageId: "storage_shared",
      fileAttachmentId: "fa_chat_1",
      originChatId: "chat_1",
      currentVersionId: "version_chat_1",
      status: "ready",
      createdAt: 1,
      updatedAt: 1,
    }],
    documentVersions: [{
      _id: "version_chat_1",
      documentId: "doc_chat_1",
      userId: "user_1",
      storageId: "storage_shared",
      filename: "brief.md",
      mimeType: "text/markdown",
      versionNumber: 1,
      extractionStatus: "ready",
      createdAt: 1,
    }],
  };

  const result = await (ensureDocumentsForChat as any)._handler({
    db: {
      get: async (id: string) =>
        Object.values(rows).flat().find((row) => row._id === id) ?? null,
      query: (table: string) => ({
        withIndex: (indexName: string, _builder: unknown) => ({
          collect: async () => {
            if (table === "fileAttachments" && indexName === "by_chat") {
              return rows.fileAttachments.filter((row) => row.chatId === "chat_2");
            }
            if (table === "generatedFiles" && indexName === "by_chat") return [];
            return rows[table] ?? [];
          },
          first: async () => {
            if (table === "documents" && indexName === "by_file_attachment") return null;
            if (table === "documents" && indexName === "by_source_storage") {
              return rows.documents.find((row) => row.sourceStorageId === "storage_shared") ?? null;
            }
            return null;
          },
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        const id = `${table}_new`;
        rows[table] = rows[table] ?? [];
        rows[table].push({ _id: id, ...value });
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        const row = Object.values(rows).flat().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, value);
      },
    },
  }, { userId: "user_1", chatId: "chat_2" });

  assert.equal(result.length, 1);
  assert.equal(result[0].documentId, "documents_new");
  assert.equal(result[0].versionId, "documentVersions_new");
  assert.equal(inserts[0].table, "documents");
  assert.equal(inserts[0].value.originChatId, "chat_2");
});

test("deleteChatGraph removes canonical document versions before source rows", async () => {
  const storageDeletes: string[] = [];
  const rowDeletes: string[] = [];
  const rows: Record<string, any[]> = {
    messages: [],
    generationJobs: [],
    autonomousSessions: [],
    searchSessions: [],
    searchContexts: [],
    documents: [{ _id: "doc_1", originChatId: "chat_1", userId: "user_1" }],
    documentVersions: [{
      _id: "version_1",
      documentId: "doc_1",
      storageId: "storage_source",
      extractionTextStorageId: "storage_text",
      extractionMarkdownStorageId: "storage_md",
    }],
    generatedFiles: [{ _id: "gf_1", chatId: "chat_1", userId: "user_1", storageId: "storage_generated" }],
    generatedCharts: [],
    fileAttachments: [{ _id: "fa_1", chatId: "chat_1", userId: "user_1", storageId: "storage_source" }],
    subagentBatches: [],
  };

  await deleteChatGraph({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () => rows[table] ?? [],
          collect: async () => rows[table] ?? [],
        }),
      }),
      delete: async (id: string) => {
        rowDeletes.push(id);
        for (const tableRows of Object.values(rows)) {
          const index = tableRows.findIndex((row) => row._id === id);
          if (index >= 0) tableRows.splice(index, 1);
        }
      },
    },
    storage: {
      delete: async (id: string) => {
        storageDeletes.push(id);
      },
    },
    scheduler: {
      runAfter: async () => undefined,
    },
  } as any, "chat_1" as any);

  assert.deepEqual(rowDeletes, ["version_1", "doc_1", "gf_1", "fa_1", "chat_1"]);
  assert.deepEqual(storageDeletes, ["storage_text", "storage_md", "storage_generated", "storage_source"]);
});

test("Drive refresh creates an immutable document version and advances imported documents", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const rows: Record<string, any[]> = {
    fileAttachments: [{
      _id: "fa_drive",
      userId: "user_1",
      storageId: "storage_old",
      filename: "contract.pdf",
      mimeType: "application/pdf",
    }],
    documents: [{
      _id: "doc_drive",
      userId: "user_1",
      title: "contract.pdf",
      filename: "contract.pdf",
      mimeType: "application/pdf",
      source: "drive",
      sourceStorageId: "storage_old",
      fileAttachmentId: "fa_drive",
      currentVersionId: "version_old",
      externalSyncedVersionId: "version_old",
      status: "ready",
      syncState: "current",
      createdAt: 1,
      updatedAt: 1,
    }],
    documentVersions: [{
      _id: "version_old",
      documentId: "doc_drive",
      userId: "user_1",
      storageId: "storage_old",
      filename: "contract.pdf",
      mimeType: "application/pdf",
      versionNumber: 1,
      source: "drive_import",
      extractionStatus: "ready",
      createdAt: 1,
    }],
    scheduledJobs: [],
  };

  await (updateDriveAttachmentStorage as any)._handler({
    db: {
      get: async (id: string) => Object.values(rows).flat().find((row) => row._id === id) ?? null,
      query: (table: string) => ({
        withIndex: (_indexName: string, _builder: unknown) => ({
          first: async () => {
            if (table === "documents") {
              return rows.documents.find((row) => row.fileAttachmentId === "fa_drive") ?? null;
            }
            return rows[table]?.[0] ?? null;
          },
          collect: async () => rows[table] ?? [],
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        const id = `${table}_new`;
        rows[table] = rows[table] ?? [];
        rows[table].push({ _id: id, ...value });
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
        const row = Object.values(rows).flat().find((candidate) => candidate._id === id);
        if (row) Object.assign(row, value);
      },
    },
  }, {
    fileAttachmentId: "fa_drive",
    storageId: "storage_new",
    filename: "contract.pdf",
    mimeType: "application/pdf",
    externalModifiedTime: "2026-04-30T00:00:00.000Z",
    lastRefreshedAt: 123,
  });

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "documentVersions");
  assert.equal(inserts[0].value.source, "drive_refresh");
  assert.equal(inserts[0].value.parentVersionId, "version_old");
  const documentPatch = patches.find((patch) => patch.id === "doc_drive")?.value;
  assert.equal(documentPatch?.currentVersionId, "documentVersions_new");
  assert.equal(documentPatch?.externalSyncedVersionId, "documentVersions_new");
  assert.equal(documentPatch?.syncState, "updated_from_drive");
});

test("makeCurrentVersion switches to an owned Drive refresh version", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const rows: Record<string, any[]> = {
    documents: [{
      _id: "doc_1",
      userId: "user_1",
      filename: "contract.pdf",
      mimeType: "application/pdf",
      currentVersionId: "version_local",
      externalSyncedVersionId: "version_drive",
      syncState: "external_update_available",
    }],
    documentVersions: [{
      _id: "version_drive",
      documentId: "doc_1",
      userId: "user_1",
      storageId: "storage_drive",
      filename: "contract.pdf",
      mimeType: "application/pdf",
      source: "drive_refresh",
      externalModifiedTime: "2026-04-30T00:00:00.000Z",
    }],
  };

  await (makeCurrentVersion as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => Object.values(rows).flat().find((row) => row._id === id) ?? null,
      patch: async (id: string, value: Record<string, unknown>) => patches.push({ id, value }),
    },
  }, { documentId: "doc_1", versionId: "version_drive" });

  assert.equal(patches.length, 1);
  assert.equal(patches[0].id, "doc_1");
  assert.equal(patches[0].value.currentVersionId, "version_drive");
  assert.equal(patches[0].value.sourceStorageId, "storage_drive");
  assert.equal(patches[0].value.syncState, "updated_from_drive");
});

test("makeCurrentVersion rejects versions from another document", async () => {
  await assert.rejects(
    () => (makeCurrentVersion as any)._handler({
      auth: buildAuth(),
      db: {
        get: async (id: string) => {
          if (id === "doc_1") return { _id: "doc_1", userId: "user_1" };
          if (id === "version_other") {
            return { _id: "version_other", documentId: "doc_2", userId: "user_1" };
          }
          return null;
        },
      },
    }, { documentId: "doc_1", versionId: "version_other" }),
    /Document version not found or unauthorized/,
  );
});

test("getDocumentVersionDownloadUrl returns URL only for owned versions", async () => {
  const result = await (getDocumentVersionDownloadUrl as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => {
        if (id === "version_1") {
          return {
            _id: "version_1",
            documentId: "doc_1",
            userId: "user_1",
            storageId: "storage_1",
            filename: "contract.pdf",
            mimeType: "application/pdf",
          };
        }
        if (id === "doc_1") return { _id: "doc_1", userId: "user_1" };
        return null;
      },
    },
    storage: {
      getUrl: async (storageId: string) => `https://files.example/${storageId}`,
    },
  }, { versionId: "version_1" });

  assert.deepEqual(result, {
    versionId: "version_1",
    documentId: "doc_1",
    filename: "contract.pdf",
    mimeType: "application/pdf",
    downloadUrl: "https://files.example/storage_1",
  });
});

test("generation, attachment, audio, and generated-file queries are auth-gated and refresh URLs", async () => {
  const db = {
    get: async (id: string) => {
      if (id === "job_1") return { _id: "job_1", chatId: "chat_1", status: "streaming", error: "none", startedAt: 1, completedAt: 2 };
      if (id === "chat_1") return { _id: "chat_1", userId: "user_1" };
      if (id === "msg_1") {
        return {
          _id: "msg_1",
          chatId: "chat_1",
          audioStorageId: "audio_1",
          attachments: [{ storageId: "storage_1", url: "stale" }],
        };
      }
      return null;
    },
    query: (table: string) => ({
      withIndex: () => ({
        collect: async () => {
          if (table === "generationJobs") return [{ _id: "job_q" }, { _id: "job_s" }];
          if (table === "generatedFiles") {
            return [{ _id: "gf_1", _creationTime: 1, userId: "user_1", chatId: "chat_1", messageId: "msg_1", storageId: "storage_1", filename: "chart.csv", mimeType: "text/csv", toolName: "generate_xlsx", createdAt: 10 }];
          }
          return [];
        },
      }),
    }),
  };

  const status = await (getGenerationStatus as any)._handler({ auth: buildAuth(), db }, { jobId: "job_1" });
  const activeJobs = await (getActiveJobs as any)._handler({ auth: buildAuth(), db }, { chatId: "chat_1" });
  const attachmentUrl = await (getAttachmentUrl as any)._handler({
    auth: buildAuth(),
    db,
    storage: { getUrl: async (id: string) => `https://cdn.example/${id}` },
  }, { messageId: "msg_1", storageId: "storage_1" });
  const audioUrl = await (getMessageAudioUrl as any)._handler({
    auth: buildAuth(),
    db,
    storage: { getUrl: async (id: string) => `https://cdn.example/${id}` },
  }, { messageId: "msg_1" });
  const generatedFiles = await (getGeneratedFilesByMessage as any)._handler({
    auth: buildAuth(),
    db,
    storage: { getUrl: async (id: string) => `https://cdn.example/${id}` },
  }, { messageId: "msg_1" });

  assert.deepEqual(status, { status: "streaming", error: "none", startedAt: 1, completedAt: 2 });
  assert.equal(activeJobs.length, 4);
  assert.equal(attachmentUrl, "https://cdn.example/storage_1");
  assert.equal(audioUrl, "https://cdn.example/audio_1");
  assert.equal(generatedFiles[0]?.downloadUrl, "https://cdn.example/storage_1");
});

test("Drive Picker resume appends picked files and persists Drive-backed file attachments", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const docs: Record<string, any> = {
    batch_1: {
      _id: "batch_1",
      userId: "user_1",
      chatId: "chat_1",
      sourceUserMessageId: "msg_user",
      parentMessageId: "msg_assistant",
      parentJobId: "job_1",
      status: "awaiting_pick",
      participantSnapshot: { participant: { modelId: "openai/gpt-4o" } },
      paramsSnapshot: { enabledIntegrations: ["drive"], requestParams: {} },
    },
    msg_user: {
      _id: "msg_user",
      userId: "user_1",
      attachments: [{ storageId: "storage_existing", name: "existing.txt" }],
    },
    msg_assistant: { _id: "msg_assistant" },
    job_1: { _id: "job_1" },
  };

  const result = await (appendAttachmentsAndMarkResuming as any)._handler({
    db: {
      get: async (id: string) => docs[id],
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
        docs[id] = { ...docs[id], ...value };
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}_1`;
        inserts.push({ table, value });
        docs[id] = { _id: id, ...value };
        return id;
      },
    },
  }, {
    batchId: "batch_1",
    userId: "user_1",
    pickedFileIds: ["drive_file_1"],
    attachments: [
      {
        type: "file",
        url: "https://cdn.example/drive_file_1",
        storageId: "storage_drive_1",
        name: "Plan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 123.0,
        driveFileId: "drive_file_1",
      },
    ],
  });

  const fileAttachmentInsert = inserts.find((entry) => entry.table === "fileAttachments");
  const streamingInsert = inserts.find((entry) => entry.table === "streamingMessages");
  const sourcePatch = patches.find((entry) => entry.id === "msg_user");
  const batchPatch = patches.find((entry) => entry.id === "batch_1" && entry.value.status === "resuming");

  assert.equal(result.chatId, "chat_1");
  assert.equal(result.participant.streamingMessageId, streamingInsert ? "streamingMessages_1" : undefined);
  assert.equal((sourcePatch?.value.attachments as Array<any>).length, 2);
  assert.equal(fileAttachmentInsert?.value.driveFileId, "drive_file_1");
  assert.equal(fileAttachmentInsert?.value.storageId, "storage_drive_1");
  assert.equal(fileAttachmentInsert?.value.chatId, "chat_1");
  assert.equal(fileAttachmentInsert?.value.messageId, "msg_user");
  assert.equal(batchPatch?.value.pickedFileIds instanceof Array, true);
});

test("knowledge base queries dedupe by storageId and filter requested storage IDs", async () => {
  const ctx = {
    auth: buildAuth(),
    db: {
      query: (table: string) => {
        const rows = table === "generatedFiles"
          ? [
              { userId: "user_123", storageId: "storage_shared", filename: "summary.md", mimeType: "text/markdown", toolName: "generate_text_file", chatId: "chat_1", messageId: "msg_1", createdAt: 20 },
            ]
          : table === "generatedMedia"
            ? []
            : [
                { userId: "user_1", storageId: "storage_shared", filename: "summary.md", mimeType: "text/markdown", chatId: "chat_1", messageId: "msg_1", createdAt: 15 },
                { userId: "user_1", storageId: "storage_upload", filename: "notes.txt", mimeType: "text/plain", chatId: "chat_1", messageId: "msg_2", createdAt: 10 },
              ];
        return {
          withIndex: (_index: string, build: any) => {
            let storageId: string | undefined;
            build({
              eq: (field: string, value: string) => {
                if (field === "storageId") storageId = value;
                return {};
              },
            });
            const filteredRows = storageId
              ? rows.filter((row) => row.storageId === storageId)
              : rows;
            return {
              first: async () => filteredRows[0] ?? null,
              order: () => ({
                take: async () => filteredRows,
              }),
            };
          },
        };
      },
    },
    storage: {
      getUrl: async (id: string) => `https://cdn.example/${id}`,
    },
  };

  const allFiles = await (listKnowledgeBaseFiles as any)._handler(ctx, { source: "all", limit: 10 });
  const filtered = await (getKnowledgeBaseFilesByStorageIds as any)._handler(ctx, {
    storageIds: ["storage_upload"],
  });

  assert.deepEqual(allFiles.map((file: any) => file.storageId), ["storage_shared", "storage_upload"]);
  assert.deepEqual(filtered.map((file: any) => file.storageId), ["storage_upload"]);
});
