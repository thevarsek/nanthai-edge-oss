import assert from "node:assert/strict";
import test from "node:test";

import {
  getModelCapabilitiesHandler,
  getPersonaHandler,
  searchMessagesInternalHandler,
} from "../chat/queries_handlers_internal";
import {
  deleteChatGraph,
  safeDeleteAudioBlob,
} from "../chat/manage_delete_helpers";

test("getModelCapabilitiesHandler derives modality flags from cached model rows", async () => {
  const result = await getModelCapabilitiesHandler({
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => ({
            provider: "openrouter",
            supportedParameters: ["include_reasoning"],
            architecture: { modality: "audio+video->text+audio" },
            supportsImages: true,
            contextLength: 128000,
          }),
        }),
      }),
    },
  } as any, { modelId: "model_1" });

  assert.deepEqual(result, {
    provider: "openrouter",
    supportedParameters: ["include_reasoning"],
    supportedVoices: undefined,
    outputModalities: ["text", "audio"],
    hasImageInput: false,
    hasFileInput: false,
    hasAudioInput: true,
    hasAudioOutput: true,
    hasVideoInput: true,
    hasImageGeneration: true,
    hasVideoGeneration: false,
    hasMusicGeneration: false,
    hasSpeechGeneration: false,
    hasReasoning: true,
    hasZdrEndpoint: false,
    contextLength: 128000,
    imageCapabilities: undefined,
    videoCapabilities: undefined,
    speechCapabilities: undefined,
  });
});

test("getPersonaHandler falls back to user scan and resolves avatar URLs", async () => {
  const result = await getPersonaHandler({
    db: {
      get: async () => {
        throw new Error("invalid id");
      },
      query: () => ({
        withIndex: () => ({
          collect: async () => [{
            _id: "persona_1",
            userId: "user_1",
            name: "Moderator",
            avatarImageStorageId: "storage_1",
          }],
        }),
      }),
    },
    storage: {
      getUrl: async () => "https://files.example/avatar.png",
    },
  } as any, {
    personaId: "persona_1",
    userId: "user_1",
  });

  assert.equal(result?.avatarImageUrl, "https://files.example/avatar.png");
  assert.equal(result?.name, "Moderator");
});

test("searchMessagesInternalHandler filters unauthorized/system rows and truncates snippets", async () => {
  const longContent = "a".repeat(320);
  const chats = new Map([
    ["chat_ok", { _id: "chat_ok", userId: "user_1", title: "Main Chat" }],
    ["chat_other", { _id: "chat_other", userId: "user_2", title: "Other Chat" }],
  ]);

  const results = await searchMessagesInternalHandler({
    db: {
      query: () => ({
        withSearchIndex: () => ({
          take: async () => [
            {
              chatId: "chat_ok",
              content: longContent,
              role: "assistant",
              createdAt: 1_710_000_000_000,
            },
            {
              chatId: "chat_ok",
              content: "internal",
              role: "system",
              createdAt: 1_710_000_000_100,
            },
            {
              chatId: "chat_other",
              content: "visible to someone else",
              role: "user",
              createdAt: 1_710_000_000_200,
            },
          ],
        }),
      }),
      get: async (id: string) => chats.get(id) ?? null,
    },
  } as any, {
    userId: "user_1",
    searchQuery: "architecture",
    limit: 5,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].chatId, "chat_ok");
  assert.equal(results[0].chatTitle, "Main Chat");
  assert.equal(results[0].messageContent.length, 303);
  assert.equal(results[0].messageDate, new Date(1_710_000_000_000).toISOString());
});

test("safeDeleteAudioBlob preserves shared audio blobs and deletes unshared ones", async () => {
  const deleted: string[] = [];
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          take: async () => [
            { _id: "message_1", audioStorageId: "audio_1" },
            { _id: "message_2", audioStorageId: "audio_1" },
          ],
        }),
      }),
    },
    storage: {
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
  } as any;

  await safeDeleteAudioBlob(ctx, "audio_1" as any, "message_1" as any);
  assert.deepEqual(deleted, []);

  ctx.db.query = () => ({
    withIndex: () => ({
      take: async () => [{ _id: "message_1", audioStorageId: "audio_1" }],
    }),
  });

  await safeDeleteAudioBlob(ctx, "audio_1" as any, "message_1" as any);
  assert.deepEqual(deleted, ["audio_1"]);
});

test("deleteChatGraph schedules a continuation when a batch fills up", async () => {
  const deleted: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const fullBatch = Array.from({ length: 5 }, (_, index) => ({
    _id: `message_${index}`,
    chatId: "chat_1",
  }));

  await deleteChatGraph({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () => (table === "messages" ? fullBatch : []),
          collect: async () => [],
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
    storage: { delete: async () => {} },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any, "chat_1" as any);

  assert.equal(deleted.filter((id) => id.startsWith("message_")).length, 5);
  assert.equal(deleted.includes("chat_1"), false);
  assert.deepEqual(scheduled, [{ chatId: "chat_1" }]);
});

test("deleteChatGraph drains subagent children before deleting their batch and chat", async () => {
  const deleted: string[] = [];
  const storageDeleted: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];

  await deleteChatGraph({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () => {
            if (table === "messages") return [{ _id: "message_1", audioStorageId: "audio_1" }];
            if (table === "searchSessions") return [{ _id: "search_1" }];
            if (table === "searchPhases") return [{ _id: "phase_1" }];
            if (table === "generatedFiles") return [{ _id: "file_1", storageId: "storage_file" }];
            if (table === "fileAttachments") return [{ _id: "attachment_1", storageId: "storage_attachment" }];
            if (table === "subagentBatches") return [{ _id: "batch_1" }];
            if (table === "subagentRuns") {
              return [{
                _id: "run_1",
                generatedFiles: [{ storageId: "storage_subagent" }],
              }];
            }
            return [];
          },
          collect: async () => {
            if (table === "messages") return [{ _id: "message_1", audioStorageId: "audio_1" }];
            if (table === "searchPhases") return [{ _id: "phase_1" }];
            if (table === "subagentRuns") return [{ _id: "run_1" }];
            return [];
          },
          first: async () => null,
          unique: async () => null,
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        storageDeleted.push(id);
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  } as any, "chat_1" as any);

  assert.deepEqual(storageDeleted, [
    "audio_1",
    "storage_file",
    "storage_attachment",
    "storage_subagent",
  ]);
  assert.deepEqual(deleted, [
    "message_1",
    "phase_1",
    "search_1",
    "file_1",
    "attachment_1",
    "run_1",
  ]);
  assert.deepEqual(scheduled, [{ chatId: "chat_1" }]);
});

test("deleteChatGraph drains every capped child table before scheduling continuation", async () => {
  const deleted: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const fullBatch = (prefix: string) =>
    Array.from({ length: 200 }, (_, index) => ({
      _id: `${prefix}_${index}`,
      chatId: "chat_1",
    }));

  await deleteChatGraph({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () => {
            switch (table) {
              case "generationJobs":
              case "autonomousSessions":
              case "usageRecords":
              case "chatParticipants":
              case "nodePositions":
              case "searchSessions":
              case "searchContexts":
              case "documents":
              case "generatedFiles":
              case "generatedCharts":
              case "fileAttachments":
              case "subagentBatches":
                return fullBatch(table);
              default:
                return [];
            }
          },
          collect: async () => [],
          first: async () => null,
          unique: async () => null,
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
    storage: { delete: async () => {} },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  } as any, "chat_1" as any);

  assert.equal(deleted.includes("chat_1"), false);
  assert.deepEqual(scheduled, [{ chatId: "chat_1" }]);
  assert.ok(deleted.includes("generationJobs_0"));
  assert.ok(deleted.includes("subagentBatches_199"));
});

test("deleteChatGraph removes document extraction blobs and schedules the document drain", async () => {
  const deleted: string[] = [];
  const storageDeleted: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];

  await deleteChatGraph({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () => {
            if (table === "documents") return [{ _id: "document_1", userId: "user_1" }];
            if (table === "documentVersions") {
              return [{
                _id: "version_1",
                storageId: "storage_version",
                extractionTextStorageId: "storage_text",
                extractionMarkdownStorageId: "storage_markdown",
              }];
            }
            if (table === "fileAttachments") {
              return [{
                _id: "attachment_1",
                userId: "user_1",
                storageId: "storage_drive",
                driveFileId: "drive_1",
              }];
            }
            if (table === "googleDriveFileGrants") return [{ _id: "grant_1" }];
            return [];
          },
          collect: async () => {
            if (table === "fileAttachments") {
              return [{ _id: "attachment_1", userId: "user_1", storageId: "storage_drive" }];
            }
            return [];
          },
          first: async () => null,
          unique: async () => null,
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
    storage: {
      delete: async (id: string) => {
        storageDeleted.push(id);
        if (id === "storage_markdown") {
          throw new Error("already gone");
        }
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  } as any, "chat_1" as any);

  assert.deepEqual(storageDeleted, [
    "storage_text",
    "storage_markdown",
    "storage_version",
    "storage_drive",
  ]);
  assert.ok(deleted.includes("grant_1"));
  assert.ok(deleted.includes("version_1"));
  assert.equal(deleted.includes("document_1"), false);
  assert.ok(deleted.includes("attachment_1"));
  assert.equal(deleted.includes("chat_1"), false);
  assert.deepEqual(scheduled, [{ chatId: "chat_1" }]);
});
