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

test("stale cleanup dispatches scheduled execution candidates to fenced per-job cleanup", async () => {
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
  const scheduled: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      query: (table: string) => {
        if (table === "generationContinuations") {
          return {
            withIndex: () => ({
              take: async () => [],
              first: async () => null,
            }),
          };
        }
        assert.equal(table, "generationJobs");
        return {
          withIndex: (indexName: string, apply: (q: any) => unknown) => {
            let status = "";
            const q = { eq: (_field: string, value: string) => { status = value; return q; } };
            apply(q);
            assert.equal(indexName, "by_status");
            return {
              paginate: async () => ({
                page: status === "queued" ? [staleGenerationJob] : [],
                continueCursor: `${status}-done`,
                isDone: true,
              }),
            };
          },
        };
      },
      get: async () => null,
      delete: async () => undefined,
    },
    scheduler: {
      cancel: async () => undefined,
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
      },
    },
  } as any;

  await (cleanStale as any)._handler(ctx, {});
  assert.deepEqual(scheduled, [
    { jobId: "gen_1" },
    {
      queuedCursor: "queued-done",
      queuedDone: true,
      streamingDone: false,
    },
  ]);
});
