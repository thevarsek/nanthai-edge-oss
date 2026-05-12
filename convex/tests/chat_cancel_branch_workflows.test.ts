import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelActiveGenerationHandler,
  cancelGenerationHandler,
} from "../chat/mutations_public_handlers";

function queryResult(result: { first?: unknown; collect?: unknown[] }) {
  return {
    withIndex: (_index: string, apply?: (q: any) => unknown) => {
      apply?.({ eq: () => ({ eq: () => ({}) }) });
      return {
        first: async () => result.first ?? null,
        collect: async () => result.collect ?? [],
      };
    },
  };
}

function createCancelCtx(options: {
  job?: Record<string, unknown> | null;
  chat?: Record<string, unknown> | null;
  messages?: Record<string, Record<string, unknown>>;
  continuations?: Record<string, Record<string, unknown>>;
  queuedJobs?: Record<string, unknown>[];
  streamingJobs?: Record<string, unknown>[];
  streamingRows?: Record<string, unknown>[];
  batch?: Record<string, unknown> | null;
  runs?: Record<string, unknown>[];
  sessions?: Record<string, unknown>[];
} = {}) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deletes: string[] = [];
  const cancelledScheduled: string[] = [];
  const messages = options.messages ?? {};
  const continuations = options.continuations ?? {};
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") return options.chat ?? { _id: "chat_1", userId: "user_1" };
        if (id === "job_1") return options.job ?? null;
        const queuedJob = (options.queuedJobs ?? []).find((job) => job._id === id);
        if (queuedJob) return queuedJob;
        const streamingJob = (options.streamingJobs ?? []).find((job) => job._id === id);
        if (streamingJob) return streamingJob;
        if (id in messages) return messages[id];
        return null;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      delete: async (id: string) => {
        deletes.push(id);
      },
      query: (table: string) => {
        if (table === "generationContinuations") {
          return queryResult({ first: continuations.job_1 ?? null });
        }
        if (table === "streamingMessages") {
          return queryResult({ collect: options.streamingRows ?? [] });
        }
        if (table === "subagentBatches") {
          return queryResult({ first: options.batch ?? null });
        }
        if (table === "subagentRuns") {
          return queryResult({ collect: options.runs ?? [] });
        }
        if (table === "generationJobs") {
          let status = "";
          return {
            withIndex: (_index: string, apply: (q: any) => unknown) => {
              apply({
                eq: (field: string, value: string) => {
                  if (field === "status") status = value;
                  return {
                    eq: (nextField: string, nextValue: string) => {
                      if (nextField === "status") status = nextValue;
                      return {};
                    },
                  };
                },
              });
              return {
                collect: async () =>
                  status === "queued"
                    ? (options.queuedJobs ?? [])
                    : (options.streamingJobs ?? []),
              };
            },
          };
        }
        if (table === "searchSessions") {
          return queryResult({ collect: options.sessions ?? [] });
        }
        return queryResult({});
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelledScheduled.push(id);
      },
    },
  } as any;
  return { ctx, patches, deletes, cancelledScheduled };
}

test("cancelGeneration cancels durable continuation, assistant state, subagent runs, and linked search", async () => {
  const { ctx, patches, deletes, cancelledScheduled } = createCancelCtx({
    job: {
      _id: "job_1",
      userId: "user_1",
      messageId: "message_1",
      status: "streaming",
      scheduledFunctionId: "sched_job",
    },
    messages: {
      message_1: {
        _id: "message_1",
        chatId: "chat_1",
        status: "streaming",
        searchSessionId: "session_1",
      },
      session_1: { _id: "session_1", status: "planning" },
    },
    continuations: {
      job_1: { _id: "continuation_1", scheduledFunctionId: "sched_continuation" },
    },
    streamingRows: [
      { _id: "stream_old", messageId: "message_1", chatId: "chat_1", status: "streaming", content: "old", createdAt: 1, updatedAt: 1 },
      { _id: "stream_new", messageId: "message_1", chatId: "chat_1", status: "streaming", content: "new", createdAt: 2, updatedAt: 2 },
    ],
    batch: { _id: "batch_1", status: "running" },
    runs: [
      { _id: "run_1", status: "running" },
      { _id: "run_2", status: "completed" },
    ],
  });

  await cancelGenerationHandler(ctx, { jobId: "job_1" as any });

  assert.deepEqual(cancelledScheduled, ["sched_continuation"]);
  assert.ok(deletes.includes("continuation_1"));
  assert.ok(deletes.includes("stream_old"));
  assert.ok(patches.some((entry) => entry.id === "job_1" && entry.patch.status === "cancelled"));
  assert.ok(patches.some((entry) => entry.id === "message_1" && entry.patch.status === "cancelled"));
  assert.ok(patches.some((entry) => entry.id === "stream_new" && entry.patch.status === "cancelled"));
  assert.ok(patches.some((entry) => entry.id === "batch_1" && entry.patch.status === "cancelled"));
  assert.ok(patches.some((entry) => entry.id === "run_1" && entry.patch.status === "cancelled"));
  assert.ok(!patches.some((entry) => entry.id === "run_2"));
  assert.ok(patches.some((entry) => entry.id === "session_1" && entry.patch.currentPhase === "cancelled"));
});

test("cancelGeneration leaves completed and failed jobs untouched after authorization", async () => {
  for (const status of ["completed", "failed"]) {
    const { ctx, patches, cancelledScheduled } = createCancelCtx({
      job: { _id: "job_1", userId: "user_1", messageId: "message_1", status },
    });

    await cancelGenerationHandler(ctx, { jobId: "job_1" as any });

    assert.equal(patches.length, 0);
    assert.equal(cancelledScheduled.length, 0);
  }
});

test("cancelActiveGeneration cancels queued and streaming work but preserves terminal searches and runs", async () => {
  const { ctx, patches, cancelledScheduled } = createCancelCtx({
    messages: {
      queued_msg: { _id: "queued_msg", chatId: "chat_1", status: "pending" },
      streaming_msg: { _id: "streaming_msg", chatId: "chat_1", status: "streaming" },
    },
    queuedJobs: [
      { _id: "queued_job", messageId: "queued_msg", scheduledFunctionId: "sched_queued" },
    ],
    streamingJobs: [
      { _id: "streaming_job", messageId: "streaming_msg", scheduledFunctionId: "sched_streaming" },
    ],
    streamingRows: [
      { _id: "stream_overlay", messageId: "streaming_msg", chatId: "chat_1", status: "streaming", content: "", createdAt: 1, updatedAt: 1 },
    ],
    batch: { _id: "batch_1", status: "running" },
    runs: [
      { _id: "run_active", status: "running" },
      { _id: "run_failed", status: "failed" },
    ],
    sessions: [
      { _id: "session_running", status: "searching" },
      { _id: "session_done", status: "completed" },
      { _id: "session_failed", status: "failed" },
      { _id: "session_cancelled", status: "cancelled" },
    ],
  });

  const result = await cancelActiveGenerationHandler(ctx, { chatId: "chat_1" as any });

  assert.equal(result.cancelledCount, 2);
  assert.deepEqual(cancelledScheduled, ["sched_queued", "sched_streaming"]);
  assert.ok(patches.some((entry) => entry.id === "queued_job" && entry.patch.status === "cancelled"));
  assert.ok(patches.some((entry) => entry.id === "streaming_job" && entry.patch.status === "cancelled"));
  assert.ok(patches.some((entry) => entry.id === "queued_msg" && entry.patch.status === "cancelled"));
  assert.ok(patches.some((entry) => entry.id === "stream_overlay" && entry.patch.status === "cancelled"));
  assert.ok(patches.some((entry) => entry.id === "run_active" && entry.patch.status === "cancelled"));
  assert.ok(!patches.some((entry) => entry.id === "run_failed"));
  assert.ok(patches.some((entry) => entry.id === "session_running" && entry.patch.status === "cancelled"));
  assert.ok(!patches.some((entry) => entry.id === "session_done"));
  assert.ok(!patches.some((entry) => entry.id === "session_failed"));
  assert.ok(!patches.some((entry) => entry.id === "session_cancelled"));
});

test("cancelActiveGeneration rejects chats outside the authenticated user", async () => {
  const { ctx } = createCancelCtx({
    chat: { _id: "chat_1", userId: "other_user" },
  });

  await assert.rejects(
    cancelActiveGenerationHandler(ctx, { chatId: "chat_1" as any }),
    /Chat not found/,
  );
});
