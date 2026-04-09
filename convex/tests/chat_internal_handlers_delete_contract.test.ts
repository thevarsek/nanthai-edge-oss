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
    hasAudioInput: true,
    hasAudioOutput: true,
    hasVideoInput: true,
    hasImageGeneration: true,
    hasReasoning: true,
    contextLength: 128000,
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
          collect: async () => [
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
      collect: async () => [{ _id: "message_1", audioStorageId: "audio_1" }],
    }),
  });

  await safeDeleteAudioBlob(ctx, "audio_1" as any, "message_1" as any);
  assert.deepEqual(deleted, ["audio_1"]);
});

test("deleteChatGraph schedules a continuation when a batch fills up", async () => {
  const deleted: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const fullBatch = Array.from({ length: 200 }, (_, index) => ({
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

  assert.equal(deleted.length, 200);
  assert.deepEqual(scheduled, [{ chatId: "chat_1" }]);
});

test("deleteChatGraph deletes child rows, storage blobs, and the chat on the final pass", async () => {
  const deleted: string[] = [];
  const storageDeleted: string[] = [];

  await deleteChatGraph({
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          take: async () => {
            if (table === "messages") return [{ _id: "message_1", audioStorageId: "audio_1" }];
            if (table === "searchSessions") return [{ _id: "search_1" }];
            if (table === "generatedFiles") return [{ _id: "file_1", storageId: "storage_file" }];
            if (table === "fileAttachments") return [{ _id: "attachment_1", storageId: "storage_attachment" }];
            if (table === "subagentBatches") return [{ _id: "batch_1" }];
            return [];
          },
          collect: async () => {
            if (table === "messages") return [{ _id: "message_1", audioStorageId: "audio_1" }];
            if (table === "searchPhases") return [{ _id: "phase_1" }];
            if (table === "subagentRuns") return [{ _id: "run_1" }];
            return [];
          },
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
      runAfter: async () => {
        throw new Error("should not schedule continuation");
      },
    },
  } as any, "chat_1" as any);

  assert.deepEqual(storageDeleted, ["audio_1", "storage_file", "storage_attachment"]);
  assert.deepEqual(deleted, [
    "message_1",
    "phase_1",
    "search_1",
    "file_1",
    "attachment_1",
    "run_1",
    "batch_1",
    "chat_1",
  ]);
});
