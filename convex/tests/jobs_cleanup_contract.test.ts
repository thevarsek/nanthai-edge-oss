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
        take: async () => (status === "queued" ? queuedJobs : streamingJobs),
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

test("cleanStale marks timed-out jobs, messages, search sessions, and scheduled executions failed", async () => {
  const now = Date.now();
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const cancelled: string[] = [];
  const scheduled: string[] = [];

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
      runAfter: async (_delay: number, _fn: unknown) => {
        scheduled.push("runAfter");
      },
    },
  }, {});

  const jobPatch = patches.find((entry) => entry.id === "job_1")?.patch;
  const messagePatch = patches.find((entry) => entry.id === "msg_1")?.patch;
  const sessionPatch = patches.find((entry) => entry.id === "search_1")?.patch;
  const scheduledJobPatch = patches.find((entry) => entry.id === "scheduled_job_1")?.patch;

  assert.equal(jobPatch?.status, "failed");
  assert.match(String(jobPatch?.error ?? ""), /Timed out/);
  assert.equal(messagePatch?.status, "failed");
  assert.match(String(messagePatch?.content ?? ""), /timed out/i);
  assert.equal(sessionPatch?.status, "failed");
  assert.equal(sessionPatch?.currentPhase, "failed");
  assert.equal(inserts[0]?.table, "jobRuns");
  assert.equal(scheduledJobPatch?.status, "error");
  assert.equal(scheduledJobPatch?.consecutiveFailures, 3);
  assert.equal(scheduledJobPatch?.activeExecutionId, undefined);
  assert.equal(scheduledJobPatch?.scheduledFunctionId, undefined);
  assert.deepEqual(cancelled, ["fn_1"]);
  assert.deepEqual(scheduled, []);
});

test("cleanStale uses the startedAt timestamp for streaming jobs", async () => {
  const now = Date.now();
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

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
      runAfter: async () => undefined,
    },
  }, {});

  assert.equal(patches[0]?.id, "job_streaming");
  assert.equal(patches[0]?.patch.status, "failed");
  assert.equal(patches[1]?.id, "msg_streaming");
  assert.equal(patches[1]?.patch.content, "partial");
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

  assert.deepEqual(followUps, [{ delay: 0 }]);
});
