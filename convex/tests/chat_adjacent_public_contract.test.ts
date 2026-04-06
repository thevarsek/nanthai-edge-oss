import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import { addParticipant, removeParticipant } from "../participants/mutations";
import { create, remove, update } from "../personas/mutations";
import { batchUpsert, removeAllForChat } from "../nodePositions/mutations";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("addParticipant rejects edits while autonomous mode is active", async () => {
  await assert.rejects(
    (addParticipant as any)._handler({
      auth: buildAuth(),
      db: {
        get: async (id: string) =>
          id === "chat_1" ? { _id: "chat_1", userId: "user_1" } : null,
        query: (table: string) => ({
          withIndex: () => ({
            collect: async () =>
              table === "autonomousSessions"
                ? [{ _id: "auto_1", status: "running" }]
                : [],
          }),
        }),
      },
    }, {
      chatId: "chat_1",
      modelId: "openai/gpt-5.2",
    }),
    /autonomous mode is active/i,
  );
});

test("removeParticipant re-normalizes remaining sort orders", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  await (removeParticipant as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => {
        if (id === "participant_2") {
          return { _id: "participant_2", userId: "user_1", chatId: "chat_1", sortOrder: 1 };
        }
        if (id === "chat_1") {
          return { _id: "chat_1", subagentOverride: undefined };
        }
        return null;
      },
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => {
            if (table === "autonomousSessions") return [];
            if (table === "chatParticipants") {
              return [
                { _id: "participant_1", chatId: "chat_1", sortOrder: 0 },
                { _id: "participant_2", chatId: "chat_1", sortOrder: 1 },
                { _id: "participant_3", chatId: "chat_1", sortOrder: 2 },
              ];
            }
            return [];
          },
        }),
      }),
      delete: async () => {},
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  }, {
    participantId: "participant_2",
  });

  const participantPatch = patches.find((entry) => entry.id === "participant_3");
  assert.ok(participantPatch);
  assert.equal(participantPatch.patch.sortOrder, 1);
});

test("create persona unsets prior default persona and strips integrations for non-tool models", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];

  await (create as any)._handler({
    auth: buildAuth(),
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          first: async () =>
            table === "cachedModels"
              ? { modelId: "openai/gpt-5.2", supportsTools: false }
              : { userId: "user_1", status: "active" },
          collect: async () =>
            table === "personas"
              ? [{ _id: "persona_old", userId: "user_1", isDefault: true }]
              : [],
        }),
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "persona_new";
      },
    },
  }, {
    displayName: "Writer",
    systemPrompt: "Be helpful.",
    modelId: "openai/gpt-5.2",
    isDefault: true,
    enabledIntegrations: ["gmail"],
  });

  assert.equal(patches[0]?.id, "persona_old");
  assert.equal(inserts[0]?.value.isDefault, true);
  assert.deepEqual(inserts[0]?.value.enabledIntegrations, []);
});

test("update persona deletes replaced avatar storage ids", async () => {
  const deletedStorageIds: string[] = [];

  await (update as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) =>
        id === "persona_1"
          ? {
              _id: "persona_1",
              userId: "user_1",
              modelId: "openai/gpt-5.2",
              avatarImageStorageId: "storage_old",
              enabledIntegrations: [],
            }
          : null,
      query: (table: string) => ({
        withIndex: () => ({
          first: async () =>
            table === "purchaseEntitlements"
              ? { userId: "user_1", status: "active" }
              : { modelId: "openai/gpt-5.2", supportsTools: true },
          collect: async () => [],
        }),
      }),
      patch: async () => {},
    },
    storage: {
      delete: async (storageId: string) => {
        deletedStorageIds.push(storageId);
      },
    },
  }, {
    personaId: "persona_1",
    avatarImageStorageId: "storage_new",
  });

  assert.deepEqual(deletedStorageIds, ["storage_old"]);
});

test("remove persona requires ownership and deletes avatar storage", async () => {
  const deletedStorageIds: string[] = [];

  await (remove as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) =>
        id === "persona_1"
          ? { _id: "persona_1", userId: "user_1", avatarImageStorageId: "storage_1" }
          : null,
      query: () => ({
        withIndex: () => ({
          first: async () => ({ userId: "user_1", status: "active" }),
        }),
      }),
      delete: async () => {},
    },
    storage: {
      delete: async (storageId: string) => {
        deletedStorageIds.push(storageId);
      },
    },
  }, {
    personaId: "persona_1",
  });

  assert.deepEqual(deletedStorageIds, ["storage_1"]);
});

test("batchUpsert rejects message ids that are not in the target chat", async () => {
  await assert.rejects(
    (batchUpsert as any)._handler({
      auth: buildAuth(),
      db: {
        get: async (id: string) => {
          if (id === "chat_1") return { _id: "chat_1", userId: "user_1" };
          if (id === "message_foreign") return { _id: "message_foreign", chatId: "chat_2" };
          return null;
        },
        query: () => ({
          withIndex: () => ({
            collect: async () => [],
          }),
        }),
      },
    }, {
      chatId: "chat_1",
      positions: [
        {
          messageId: "message_foreign",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
        },
      ],
    }),
    /Message not found in chat/,
  );
});

test("removeAllForChat deletes all positions for an owned chat", async () => {
  const deletedIds: string[] = [];

  await (removeAllForChat as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) =>
        id === "chat_1" ? { _id: "chat_1", userId: "user_1" } : null,
      query: () => ({
        withIndex: () => ({
          collect: async () => [
            { _id: "pos_1" },
            { _id: "pos_2" },
          ],
        }),
      }),
      delete: async (id: string) => {
        deletedIds.push(id);
      },
    },
  }, {
    chatId: "chat_1",
  });

  assert.deepEqual(deletedIds, ["pos_1", "pos_2"]);
});
