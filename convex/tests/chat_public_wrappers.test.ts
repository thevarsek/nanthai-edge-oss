import assert from "node:assert/strict";
import test from "node:test";

import { createUploadUrl, createChat, deleteKnowledgeBaseFile } from "../chat/mutations";
import { updateChat } from "../chat/manage";
import {
  getActiveJobs,
  getAttachmentUrl,
  getGenerationStatus,
  getGeneratedFilesByMessage,
  getKnowledgeBaseFilesByStorageIds,
  getMessageAudioUrl,
  listKnowledgeBaseFiles,
} from "../chat/queries";

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

test("knowledge base queries dedupe by storageId and filter requested storage IDs", async () => {
  const ctx = {
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          order: () => ({
            take: async () => (
              table === "generatedFiles"
                ? [
                    { storageId: "storage_shared", filename: "summary.md", mimeType: "text/markdown", toolName: "generate_text_file", chatId: "chat_1", messageId: "msg_1", createdAt: 20 },
                  ]
                : [
                    { storageId: "storage_shared", filename: "summary.md", mimeType: "text/markdown", chatId: "chat_1", messageId: "msg_1", createdAt: 15 },
                    { storageId: "storage_upload", filename: "notes.txt", mimeType: "text/plain", chatId: "chat_1", messageId: "msg_2", createdAt: 10 },
                  ]
            ),
          }),
        }),
      }),
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
