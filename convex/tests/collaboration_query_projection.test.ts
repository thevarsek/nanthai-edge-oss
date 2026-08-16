import assert from "node:assert/strict";
import test from "node:test";

import { getChatState } from "../collaboration/queries";

test("collaboration state projects only rendered activity without reading decisions or message bodies", async () => {
  let chatReads = 0;
  const ctx = {
    auth: { getUserIdentity: async () => ({ subject: "user_1" }) },
    db: {
      get: async (id: string) => {
        assert.equal(id, "chat_1");
        chatReads += 1;
        return {
          _id: "chat_1",
          userId: "user_1",
          groupBehavior: "collaboration",
        };
      },
      query: (table: string) => {
        assert.equal(table, "collaborationExchanges");
        return {
          withIndex: () => ({
            order: () => ({
              take: async () => [{
                _id: "exchange_1",
                status: "waiting",
                currentWave: 2,
                bounds: { maxWaves: 5 },
                participantSnapshot: [{
                  participantId: "participant_1",
                  displayName: "Architect",
                }],
                activeParticipantIds: ["participant_1"],
                pendingHumanMessageIds: ["message_queued"],
              }],
            }),
          }),
        };
      },
    },
  };
  const handler = (getChatState as unknown as {
    _handler: (
      context: unknown,
      args: { chatId: string },
    ) => Promise<Record<string, unknown>>;
  })._handler;

  const result = await handler(ctx, { chatId: "chat_1" });

  assert.equal(chatReads, 1);
  assert.equal(result.behavior, "collaboration");
  assert.deepEqual(result.exchange, {
    id: "exchange_1",
    status: "waiting",
    currentWave: 2,
    maxWaves: 5,
    activeSpeakers: [{ displayName: "Architect" }],
    pendingInputCount: 1,
    terminalReason: undefined,
    error: undefined,
    completedAt: undefined,
  });
  assert.equal("waves" in result, false);
});
