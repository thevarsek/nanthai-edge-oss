import assert from "node:assert/strict";
import test from "node:test";

import { durableWorkflow } from "../execution/components";
import { installDeferredCheckpointAndSignalHandler } from "../chat/workflow_resume_handlers";

test("subagent resume delivery is atomically marked and retry-safe", async (t) => {
  const job = {
    _id: "job_1",
    chatId: "chat_1",
    userId: "user_1",
    status: "streaming",
    executionAttemptId: "attempt_1",
    executionFence: 7,
  };
  const round = {
    _id: "round_1",
    jobId: "job_1",
    userId: "user_1",
    roundKey: "event_1",
    phase: "committed",
    executionAttemptId: "attempt_1",
    executionFence: 7,
  };
  const attempt = {
    _id: "attempt_1",
    runId: "run_1",
    status: "waiting",
    fence: 7,
  };
  const run = {
    _id: "run_1",
    activeAttemptId: "attempt_1",
    state: "waiting",
  };
  const continuation = {
    _id: "continuation_1",
    jobId: "job_1",
    deferredResumeEventId: "event_1",
    roundKey: "event_1",
    executionAttemptId: "attempt_1",
    executionFence: 7,
  };
  const batch = {
    _id: "batch_1",
    parentJobId: "job_1",
    userId: "user_1",
    status: "resuming",
    resumeDeliveredEventId: undefined as string | undefined,
    resumeDeliveredAt: undefined as number | undefined,
  };
  let deliveries = 0;
  t.mock.method(durableWorkflow, "sendEvent", async () => { deliveries += 1; });
  const ctx = {
    db: {
      get: async (id: string) => id === job._id
        ? job
        : id === batch._id
          ? batch
          : id === attempt._id
            ? attempt
            : id === run._id
              ? run
              : null,
      query: (table: string) => ({
        withIndex: () => table === "generationContinuations"
          ? { first: async () => continuation }
          : table === "generationRoundJournal"
            ? { unique: async () => round }
            : { unique: async () => null },
      }),
      patch: async (id: string, value: Record<string, unknown>) => {
        if (id === batch._id) Object.assign(batch, value);
        else if (id === continuation._id) Object.assign(continuation, value);
        else if (id === round._id) Object.assign(round, value);
      },
    },
  };
  const args = {
    chatId: "chat_1",
    messageId: "message_1",
    jobId: "job_1",
    userId: "user_1",
    eventId: "event_1",
    resumeBatchId: "batch_1",
    checkpoint: {
      roundKey: "event_1",
      participant: {},
      group: { executionAttemptId: "attempt_1", executionFence: 7 },
      checkpointVersion: "v2",
      messages: [],
      toolCalls: [],
      toolResults: [],
      activeProfiles: [],
      loadedSkills: [],
      compactionCount: 0,
      continuationCount: 1,
    },
  };

  assert.equal(await installDeferredCheckpointAndSignalHandler(
    ctx as never,
    args as never,
  ), "resumed");
  assert.equal(batch.status, "completed");
  assert.equal(batch.resumeDeliveredEventId, "event_1");
  assert.equal(typeof batch.resumeDeliveredAt, "number");
  assert.equal(await installDeferredCheckpointAndSignalHandler(
    ctx as never,
    args as never,
  ), "duplicate");
  assert.equal(deliveries, 1);
});
