import assert from "node:assert/strict";
import test from "node:test";

import {
  createRunCycleHandlerDepsForTest,
  runCycleHandler,
} from "../autonomous/actions_run_cycle_handler";

function buildArgs(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "session_1",
    cycle: 1,
    startParticipantIndex: 0,
    userId: "user_1",
    participantConfigs: [
      { participantId: "p1", modelId: "model_1", displayName: "Alpha" },
      { participantId: "p2", modelId: "model_2", displayName: "Beta" },
    ],
    moderatorConfig: undefined,
    webSearchEnabled: false,
    ...overrides,
  } as any;
}

function buildCtx(sessionOverrides: Record<string, unknown> = {}) {
  const mutations: Record<string, unknown>[] = [];
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = [];
  const session = {
    _id: "session_1",
    chatId: "chat_1",
    turnOrder: ["p1", "p2"],
    parentMessageIds: ["msg_seed"],
    pauseBetweenTurns: 0,
    autoStopOnConsensus: false,
    maxCycles: 3,
    ...sessionOverrides,
  };

  const ctx = {
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.sessionId === "session_1") {
        return session;
      }
      return null;
    },
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay: 0, args });
      },
    },
  } as any;

  return { ctx, mutations, scheduled };
}

test("runCycleHandler completes on consensus without scheduling another cycle", async (t) => {
  const { ctx, mutations, scheduled } = buildCtx({
    autoStopOnConsensus: true,
    maxCycles: 5,
  });

  const normalized = {
    participants: [
      { participantId: "p1", modelId: "model_1", displayName: "Alpha" },
      { participantId: "p2", modelId: "model_2", displayName: "Beta" },
    ],
    moderator: undefined,
  };

  const deps = createRunCycleHandlerDepsForTest({
    normalizeRunCycleArgs: () => normalized as any,
    resolveTurnParticipants: () => normalized.participants as any,
    resolveStartParticipantIndex: () => 0,
    resolveLinearCycleParentIds: () => ["msg_seed"] as any,
    loadModelCapabilities: async () => new Map(),
    shouldSessionContinue: async () => true,
    runParticipantTurn: async ({ participant }: any) => ({
      kind: "completed",
      messageId: (participant.participantId === "p1" ? "msg_1" : "msg_2") as any,
    }),
    checkConsensusInternal: async () => true,
  });

  await runCycleHandler(ctx, buildArgs(), deps);

  assert.equal(
    mutations.some((entry) => entry.status === "completed_consensus"),
    true,
  );
  assert.equal(scheduled.length, 0);
});

test("runCycleHandler continues after a failed participant turn and schedules the next cycle", async (t) => {
  const { ctx, mutations, scheduled } = buildCtx({
    maxCycles: 3,
  });

  const normalized = {
    participants: [
      { participantId: "p1", modelId: "model_1", displayName: "Alpha" },
      { participantId: "p2", modelId: "model_2", displayName: "Beta" },
    ],
    moderator: undefined,
  };

  let turnIndex = 0;
  const deps = createRunCycleHandlerDepsForTest({
    normalizeRunCycleArgs: () => normalized as any,
    resolveTurnParticipants: () => normalized.participants as any,
    resolveStartParticipantIndex: () => 0,
    resolveLinearCycleParentIds: () => ["msg_seed"] as any,
    loadModelCapabilities: async () => new Map(),
    shouldSessionContinue: async () => true,
    runParticipantTurn: async () => {
      turnIndex += 1;
      if (turnIndex === 1) {
        return { kind: "failed", reason: "temporary upstream issue" };
      }
      return { kind: "completed", messageId: "msg_2" as any };
    },
  });

  await runCycleHandler(ctx, buildArgs(), deps);

  assert.equal(turnIndex, 2);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0]?.args?.sessionId, "session_1");
  assert.equal(scheduled[0]?.args?.cycle, 2);
  assert.equal(scheduled[0]?.args?.startParticipantIndex, 0);
  assert.equal(scheduled[0]?.args?.userId, "user_1");
  assert.deepEqual(scheduled[0]?.args?.participantConfigs, normalized.participants);
  assert.equal(scheduled[0]?.args?.moderatorConfig, undefined);
  assert.equal(scheduled[0]?.args?.webSearchEnabled, false);
  assert.equal(
    mutations.filter((entry) => entry.currentParticipantIndex !== undefined).length >= 2,
    true,
  );
});

test("runCycleHandler fails the session when fewer than two valid turn participants remain", async (t) => {
  const { ctx, mutations, scheduled } = buildCtx();

  const deps = createRunCycleHandlerDepsForTest({
    normalizeRunCycleArgs: () => ({
      participants: [{ participantId: "p1", modelId: "model_1", displayName: "Alpha" }],
      moderator: undefined,
    }) as any,
    resolveTurnParticipants: () => [
      { participantId: "p1", modelId: "model_1", displayName: "Alpha" },
    ] as any,
    shouldSessionContinue: async () => true,
  });

  await runCycleHandler(ctx, buildArgs(), deps);

  assert.equal(scheduled.length, 0);
  assert.equal(
    mutations.some((entry) =>
      entry.status === "failed" &&
      String(entry.error).includes("fewer than 2 valid turn participants")
    ),
    true,
  );
});

test("runCycleHandler aborts when pauseBetweenTurnsWithHeartbeat indicates the session stopped", async (t) => {
  const { ctx, scheduled } = buildCtx({
    pauseBetweenTurns: 5,
  });

  const normalized = {
    participants: [
      { participantId: "p1", modelId: "model_1", displayName: "Alpha" },
      { participantId: "p2", modelId: "model_2", displayName: "Beta" },
    ],
    moderator: undefined,
  };

  let turnCount = 0;
  const deps = createRunCycleHandlerDepsForTest({
    normalizeRunCycleArgs: () => normalized as any,
    resolveTurnParticipants: () => normalized.participants as any,
    resolveStartParticipantIndex: () => 0,
    resolveLinearCycleParentIds: () => ["msg_seed"] as any,
    loadModelCapabilities: async () => new Map(),
    shouldSessionContinue: async () => true,
    runParticipantTurn: async () => {
      turnCount += 1;
      return { kind: "completed", messageId: "msg_1" as any };
    },
    pauseBetweenTurnsWithHeartbeat: async () => false,
  });

  await runCycleHandler(ctx, buildArgs(), deps);

  assert.equal(turnCount, 1);
  assert.equal(scheduled.length, 0);
});

test("runCycleHandler funnels thrown errors to completeSessionFailedIfRunning", async (t) => {
  const { ctx } = buildCtx();
  const normalized = {
    participants: [
      { participantId: "p1", modelId: "model_1", displayName: "Alpha" },
      { participantId: "p2", modelId: "model_2", displayName: "Beta" },
    ],
    moderator: undefined,
  };
  const failures: string[] = [];

  const deps = createRunCycleHandlerDepsForTest({
    normalizeRunCycleArgs: () => normalized as any,
    resolveTurnParticipants: () => normalized.participants as any,
    resolveStartParticipantIndex: () => 0,
    resolveLinearCycleParentIds: () => ["msg_seed"] as any,
    loadModelCapabilities: async () => {
      throw new Error("boom");
    },
    shouldSessionContinue: async () => true,
    completeSessionFailedIfRunning: async (_ctx: unknown, _id: unknown, reason: string) => {
      failures.push(reason);
    },
  });

  await runCycleHandler(ctx, buildArgs(), deps);

  assert.deepEqual(failures, ["boom"]);
});
