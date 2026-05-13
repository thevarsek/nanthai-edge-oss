import assert from "node:assert/strict";
import test from "node:test";

import {
  createScheduledJob,
  deleteScheduledJob,
  listScheduledJobs,
} from "../tools/scheduled_jobs";

function toolCtx(options: {
  pro?: boolean;
  queries?: unknown[];
  mutationResult?: unknown;
  mutationThrows?: unknown;
  queryThrows?: unknown;
} = {}) {
  const queries = [...(options.queries ?? [])];
  const mutations: Array<Record<string, unknown>> = [];
  return {
    mutations,
    ctx: {
      userId: "user_1",
      ctx: {
        runQuery: async () => {
          if (options.queryThrows !== undefined) throw options.queryThrows;
          if (queries.length > 0) return queries.shift();
          return options.pro ?? true;
        },
        runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
          mutations.push(args);
          if (options.mutationThrows !== undefined) throw options.mutationThrows;
          return options.mutationResult ?? "job_1";
        },
      },
    } as any,
  };
}

test("createScheduledJob validates prompt, recurrence, and default model requirements", async () => {
  const missingName = await createScheduledJob.execute(toolCtx({ pro: true }).ctx, {
    name: " ",
    prompt: "Run",
    recurrence: { type: "manual" },
    modelId: "model_1",
  });
  assert.equal(missingName.success, false);
  assert.match(String(missingName.error), /name/);

  const missingPrompt = await createScheduledJob.execute(toolCtx({ pro: true }).ctx, {
    name: "Manual report",
    recurrence: { type: "manual" },
    modelId: "model_1",
  });
  assert.equal(missingPrompt.success, false);
  assert.match(String(missingPrompt.error), /prompt/);

  const missingRecurrence = await createScheduledJob.execute(toolCtx({ pro: true }).ctx, {
    name: "Manual report",
    prompt: "Run",
    modelId: "model_1",
  });
  assert.equal(missingRecurrence.success, false);
  assert.match(String(missingRecurrence.error), /recurrence/);

  const missingDefault = await createScheduledJob.execute(toolCtx({
    queries: [true, null],
  }).ctx, {
    name: "Manual report",
    prompt: "Run",
    recurrence: { type: "manual" },
  });
  assert.equal(missingDefault.success, false);
  assert.match(String(missingDefault.error), /No model specified/);
});

test("createScheduledJob maps rich step fields and reports mutation failures", async () => {
  const state = toolCtx({ queries: [true], mutationResult: "job_42" });
  const created = await createScheduledJob.execute(state.ctx, {
    name: "Research pipeline",
    recurrence: { type: "cron", expression: "0 8 * * 1-5" },
    steps: [{
      title: "Collect",
      prompt: "Collect inputs",
      modelId: "model_1",
      personaId: "persona_1",
      enabledIntegrations: ["gmail"],
      turnSkillOverrides: [{ skillId: "skill_1", state: "always" }],
      turnIntegrationOverrides: [{ integrationId: "gmail", enabled: true }],
      webSearchEnabled: true,
      searchMode: "invalid",
      searchComplexity: 2,
      knowledgeBaseFileIds: ["file_1"],
      includeReasoning: true,
      reasoningEffort: "high",
    }],
  });
  assert.equal(created.success, true);
  assert.equal((created.data as any).schedule, "cron: 0 8 * * 1-5");
  assert.equal((state.mutations[0].steps as any[])[0].searchMode, undefined);
  assert.deepEqual((state.mutations[0].steps as any[])[0].turnIntegrationOverrides, [{
    integrationId: "gmail",
    enabled: true,
  }]);

  const failed = await createScheduledJob.execute(toolCtx({
    queries: [true],
    mutationThrows: "write offline",
  }).ctx, {
    name: "Manual report",
    prompt: "Run",
    modelId: "model_1",
    recurrence: { type: "manual" },
  });
  assert.equal(failed.success, false);
  assert.match(String(failed.error), /write offline/);
});

test("listScheduledJobs covers empty, plural, manual, unknown, and failure summaries", async () => {
  const empty = await listScheduledJobs.execute(toolCtx({ queries: [[]] }).ctx, {});
  assert.equal(empty.success, true);
  assert.deepEqual((empty.data as any).jobs, []);

  const listed = await listScheduledJobs.execute(toolCtx({
    queries: [[
      { _id: "job_1", name: "Manual", status: "active", recurrence: { type: "manual" } },
      { _id: "job_2", name: "Odd", status: "active", recurrence: { type: "yearly" }, totalRuns: 3 },
    ]],
  }).ctx, {});
  assert.equal(listed.success, true);
  assert.equal((listed.data as any).message, "Found 2 scheduled jobs.");
  assert.deepEqual((listed.data as any).jobs.map((job: any) => job.schedule), [
    "manual (Run Now only)",
    "unknown schedule",
  ]);

  const failed = await listScheduledJobs.execute(toolCtx({ queryThrows: new Error("read failed") }).ctx, {});
  assert.equal(failed.success, false);
  assert.match(String(failed.error), /read failed/);
});

test("deleteScheduledJob handles direct lookup misses, name misses, and delete failures", async () => {
  const missingId = await deleteScheduledJob.execute(toolCtx({ queries: [[]] }).ctx, {
    jobId: "job_missing",
  });
  assert.equal(missingId.success, false);
  assert.match(String(missingId.error), /job_missing/);

  const missingName = await deleteScheduledJob.execute(toolCtx({
    queries: [[{ _id: "job_1", name: "Inbox" }]],
  }).ctx, { jobName: "calendar" });
  assert.equal(missingName.success, false);
  assert.match(String(missingName.error), /No scheduled job found/);

  const failed = await deleteScheduledJob.execute(toolCtx({
    queries: [[{ _id: "job_1", name: "Inbox" }]],
    mutationThrows: "delete offline",
  }).ctx, { jobId: "job_1" });
  assert.equal(failed.success, false);
  assert.match(String(failed.error), /delete offline/);
});
