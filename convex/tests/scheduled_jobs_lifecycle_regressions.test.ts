import assert from "node:assert/strict";
import test from "node:test";

import { cleanStale } from "../jobs/cleanup";
import { recordRunFailure } from "../scheduledJobs/mutations";

test("recordRunFailure preserves the execution chat on failed runs", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const job = {
    _id: "job_1",
    userId: "user_1",
    status: "active",
    totalRuns: 4,
    activeExecutionChatId: "chat_1",
    activeExecutionId: "exec_1",
  };

  const ctx = {
    db: {
      get: async (id: string) => (id === "job_1" ? job : null),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "run_1";
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
    },
    scheduler: {
      cancel: async () => undefined,
    },
  } as any;

  await (recordRunFailure as any)._handler(ctx, {
    jobId: "job_1",
    error: "boom",
    consecutiveFailures: 1,
    autoPause: false,
    startedAt: 1000,
  });

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "jobRuns");
  assert.equal(inserts[0].value.chatId, "chat_1");
  assert.equal(patches.length, 1);
});

test("stale cleanup releases scheduled execution locks and auto-pauses after repeated failures", async () => {
  const now = Date.now();
  const staleGenerationJob = {
    _id: "gen_1",
    chatId: "chat_1",
    messageId: "msg_1",
    userId: "user_1",
    modelId: "openai/gpt-5",
    status: "queued",
    createdAt: now - (11 * 60 * 1000),
    sourceJobId: "job_1",
    sourceExecutionId: "exec_1",
  };
  const message = {
    _id: "msg_1",
    status: "pending",
    content: "",
  };
  const scheduledJob = {
    _id: "job_1",
    userId: "user_1",
    status: "active",
    scheduledFunctionId: "scheduled_1",
    consecutiveFailures: 2,
    totalRuns: 7,
    activeExecutionId: "exec_1",
    activeExecutionChatId: "chat_1",
    activeExecutionStartedAt: now - (20 * 60 * 1000),
    activeStepIndex: 0,
    activeStepCount: 3,
    activeUserMessageId: "msg_user_1",
    activeAssistantMessageId: "msg_1",
    activeGenerationJobId: "gen_1",
  };

  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const cancelled: string[] = [];

  let queryCallCount = 0;
  const ctx = {
    db: {
      query: (table: string) => {
        assert.equal(table, "generationJobs");
        queryCallCount++;
        return {
          withIndex: () => ({
            // Return the stale job only on the first call (queued batch);
            // return empty for the second call (streaming batch).
            take: async () => queryCallCount === 1 ? [staleGenerationJob] : [],
          }),
        };
      },
      get: async (id: string) => {
        if (id === "msg_1") return message;
        if (id === "job_1") return scheduledJob;
        return null;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "run_1";
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
      },
    },
  } as any;

  await (cleanStale as any)._handler(ctx, {});

  const generationPatch = patches.find((patch) => patch.id === "gen_1");
  assert.equal(generationPatch?.value.status, "failed");

  const messagePatch = patches.find((patch) => patch.id === "msg_1");
  assert.equal(messagePatch?.value.status, "failed");

  const scheduledPatch = patches.find((patch) => patch.id === "job_1");
  assert.ok(scheduledPatch);
  assert.equal(scheduledPatch?.value.activeExecutionId, undefined);
  assert.equal(scheduledPatch?.value.status, "error");
  assert.equal(scheduledPatch?.value.nextRunAt, undefined);
  assert.equal(scheduledPatch?.value.scheduledFunctionId, undefined);

  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0], "scheduled_1");

  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "jobRuns");
  assert.equal(inserts[0].value.chatId, "chat_1");
  assert.equal(inserts[0].value.status, "failed");
});
