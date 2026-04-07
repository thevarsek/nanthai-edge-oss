import assert from "node:assert/strict";
import test from "node:test";

import {
  createScheduledJob,
  deleteScheduledJob,
  listScheduledJobs,
} from "../tools/scheduled_jobs";

test("createScheduledJob blocks free users", async () => {
  const result = await createScheduledJob.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => false,
      },
    } as any,
    {
      name: "Morning Summary",
      prompt: "Summarize my inbox.",
      recurrence: { type: "daily", hourUTC: 8, minuteUTC: 0 },
    },
  );

  assert.equal(result.success, false);
  assert.match(result.error ?? "", /Pro feature/i);
});

test("createScheduledJob resolves the user's default model and returns a schedule summary", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let queryCount = 0;

  const result = await createScheduledJob.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => {
          queryCount += 1;
          if (queryCount === 1) return true;
          return "anthropic/claude-sonnet-4";
        },
        runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
          mutations.push(args);
          return "job_1";
        },
      },
    } as any,
    {
      name: "Morning Summary",
      prompt: "Summarize my inbox.",
      recurrence: { type: "daily", hourUTC: 8, minuteUTC: 0 },
      enabledIntegrations: ["gmail"],
      webSearchEnabled: true,
    },
  );

  assert.equal(result.success, true);
  assert.equal(mutations[0]?.modelId, "anthropic/claude-sonnet-4");
  assert.equal((result.data as any).schedule, "daily at 08:00 UTC");
  assert.match((result.data as any).message, /Created scheduled job "Morning Summary"/);
});

test("listScheduledJobs summarizes schedules and totals", async () => {
  const result = await listScheduledJobs.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => [
          {
            _id: "job_1",
            name: "Inbox Summary",
            status: "active",
            recurrence: { type: "weekly", dayOfWeek: 1, hourUTC: 9, minuteUTC: 30 },
            nextRunAt: Date.UTC(2026, 3, 8, 9, 30, 0),
            lastRunAt: null,
            lastRunStatus: null,
            totalRuns: 2,
            createdBy: "ai",
          },
        ],
      },
    } as any,
    {},
  );

  assert.equal(result.success, true);
  assert.equal((result.data as any).count, 1);
  assert.equal((result.data as any).jobs[0].schedule, "weekly on Monday at 09:30 UTC");
});

test("deleteScheduledJob resolves jobs by name and reports ambiguity", async () => {
  const result = await deleteScheduledJob.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => [
          { _id: "job_1", name: "Morning Summary" },
          { _id: "job_2", name: "Morning Briefing" },
        ],
      },
    } as any,
    { jobName: "morning" },
  );

  assert.equal(result.success, false);
  assert.deepEqual((result.data as any).ambiguousMatches, [
    "Morning Summary",
    "Morning Briefing",
  ]);
});

test("deleteScheduledJob deletes a uniquely resolved job", async () => {
  const deleted: Array<Record<string, unknown>> = [];

  const result = await deleteScheduledJob.execute(
    {
      userId: "user_1",
      ctx: {
        runQuery: async () => [{ _id: "job_1", name: "Morning Summary" }],
        runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
          deleted.push(args);
        },
      },
    } as any,
    { jobName: "summary" },
  );

  assert.equal(result.success, true);
  assert.deepEqual(deleted, [{ jobId: "job_1", userId: "user_1" }]);
  assert.equal((result.data as any).deletedJobName, "Morning Summary");
});
