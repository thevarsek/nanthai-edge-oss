import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelGenerationContinuationHandler,
  claimGenerationContinuationHandler,
  clearGenerationContinuationHandler,
  saveGenerationContinuationHandler,
  setGenerationContinuationScheduledHandler,
} from "../chat/mutations_generation_continuation_handlers";

function continuationCheckpoint(overrides: Record<string, unknown> = {}) {
  return {
    participant: { jobId: "job_1", messageId: "msg_1", modelId: "model_1" },
    group: {
      chatId: "chat_1",
      userMessageId: "user_msg_1",
      assistantMessageIds: ["msg_1"],
      generationJobIds: ["job_1"],
      userId: "user_1",
      expandMultiModelGroups: false,
      webSearchEnabled: false,
      effectiveIntegrations: [],
      directToolNames: [],
      isPro: false,
      allowSubagents: false,
    },
    messages: [{ role: "user", content: "hello" }],
    usage: null,
    toolCalls: [],
    toolResults: [],
    activeProfiles: [],
    loadedSkills: [],
    compactionCount: 0,
    continuationCount: 0,
    ...overrides,
  } as any;
}

test("setGenerationContinuationScheduledHandler does not overwrite a claimed continuation", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const continuation = {
    _id: "cont_1",
    status: "running",
  };
  const job = {
    _id: "job_1",
  };

  const ctx = {
    db: {
      query: (_table: string) => ({
        withIndex: (_index: string, _apply: unknown) => ({
          first: async () => continuation,
        }),
      }),
      get: async (id: string) => (id === "job_1" ? job : null),
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: {},
  } as any;

  await setGenerationContinuationScheduledHandler(ctx, {
    jobId: "job_1" as any,
    scheduledFunctionId: "sched_1" as any,
  });

  assert.deepEqual(patches, [{
    id: "job_1",
    value: {
      scheduledFunctionId: "sched_1",
    },
  }]);
});

test("saveGenerationContinuationHandler inserts new checkpoints and patches existing ones", async () => {
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  let existing: Record<string, unknown> | null = null;
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => existing,
        }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserted.push({ table, value });
        return "cont_inserted";
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: {},
  } as any;

  await saveGenerationContinuationHandler(ctx, {
    chatId: "chat_1" as any,
    messageId: "msg_1" as any,
    jobId: "job_1" as any,
    userId: "user_1",
    checkpoint: continuationCheckpoint({
      usage: { promptTokens: 1 },
      toolCalls: [{ id: "call_1" }],
      toolResults: [{ id: "result_1" }],
      loadedSkills: [{ skillId: "skill_1", instructions: "Use it" }],
      partialContent: "partial",
      partialReasoning: "thinking",
    }),
  });

  existing = { _id: "cont_existing" };
  await saveGenerationContinuationHandler(ctx, {
    chatId: "chat_1" as any,
    messageId: "msg_1" as any,
    jobId: "job_1" as any,
    userId: "user_1",
    checkpoint: continuationCheckpoint(),
  });

  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]?.table, "generationContinuations");
  assert.equal(inserted[0]?.value.status, "waiting");
  assert.equal(inserted[0]?.value.checkpointVersion, "v2");
  assert.deepEqual(inserted[0]?.value.toolCalls, [{ id: "call_1" }]);
  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.id, "cont_existing");
  assert.equal(patches[0]?.value.toolCalls, undefined);
  assert.equal(patches[0]?.value.loadedSkills, undefined);
});

test("claimGenerationContinuationHandler covers missing, terminal, active-lease, and expired-lease claims", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const deletes: string[] = [];
  let continuation: Record<string, unknown> | null = null;
  let job: Record<string, unknown> | null = null;
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => continuation,
        }),
      }),
      get: async () => job,
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      delete: async (id: string) => {
        deletes.push(id);
      },
    },
    scheduler: {},
  } as any;

  assert.equal(
    await claimGenerationContinuationHandler(ctx, { jobId: "job_1" as any }),
    null,
  );

  continuation = { _id: "cont_terminal" };
  job = { _id: "job_1", status: "completed", scheduledFunctionId: "sched_1" };
  assert.equal(
    await claimGenerationContinuationHandler(ctx, { jobId: "job_1" as any }),
    null,
  );
  assert.deepEqual(deletes, ["cont_terminal"]);
  assert.deepEqual(patches.at(-1), {
    id: "job_1",
    value: { scheduledFunctionId: undefined },
  });

  continuation = {
    _id: "cont_running",
    status: "running",
    leaseExpiresAt: Date.now() + 60_000,
  };
  job = { _id: "job_1", status: "streaming" };
  assert.equal(
    await claimGenerationContinuationHandler(ctx, { jobId: "job_1" as any }),
    null,
  );

  continuation = {
    _id: "cont_deferred",
    status: "waiting",
    deferredResumeEventId: "event_1",
  };
  job = { _id: "job_1", status: "streaming" };
  assert.equal(
    await claimGenerationContinuationHandler(ctx, { jobId: "job_1" as any }),
    null,
  );
  assert.equal(patches.some((entry) => entry.id === "cont_deferred"), false);

  continuation = {
    _id: "cont_waiting",
    status: "waiting",
    participantSnapshot: { jobId: "job_1" },
    groupSnapshot: { userId: "user_1" },
    checkpointVersion: "v2",
    assembledCheckpoint: { policyVersion: "m38.policy.v1" },
    requestMessages: [{ role: "user" }],
    usage: { totalTokens: 7 },
    toolCalls: [{ id: "call_1" }],
    toolResults: [{ id: "result_1" }],
    activeProfiles: ["google"],
    loadedSkills: [{ skillId: "skill_1" }],
    compactionCount: 2,
    continuationCount: 3,
    partialContent: "draft",
    partialReasoning: "reason",
  };
  job = { _id: "job_1", status: "streaming", scheduledFunctionId: "sched_2" };

  const claimed = await claimGenerationContinuationHandler(ctx, { jobId: "job_1" as any });

  assert.equal(claimed?.continuationCount, 3);
  assert.equal(claimed?.checkpointVersion, "v2");
  assert.deepEqual(claimed?.assembledCheckpoint, { policyVersion: "m38.policy.v1" });
  assert.deepEqual(claimed?.toolCalls, [{ id: "call_1" }]);
  assert.ok(patches.some((entry) =>
    entry.id === "cont_waiting"
    && entry.value.status === "running"
    && typeof entry.value.leaseExpiresAt === "number"
  ));
  assert.ok(patches.some((entry) =>
    entry.id === "job_1"
    && entry.value.scheduledFunctionId === undefined
  ));
});

test("setGenerationContinuationScheduledHandler respects opt-out and updates waiting continuations", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  let continuation: Record<string, unknown> | null = { _id: "cont_1", status: "waiting" };
  let job: Record<string, unknown> | null = { _id: "job_1" };
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => continuation,
        }),
      }),
      get: async () => job,
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: {},
  } as any;

  await setGenerationContinuationScheduledHandler(ctx, {
    jobId: "job_1" as any,
    scheduledFunctionId: "sched_1" as any,
  });
  continuation = null;
  job = null;
  await setGenerationContinuationScheduledHandler(ctx, {
    jobId: "job_1" as any,
    scheduledFunctionId: "sched_2" as any,
    updateContinuation: false,
  });

  assert.ok(patches.some((entry) =>
    entry.id === "cont_1"
    && entry.value.status === "waiting"
    && entry.value.scheduledFunctionId === "sched_1"
  ));
  assert.ok(patches.some((entry) =>
    entry.id === "job_1"
    && entry.value.scheduledFunctionId === "sched_1"
  ));
  assert.equal(patches.some((entry) => entry.value.scheduledFunctionId === "sched_2"), false);
});

test("clear and cancel continuation handlers remove durable state and stale scheduled ids", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const deletes: string[] = [];
  const cancelled: string[] = [];
  let continuation: Record<string, unknown> | null = {
    _id: "cont_1",
    scheduledFunctionId: "sched_from_continuation",
  };
  let job: Record<string, unknown> | null = {
    _id: "job_1",
    scheduledFunctionId: "sched_from_job",
  };
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({
          first: async () => continuation,
        }),
      }),
      get: async () => job,
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      delete: async (id: string) => {
        deletes.push(id);
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
        throw new Error("already gone");
      },
    },
  } as any;

  await clearGenerationContinuationHandler(ctx, { jobId: "job_1" as any });
  continuation = { _id: "cont_2" };
  job = { _id: "job_1", scheduledFunctionId: "sched_from_job" };
  await cancelGenerationContinuationHandler(ctx, { jobId: "job_1" as any });
  continuation = null;
  job = null;
  await clearGenerationContinuationHandler(ctx, { jobId: "job_1" as any });
  await cancelGenerationContinuationHandler(ctx, { jobId: "job_1" as any });

  assert.deepEqual(deletes, ["cont_1", "cont_2"]);
  assert.deepEqual(cancelled, ["sched_from_job"]);
  assert.ok(patches.some((entry) =>
    entry.id === "job_1"
    && entry.value.scheduledFunctionId === undefined
  ));
});
