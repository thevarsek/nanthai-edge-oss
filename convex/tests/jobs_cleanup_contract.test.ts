import assert from "node:assert/strict";
import test from "node:test";

import { cleanStale } from "../jobs/cleanup";

function buildGenerationJobsQuery(queuedJobs: any[], streamingJobs: any[]) {
  return {
    withIndex: (_index: string, apply: (q: any) => unknown) => {
      let status = "";
      apply({
        eq: (_field: string, value: string) => {
          status = value;
          return {};
        },
      });
      return {
        paginate: async ({ numItems }: { numItems: number }) => {
          const jobs = status === "queued" ? queuedJobs : streamingJobs;
          return {
            page: jobs.slice(0, numItems),
            continueCursor: `${status}-next`,
            isDone: jobs.length <= numItems,
          };
        },
      };
    },
  };
}

function buildEmptyContinuationsQuery() {
  return {
    withIndex: () => ({
      take: async () => [],
      first: async () => null,
    }),
  };
}

test("cleanStale dispatches timed-out candidates to the fenced cleanup mutation", async () => {
  const now = Date.now();
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const cancelled: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];

  const queuedJob = {
    _id: "job_1",
    status: "queued",
    createdAt: now - 11 * 60 * 1000,
    messageId: "msg_1",
    sourceJobId: "scheduled_job_1",
    sourceExecutionId: "exec_1",
  };

  await (cleanStale as any)._handler({
    db: {
      query: (table: string) => {
        if (table === "generationJobs") {
          return buildGenerationJobsQuery([queuedJob], []);
        }
        if (table === "generationContinuations") {
          return buildEmptyContinuationsQuery();
        }
        throw new Error(`Unexpected query table: ${table}`);
      },
      get: async (id: string) => {
        if (id === "msg_1") {
          return {
            _id: "msg_1",
            status: "pending",
            content: "",
            searchSessionId: "search_1",
          };
        }
        if (id === "search_1") {
          return { _id: "search_1", status: "searching" };
        }
        if (id === "scheduled_job_1") {
          return {
            _id: "scheduled_job_1",
            userId: "user_1",
            status: "active",
            scheduledFunctionId: "fn_1",
            activeExecutionId: "exec_1",
            activeExecutionChatId: "chat_1",
            activeExecutionStartedAt: now - 2_000,
            activeGenerationJobId: "job_1",
            consecutiveFailures: 2,
            totalRuns: 4,
          };
        }
        return null;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "inserted";
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
      },
      runAfter: async (
        _delay: number,
        _fn: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push(args);
      },
    },
  }, {});

  assert.deepEqual(patches, []);
  assert.deepEqual(inserts, []);
  assert.deepEqual(cancelled, []);
  assert.deepEqual(scheduled, [
    { jobId: "job_1" },
    {
      queuedCursor: "queued-next",
      queuedDone: true,
      streamingDone: false,
    },
  ]);
});

test("cleanStale dispatches streaming candidates for per-job timestamp evaluation", async () => {
  const now = Date.now();
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  await (cleanStale as any)._handler({
    db: {
      query: (table: string) => {
        if (table === "generationJobs") {
          return buildGenerationJobsQuery([], [{
            _id: "job_streaming",
            status: "streaming",
            createdAt: now - 5 * 60 * 1000,
            startedAt: now - 46 * 60 * 1000,
            messageId: "msg_streaming",
          }]);
        }
        if (table === "generationContinuations") {
          return buildEmptyContinuationsQuery();
        }
        throw new Error(`Unexpected query table: ${table}`);
      },
      get: async (id: string) =>
        id === "msg_streaming"
          ? { _id: "msg_streaming", status: "streaming", content: "partial" }
          : null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      insert: async () => "inserted",
    },
    scheduler: {
      cancel: async () => undefined,
      runAfter: async (
        _delay: number,
        _fn: unknown,
        args: Record<string, unknown>,
      ) => {
        scheduled.push(args);
      },
    },
  }, { queuedDone: true });

  assert.deepEqual(patches, []);
  assert.deepEqual(scheduled, [
    { jobId: "job_streaming" },
    {
      streamingCursor: "streaming-next",
      queuedDone: true,
      streamingDone: true,
    },
  ]);
});

test("cleanStale self-schedules a continuation when either candidate batch hits the cap", async () => {
  const now = Date.now();
  const followUps: Array<{ delay: number }> = [];
  const freshQueuedJobs = Array.from({ length: 150 }, (_, index) => ({
    _id: `job_${index}`,
    status: "queued",
    createdAt: now,
    messageId: `msg_${index}`,
  }));

  await (cleanStale as any)._handler({
    db: {
      query: (table: string) => {
        if (table === "generationJobs") {
          return buildGenerationJobsQuery(freshQueuedJobs, []);
        }
        if (table === "generationContinuations") {
          return buildEmptyContinuationsQuery();
        }
        throw new Error(`Unexpected query table: ${table}`);
      },
      get: async () => null,
      patch: async () => undefined,
      insert: async () => "inserted",
    },
    scheduler: {
      cancel: async () => undefined,
      runAfter: async (delay: number) => {
        followUps.push({ delay });
      },
    },
  }, {});

  assert.equal(followUps.length, 76);
  assert.ok(followUps.every((entry) => entry.delay === 0));
});

test("cleanStale runs only one paginated query in each mutation invocation", async () => {
  const paginatedStatuses: string[] = [];
  const followUps: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      query: (table: string) => {
        assert.equal(table, "generationJobs");
        return {
          withIndex: (_index: string, apply: (q: any) => unknown) => {
            let status = "";
            apply({
              eq: (_field: string, value: string) => {
                status = value;
                return {};
              },
            });
            return {
              paginate: async () => {
                paginatedStatuses.push(status);
                assert.equal(
                  paginatedStatuses.length,
                  1,
                  "Convex permits one paginated query per mutation invocation",
                );
                return {
                  page: [],
                  continueCursor: `${status}-done`,
                  isDone: true,
                };
              },
            };
          },
        };
      },
    },
    scheduler: {
      runAfter: async (
        _delay: number,
        _fn: unknown,
        args: Record<string, unknown>,
      ) => {
        followUps.push(args);
      },
    },
  };

  await (cleanStale as any)._handler(ctx, {});

  assert.deepEqual(paginatedStatuses, ["queued"]);
  assert.deepEqual(followUps, [{
    queuedCursor: "queued-done",
    queuedDone: true,
    streamingDone: false,
  }]);
});
