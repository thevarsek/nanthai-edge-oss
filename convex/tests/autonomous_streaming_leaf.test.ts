import assert from "node:assert/strict";
import test from "node:test";

import { createAutonomousMessageHandler } from "../autonomous/mutations_helpers";

test("createAutonomousMessageHandler sets active leaf immediately for streaming visibility", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const ctx = {
    db: {
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        if (table === "messages") return "message_autonomous_1";
        return `${table}_id`;
      },
      get: async (id: string) => {
        if (id === "chat_1") {
          return { _id: "chat_1", messageCount: 7 };
        }
        return null;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
  } as any;

  const messageId = await createAutonomousMessageHandler(ctx, {
    chatId: "chat_1" as any,
    userId: "user_1",
    modelId: "openai/gpt-5.2",
    participantId: "participant_1",
    participantName: "Agent 1",
    parentMessageIds: ["parent_1" as any],
  });

  assert.equal(messageId, "message_autonomous_1");

  const messageInsert = inserts.find((entry) => entry.table === "messages");
  assert.ok(messageInsert);
  assert.equal(messageInsert.value.status, "pending");
  assert.equal(messageInsert.value.participantId, undefined);
  assert.equal(messageInsert.value.autonomousParticipantId, "participant_1");
  assert.deepEqual(messageInsert.value.parentMessageIds, ["parent_1"]);

  const chatPatch = patches.find((entry) => entry.id === "chat_1");
  assert.ok(chatPatch);
  assert.equal(chatPatch.patch.activeBranchLeafId, "message_autonomous_1");
  assert.equal(chatPatch.patch.messageCount, 8);
  assert.equal(typeof chatPatch.patch.updatedAt, "number");
});
