import assert from "node:assert/strict";
import test from "node:test";

import { scheduleGenerationContinuation } from "../chat/actions_run_generation_continuation";
import { saveGenerationContinuationHandler } from "../chat/mutations_generation_continuation_handlers";
import { decideGenerationRecovery } from "../chat/workflow_completion";

function checkpointDb(roundPhase: "pre_dispatch" | "dispatched" = "dispatched") {
  const docs = new Map<string, Record<string, unknown>>();
  const job = {
    _id: "job_1",
    chatId: "chat_1",
    messageId: "message_1",
    userId: "user_1",
    status: "streaming",
    executionRunId: "run_1",
    executionAttemptId: "attempt_1",
    executionFence: 7,
  };
  const run = {
    _id: "run_1",
    userId: "user_1",
    chatId: "chat_1",
    generationJobId: "job_1",
    activeAttemptId: "attempt_1",
    state: "running",
    nextEventSequence: 0,
  };
  const attempt = {
    _id: "attempt_1",
    runId: "run_1",
    status: "running",
    fence: 7,
  };
  const round = {
    _id: "round_1",
    jobId: "job_1",
    chatId: "chat_1",
    userId: "user_1",
    roundKey: "event_1",
    phase: roundPhase,
    executionAttemptId: "attempt_1",
    executionFence: 7,
  };
  docs.set(job._id, job);
  docs.set(run._id, run);
  docs.set(attempt._id, attempt);
  docs.set(round._id, round);
  docs.set("chat_1", { _id: "chat_1", userId: "user_1" });
  let continuation: Record<string, unknown> | null = null;
  const runEvents: Array<Record<string, unknown>> = [];
  const queryResult = (table: string) => {
    if (table === "generationContinuations") {
      return { first: async () => continuation };
    }
    if (table === "generationRoundJournal") {
      return { unique: async () => round.roundKey === "event_1" ? round : null };
    }
    if (table === "accountDeletionTombstones") {
      return { unique: async () => null };
    }
    if (table === "runtimeSessionBindings") {
      return { collect: async () => [] };
    }
    if (table === "runEvents") {
      return { unique: async () => null };
    }
    throw new Error(`Unexpected query: ${table}`);
  };
  const ctx = {
    db: {
      get: async (id: string) => docs.get(id) ?? null,
      query: (table: string) => ({
        withIndex: () => queryResult(table),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        if (table === "generationContinuations") {
          continuation = { _id: "continuation_1", ...value };
          docs.set("continuation_1", continuation);
          return "continuation_1";
        }
        if (table === "runEvents") {
          runEvents.push(value);
          return `event_${runEvents.length}`;
        }
        throw new Error(`Unexpected insert: ${table}`);
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        const doc = docs.get(id);
        if (!doc) throw new Error(`Missing document: ${id}`);
        Object.assign(doc, value);
      },
    },
    scheduler: {},
  };
  return { ctx, docs, job, run, attempt, round, runEvents, continuation: () => continuation };
}

function checkpoint(deferred = false) {
  return {
    roundKey: "event_1",
    deferredResumeEventId: deferred ? "event_1" : undefined,
    participant: { jobId: "job_1", messageId: "message_1", modelId: "model_1" },
    group: {
      assistantMessageIds: ["message_1"],
      generationJobIds: ["job_1"],
      userMessageId: "user_message_1",
      userId: "user_1",
      expandMultiModelGroups: false,
      webSearchEnabled: false,
      effectiveIntegrations: [],
      directToolNames: [],
      isPro: true,
      allowSubagents: true,
      executionAttemptId: "attempt_1",
      executionFence: 7,
    },
    messages: [{ role: "user", content: "continue" }],
    toolCalls: [],
    toolResults: [],
    activeProfiles: [],
    loadedSkills: [],
    compactionCount: 0,
    continuationCount: 1,
  };
}

test("a declared pre-provider handoff commits a pre-dispatch round atomically", async () => {
  const state = checkpointDb("pre_dispatch");
  await saveGenerationContinuationHandler(state.ctx as never, {
    chatId: "chat_1",
    messageId: "message_1",
    jobId: "job_1",
    userId: "user_1",
    checkpoint: {
      ...checkpoint(),
      checkpointBeforeProviderDispatch: true,
    },
  } as never);

  assert.equal(state.round.phase, "committed");
  assert.equal(state.attempt.status, "waiting");
  assert.equal(state.run.state, "waiting");
  assert.equal(state.continuation()?.status, "waiting");
});

test("a pre-provider recovery checkpoint adopts the superseding current fence", async () => {
  const state = checkpointDb("pre_dispatch");
  state.attempt.status = "interrupted";
  const supersedingAttempt = {
    _id: "attempt_2",
    runId: "run_1",
    status: "running",
    fence: 8,
  };
  state.docs.set(supersedingAttempt._id, supersedingAttempt);
  state.job.executionAttemptId = supersedingAttempt._id;
  state.job.executionFence = supersedingAttempt.fence;
  state.run.activeAttemptId = supersedingAttempt._id;
  const baseCheckpoint = checkpoint();

  await saveGenerationContinuationHandler(state.ctx as never, {
    chatId: "chat_1",
    messageId: "message_1",
    jobId: "job_1",
    userId: "user_1",
    checkpoint: {
      ...baseCheckpoint,
      checkpointBeforeProviderDispatch: true,
      group: {
        ...baseCheckpoint.group,
        executionAttemptId: supersedingAttempt._id,
        executionFence: supersedingAttempt.fence,
      },
    },
  } as never);

  assert.equal(state.round.phase, "committed");
  assert.equal(state.round.executionAttemptId, "attempt_2");
  assert.equal(state.round.executionFence, 8);
  assert.equal(supersedingAttempt.status, "waiting");
  assert.equal(state.run.state, "waiting");
});

test("an ordinary checkpoint cannot commit a pre-dispatch round", async () => {
  const state = checkpointDb("pre_dispatch");
  await assert.rejects(
    saveGenerationContinuationHandler(state.ctx as never, {
      chatId: "chat_1",
      messageId: "message_1",
      jobId: "job_1",
      userId: "user_1",
      checkpoint: checkpoint(),
    } as never),
    /GENERATION_CHECKPOINT_ROUND_REJECTED/,
  );

  assert.equal(state.round.phase, "pre_dispatch");
  assert.equal(state.attempt.status, "running");
  assert.equal(state.run.state, "running");
});

for (const deferred of [false, true]) {
  test(`checkpoint and round commit are atomic before outer return (${deferred ? "deferred child" : "tool continuation"})`, async () => {
    const state = checkpointDb();
    await saveGenerationContinuationHandler(state.ctx as never, {
      chatId: "chat_1",
      messageId: "message_1",
      jobId: "job_1",
      userId: "user_1",
      checkpoint: checkpoint(deferred),
    } as never);

    const continuation = state.continuation();
    assert.equal(continuation?.roundKey, "event_1");
    assert.equal(continuation?.status, "waiting");
    assert.equal(continuation?.deferredResumeEventId, deferred ? "event_1" : undefined);
    assert.equal(state.round.phase, "committed");
    assert.equal(state.attempt.status, "waiting");
    assert.equal(state.run.state, "waiting");
    assert.equal(state.runEvents.length, 1);
    assert.equal(decideGenerationRecovery("committed", true), "recover_checkpoint");

    // Simulates retry after the action died before its outer markCommitted.
    await saveGenerationContinuationHandler(state.ctx as never, {
      chatId: "chat_1",
      messageId: "message_1",
      jobId: "job_1",
      userId: "user_1",
      checkpoint: checkpoint(deferred),
    } as never);
    assert.equal(state.runEvents.length, 1, "idempotent save does not release twice");
  });
}

test("Workflow scheduling uses one atomic checkpoint mutation and carries the round key", async () => {
  const calls: Array<{
    checkpoint?: {
      roundKey?: string;
      group?: { executionAttemptId?: string };
    };
  }> = [];
  const ctx = {
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      calls.push(args as {
        checkpoint?: { roundKey?: string; group?: { executionAttemptId?: string } };
      });
    },
    scheduler: { runAfter: async () => { throw new Error("must not schedule legacy action"); } },
  };
  await scheduleGenerationContinuation(ctx as never, {
    chatId: "chat_1",
    userMessageId: "user_message_1",
    assistantMessageIds: ["message_1"],
    generationJobIds: ["job_1"],
    participant: { jobId: "job_1", messageId: "message_1", modelId: "model_1" },
    userId: "user_1",
    expandMultiModelGroups: false,
    webSearchEnabled: false,
    effectiveIntegrations: [],
    isPro: true,
    allowSubagents: true,
    workflowManaged: true,
    workflowResumeEventId: "event_1",
    executionAttemptId: "attempt_1",
    executionFence: 7,
  } as never, checkpoint(true) as never);

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.checkpoint?.roundKey, "event_1");
  assert.equal(calls[0]?.checkpoint?.group?.executionAttemptId, "attempt_1");
});
