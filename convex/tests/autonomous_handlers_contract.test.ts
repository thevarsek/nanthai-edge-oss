import assert from "node:assert/strict";
import test from "node:test";

import {
  handleUserInterventionHandler,
  resumeSessionHandler,
  startSessionHandler,
  stopSessionHandler,
} from "../autonomous/mutations_public_handlers";
import {
  completeSessionHandler,
  shouldContinueHandler,
  updateParentMessageIdsHandler,
  updateProgressHandler,
} from "../autonomous/mutations_internal_handlers";

function buildAuthCtx(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    ...overrides,
  } as any;
}

test("startSessionHandler inserts a running session and schedules the first cycle", async () => {
  const inserts: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  const sessionId = await startSessionHandler(buildAuthCtx({
    db: {
      get: async (id: string) =>
        id === "chat_1" ? { _id: "chat_1", userId: "user_1", activeBranchLeafId: undefined } : null,
      query: (table: string) => ({
        withIndex: () => ({
          first: async () => (table === "purchaseEntitlements" ? { _id: "ent_1" } : null),
          collect: async () => (table === "autonomousSessions" ? [] : []),
          order: () => ({
            take: async () => [{ _id: "message_1", chatId: "chat_1" }],
          }),
          take: async () => [],
        }),
      }),
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
        return "session_1";
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  }), {
    chatId: "chat_1" as any,
    turnOrder: ["participant_1", "participant_2", "participant_1"],
    maxCycles: 4,
    pauseBetweenTurns: 1_000,
    autoStopOnConsensus: true,
    participantConfigs: [
      { participantId: "participant_1", modelId: "m1", displayName: "One" },
      { participantId: "participant_2", modelId: "m2", displayName: "Two" },
    ],
  });

  assert.equal(sessionId, "session_1");
  assert.deepEqual(inserts, [{
    chatId: "chat_1",
    userId: "user_1",
    status: "running",
    currentCycle: 0,
    maxCycles: 4,
    currentParticipantIndex: undefined,
    turnOrder: ["participant_1", "participant_2"],
    moderatorParticipantId: undefined,
    autoStopOnConsensus: true,
    pauseBetweenTurns: 1_000,
    parentMessageIds: ["message_1"],
    stopReason: undefined,
    error: undefined,
    createdAt: inserts[0].createdAt,
    updatedAt: inserts[0].updatedAt,
  }]);
  assert.deepEqual(scheduled, [{
    sessionId: "session_1",
    cycle: 1,
    startParticipantIndex: 0,
    userId: "user_1",
    participantConfigs: [
      { participantId: "participant_1", modelId: "m1", displayName: "One" },
      { participantId: "participant_2", modelId: "m2", displayName: "Two" },
    ],
    moderatorConfig: undefined,
    webSearchEnabled: false,
  }]);
});

test("resumeSessionHandler completes sessions that already exhausted max cycles", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  await resumeSessionHandler(buildAuthCtx({
    db: {
      get: async () => ({
        _id: "session_1",
        userId: "user_1",
        status: "paused",
        currentCycle: 3,
        currentParticipantIndex: 1,
        turnOrder: ["participant_1", "participant_2"],
        maxCycles: 3,
        moderatorParticipantId: undefined,
      }),
      query: () => ({
        withIndex: () => ({
          first: async () => ({ _id: "ent_1" }),
        }),
      }),
      patch: async (_id: string, patch: Record<string, unknown>) => {
        patches.push(patch);
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
      },
    },
  }), {
    sessionId: "session_1" as any,
    participantConfigs: [
      { participantId: "participant_1", modelId: "m1", displayName: "One" },
      { participantId: "participant_2", modelId: "m2", displayName: "Two" },
    ],
  });

  assert.deepEqual(patches, [{
    status: "completed_max_cycles",
    stopReason: "Max cycles reached",
    updatedAt: patches[0].updatedAt,
  }]);
  assert.deepEqual(scheduled, []);
});

test("stopSessionHandler and handleUserInterventionHandler patch terminal statuses", async () => {
  const stopPatches: Array<Record<string, unknown>> = [];
  const intervenePatches: Array<Record<string, unknown>> = [];

  await stopSessionHandler(buildAuthCtx({
    db: {
      get: async () => ({ _id: "session_1", userId: "user_1", status: "running" }),
      patch: async (_id: string, patch: Record<string, unknown>) => {
        stopPatches.push(patch);
      },
    },
  }), { sessionId: "session_1" as any });

  await handleUserInterventionHandler(buildAuthCtx({
    db: {
      get: async (id: string) =>
        id === "session_1"
          ? {
              _id: "session_1",
              userId: "user_1",
              status: "running",
              chatId: "chat_1",
              turnOrder: ["participant_1"],
            }
          : null,
      query: () => ({
        withIndex: () => ({
          collect: async () => [],
        }),
      }),
      patch: async (_id: string, patch: Record<string, unknown>) => {
        intervenePatches.push(patch);
      },
    },
  }), {
    sessionId: "session_1" as any,
    forceSendNow: true,
  });

  assert.deepEqual(stopPatches, [{
    status: "stopped",
    stopReason: "User stopped",
    updatedAt: stopPatches[0].updatedAt,
  }]);
  assert.deepEqual(intervenePatches, [{
    status: "stopped_user_intervened",
    stopReason: "User intervened",
    updatedAt: intervenePatches[0].updatedAt,
  }]);
});

test("autonomous internal handlers update progress, parents, completion, and continuation checks", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      patch: async (_id: string, patch: Record<string, unknown>) => {
        patches.push(patch);
      },
      get: async (id: string) =>
        id === "running" ? { status: "running" } : id === "stopped" ? { status: "stopped" } : null,
    },
  } as any;

  await updateProgressHandler(ctx, {
    sessionId: "session_1" as any,
    currentCycle: 2,
    currentParticipantIndex: 1,
  });
  await updateParentMessageIdsHandler(ctx, {
    sessionId: "session_1" as any,
    parentMessageIds: ["message_1", "message_2"] as any,
  });
  await completeSessionHandler(ctx, {
    sessionId: "session_1" as any,
    status: "failed",
    stopReason: "boom",
    error: "stack",
  });

  assert.deepEqual(patches, [
    { currentCycle: 2, currentParticipantIndex: 1, updatedAt: patches[0].updatedAt },
    { parentMessageIds: ["message_1", "message_2"], updatedAt: patches[1].updatedAt },
    { status: "failed", stopReason: "boom", error: "stack", updatedAt: patches[2].updatedAt },
  ]);
  assert.equal(await shouldContinueHandler(ctx, { sessionId: "running" as any }), true);
  assert.equal(await shouldContinueHandler(ctx, { sessionId: "stopped" as any }), false);
  assert.equal(await shouldContinueHandler(ctx, { sessionId: "missing" as any }), false);
});
