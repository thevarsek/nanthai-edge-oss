import assert from "node:assert/strict";
import test from "node:test";

import { runCycle } from "../autonomous/actions";
import { pauseSession, resumeSession, startSession, stopSession } from "../autonomous/mutations";
import { continueParentAfterSubagents, continueSubagentRun, runSubagentRun } from "../subagents/actions";
import { getBatchInternal, getBatchView, getRunInternal, listRunsForBatchInternal } from "../subagents/queries";

function buildAuth(userId: string | null = "user_1") {
  return {
    getUserIdentity: async () => (userId ? { subject: userId } : null),
  };
}

test("startSession inserts a running session and schedules runCycle", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  const inserts: Array<Record<string, unknown>> = [];

  const sessionId = await (startSession as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => (id === "chat_1" ? { _id: "chat_1", userId: "user_1" } : null),
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (table === "purchaseEntitlements" ? { _id: "ent_1", status: "active" } : null),
          collect: async () => (table === "autonomousSessions" ? [] : []),
          order: () => ({
            take: async () => [],
          }),
        }),
      }),
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
        return "session_1";
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
        return "sched_1";
      },
    },
  }, {
    chatId: "chat_1",
    turnOrder: ["p1", "p2"],
    maxCycles: 3,
    pauseBetweenTurns: 0,
    autoStopOnConsensus: false,
    participantConfigs: [
      { participantId: "p1", modelId: "openai/gpt-5.2", displayName: "A" },
      { participantId: "p2", modelId: "openai/gpt-4o", displayName: "B" },
    ],
  });

  assert.equal(sessionId, "session_1");
  assert.equal(inserts[0]?.status, "running");
  assert.deepEqual(scheduled[0], {
    sessionId: "session_1",
    cycle: 1,
    startParticipantIndex: 0,
    userId: "user_1",
    participantConfigs: [
      { participantId: "p1", modelId: "openai/gpt-5.2", displayName: "A" },
      { participantId: "p2", modelId: "openai/gpt-4o", displayName: "B" },
    ],
    moderatorConfig: undefined,
    webSearchEnabled: false,
  });
});

test("pauseSession, resumeSession, and stopSession enforce lifecycle transitions", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  await (pauseSession as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "session_1", userId: "user_1", status: "running" }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  }, { sessionId: "session_1" });

  await (resumeSession as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({
        _id: "session_1",
        userId: "user_1",
        status: "paused",
        currentCycle: 0,
        currentParticipantIndex: undefined,
        turnOrder: ["p1", "p2"],
        moderatorParticipantId: undefined,
        maxCycles: 3,
      }),
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "ent_1", status: "active" }),
        }),
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
        return "sched_2";
      },
    },
  }, {
    sessionId: "session_1",
    participantConfigs: [
      { participantId: "p1", modelId: "openai/gpt-5.2", displayName: "A" },
      { participantId: "p2", modelId: "openai/gpt-4o", displayName: "B" },
    ],
  });

  await (stopSession as any)._handler({
    auth: buildAuth(),
    db: {
      get: async () => ({ _id: "session_1", userId: "user_1", status: "paused" }),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
  }, { sessionId: "session_1" });

  assert.equal(patches[0]?.value.status, "paused");
  assert.equal(patches[1]?.value.status, "running");
  assert.equal(patches[2]?.value.status, "stopped");
  assert.equal(scheduled[0]?.cycle, 1);
  assert.equal(scheduled[0]?.startParticipantIndex, 0);
});

test("subagent batch queries are auth-shaped and internal lookups pass through", async () => {
  const runs = [
    { _id: "run_1", batchId: "batch_1", childIndex: 0, title: "A", taskPrompt: "T1", status: "completed", content: "Done", reasoning: "R1", error: undefined, updatedAt: 10 },
  ];

  const batchView = await (getBatchView as any)._handler({
    auth: buildAuth(),
    db: {
      get: async (id: string) => {
        if (id === "message_1") return { _id: "message_1", userId: "user_1", subagentBatchId: "batch_1" };
        if (id === "batch_1") return { _id: "batch_1", userId: "user_1", parentMessageId: "message_1", status: "completed", childCount: 1, completedChildCount: 1, failedChildCount: 0, updatedAt: 10 };
        if (id === "run_1") return runs[0];
        return null;
      },
      query: () => ({
        withIndex: () => ({
          collect: async () => runs,
        }),
      }),
    },
  }, { messageId: "message_1" });

  const batchInternal = await (getBatchInternal as any)._handler({
    db: { get: async () => ({ _id: "batch_1" }) },
  }, { batchId: "batch_1" });
  const runInternal = await (getRunInternal as any)._handler({
    db: { get: async () => runs[0] },
  }, { runId: "run_1" });
  const listedRuns = await (listRunsForBatchInternal as any)._handler({
    db: {
      query: () => ({
        withIndex: () => ({
          collect: async () => runs,
        }),
      }),
    },
  }, { batchId: "batch_1" });

  assert.equal(batchView?.batch._id, "batch_1");
  assert.equal(batchView?.runs[0]?._id, "run_1");
  assert.deepEqual(batchInternal, { _id: "batch_1" });
  assert.deepEqual(runInternal, runs[0]);
  assert.deepEqual(listedRuns, runs);
});

test("subagent action wrappers share the expected handler wiring", () => {
  assert.equal(typeof (runCycle as any)._handler, "function");
  assert.equal((runSubagentRun as any)._handler, (continueSubagentRun as any)._handler);
  assert.equal(typeof (continueParentAfterSubagents as any)._handler, "function");
});
