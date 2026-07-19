import assert from "node:assert/strict";
import test from "node:test";
import { recoverTurn, settle } from "../autonomous/turn_checkpoint";
import { createAutonomousMessageHandler } from "../autonomous/mutations_helpers";

function checkpointContext(seed: Array<Record<string, unknown>>) {
  const docs = new Map(seed.map((doc) => [String(doc._id), { ...doc }]));
  const deleted: string[] = [];
  let insertCount = 0;
  return {
    docs,
    deleted,
    get insertCount() { return insertCount; },
    db: {
      get: async (id: string) => docs.get(id) ?? null,
      patch: async (id: string, value: Record<string, unknown>) => {
        const current = docs.get(id);
        if (current) docs.set(id, { ...current, ...value });
      },
      delete: async (id: string) => {
        deleted.push(id);
        docs.delete(id);
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        insertCount += 1;
        const id = `${table}_${insertCount}`;
        docs.set(id, { _id: id, ...value });
        return id;
      },
    },
  };
}

test("autonomous turn replay returns the persisted settled outcome", async () => {
  const ctx = checkpointContext([{
    _id: "session_1",
    status: "running",
    executionEpoch: 4,
    lastSettledTurnCycle: 2,
    lastSettledTurnParticipantIndex: 1,
    lastSettledTurnExecutionEpoch: 4,
    lastSettledTurnOutcome: "completed",
  }]);
  const outcome = await (recoverTurn as any)._handler(ctx, {
    sessionId: "session_1",
    cycle: 2,
    participantIndex: 1,
    executionEpoch: 4,
  });
  assert.equal(outcome, "completed");
});

test("autonomous replay adopts a completed active message as the checkpoint", async () => {
  const ctx = checkpointContext([
    {
      _id: "session_1",
      status: "running",
      executionEpoch: 4,
      activeTurnCycle: 2,
      activeTurnParticipantIndex: 1,
      activeTurnExecutionEpoch: 4,
      activeTurnMessageId: "message_1",
      activeTurnJobId: "job_1",
      parentMessageIds: ["message_old"],
    },
    {
      _id: "message_1",
      chatId: "chat_1",
      status: "completed",
      parentMessageIds: ["message_old"],
    },
    { _id: "job_1", status: "completed" },
    { _id: "chat_1", messageCount: 3, activeBranchLeafId: "message_1" },
  ]);
  const outcome = await (recoverTurn as any)._handler(ctx, {
    sessionId: "session_1",
    cycle: 2,
    participantIndex: 1,
    executionEpoch: 4,
  });
  assert.equal(outcome, "completed");
  const session = ctx.docs.get("session_1");
  assert.deepEqual(session?.parentMessageIds, ["message_1"]);
  assert.equal(session?.lastSettledTurnOutcome, "completed");
  assert.equal(session?.activeTurnMessageId, undefined);
});

test("autonomous replay removes an interrupted turn before starting its replacement", async () => {
  const ctx = checkpointContext([
    {
      _id: "session_1",
      status: "running",
      executionEpoch: 4,
      activeTurnCycle: 2,
      activeTurnParticipantIndex: 0,
      activeTurnExecutionEpoch: 4,
      activeTurnMessageId: "message_stale",
      activeTurnJobId: "job_stale",
    },
    {
      _id: "message_stale",
      chatId: "chat_1",
      status: "streaming",
      parentMessageIds: ["message_old"],
    },
    { _id: "job_stale", status: "streaming" },
    { _id: "chat_1", messageCount: 3, activeBranchLeafId: "message_stale" },
  ]);
  const outcome = await (recoverTurn as any)._handler(ctx, {
    sessionId: "session_1",
    cycle: 2,
    participantIndex: 1,
    executionEpoch: 4,
  });
  assert.equal(outcome, "execute");
  assert.deepEqual(ctx.deleted.sort(), ["job_stale", "message_stale"]);
  const session = ctx.docs.get("session_1");
  assert.equal(session?.activeTurnCycle, 2);
  assert.equal(session?.activeTurnParticipantIndex, 1);
});

test("stale autonomous attempts cannot insert a message after ownership advances", async () => {
  const ctx = checkpointContext([{
    _id: "session_1",
    status: "running",
    executionEpoch: 4,
    activeTurnCycle: 2,
    activeTurnParticipantIndex: 1,
    activeTurnExecutionEpoch: 4,
  }]);
  const result = await createAutonomousMessageHandler(ctx as any, {
    sessionId: "session_1" as any,
    executionEpoch: 4,
    turnCycle: 2,
    turnParticipantIndex: 0,
    chatId: "chat_1" as any,
    userId: "user_1",
    modelId: "openai/gpt-5",
    participantId: "alpha",
    participantName: "Alpha",
    parentMessageIds: [],
  });
  assert.equal(result, null);
  assert.equal(ctx.insertCount, 0);
});

test("a lost finalize result settles from canonical completed message state", async () => {
  const ctx = checkpointContext([
    {
      _id: "session_1",
      status: "running",
      executionEpoch: 4,
      activeTurnCycle: 2,
      activeTurnParticipantIndex: 1,
      activeTurnExecutionEpoch: 4,
      activeTurnMessageId: "message_1",
      parentMessageIds: ["message_old"],
    },
    {
      _id: "message_1",
      chatId: "chat_1",
      status: "completed",
      parentMessageIds: ["message_old"],
    },
    { _id: "chat_1", messageCount: 2, activeBranchLeafId: "message_old" },
  ]);
  await (settle as any)._handler(ctx, {
    sessionId: "session_1",
    cycle: 2,
    participantIndex: 1,
    executionEpoch: 4,
    outcome: "failed",
  });
  const session = ctx.docs.get("session_1");
  assert.equal(session?.lastSettledTurnOutcome, "completed");
  assert.deepEqual(session?.parentMessageIds, ["message_1"]);
});
