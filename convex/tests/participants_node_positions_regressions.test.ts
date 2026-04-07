import assert from "node:assert/strict";
import test from "node:test";

import { remove, upsert } from "../nodePositions/mutations";
import { setParticipants, updateParticipant } from "../participants/mutations";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("updateParticipant clears nullable persona metadata and clears subagent override on multi-model chats", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  await (updateParticipant as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => {
        if (id === "participant_1") {
          return { _id: "participant_1", userId: "user_1", chatId: "chat_1" };
        }
        if (id === "chat_1") {
          return { _id: "chat_1", subagentOverride: "enabled" };
        }
        return null;
      },
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () =>
            table === "autonomousSessions"
              ? []
              : [{ _id: "participant_1", sortOrder: 0 }, { _id: "participant_2", sortOrder: 1 }],
        }),
      }),
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  }, {
    participantId: "participant_1",
    personaEmoji: null,
    personaAvatarImageUrl: null,
  });

  assert.deepEqual(patches[0], {
    id: "participant_1",
    patch: {
      personaEmoji: undefined,
      personaAvatarImageUrl: undefined,
    },
  });
  assert.equal(patches[1]?.id, "chat_1");
  assert.equal(patches[1]?.patch.subagentOverride, undefined);
});

test("setParticipants replaces the full participant set and normalizes sort order", async () => {
  const deleted: string[] = [];
  const inserts: Array<Record<string, unknown>> = [];
  const chatPatches: Array<Record<string, unknown>> = [];

  await (setParticipants as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) =>
        id === "chat_1" ? { _id: "chat_1", userId: "user_1", subagentOverride: "enabled" } : null,
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => {
            if (table === "autonomousSessions") return [];
            if (table === "chatParticipants") return [{ _id: "old_1" }, { _id: "old_2" }];
            return [];
          },
        }),
      }),
      delete: async (id: string) => {
        deleted.push(id);
      },
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
        return `participant_${inserts.length}`;
      },
      patch: async (_id: string, patch: Record<string, unknown>) => {
        chatPatches.push(patch);
      },
    },
  }, {
    chatId: "chat_1",
    participants: [
      { modelId: "openai/gpt-5.2" },
      { modelId: "anthropic/claude-sonnet-4.5", personaName: "Writer" },
    ],
  });

  assert.deepEqual(deleted, ["old_1", "old_2"]);
  assert.deepEqual(inserts.map((row) => row.sortOrder), [0, 1]);
  assert.equal(inserts[1]?.personaName, "Writer");
  assert.equal(chatPatches[0]?.subagentOverride, undefined);
});

test("node position upsert patches existing rows and remove is idempotent", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deletes: string[] = [];

  const db = {
    get: async (id: string) => {
      if (id === "chat_1") return { _id: "chat_1", userId: "user_1" };
      if (id === "message_1") return { _id: "message_1", chatId: "chat_1" };
      return null;
    },
    query: () => ({
      withIndex: () => ({
        first: async () => ({ _id: "pos_1" }),
      }),
    }),
    patch: async (id: string, patch: Record<string, unknown>) => {
      patches.push({ id, patch });
    },
    insert: async () => "inserted",
    delete: async (id: string) => {
      deletes.push(id);
    },
  };

  const upserted = await (upsert as any)._handler({
    auth: buildAuth(),
    db,
  }, {
    chatId: "chat_1",
    messageId: "message_1",
    x: 10,
    y: 20,
    width: 300,
    height: 200,
  });

  await (remove as any)._handler({
    auth: buildAuth(),
    db,
  }, {
    chatId: "chat_1",
    messageId: "message_1",
  });

  assert.equal(upserted, "pos_1");
  assert.deepEqual(patches[0], {
    id: "pos_1",
    patch: { x: 10, y: 20, width: 300, height: 200 },
  });
  assert.deepEqual(deletes, ["pos_1"]);
});
