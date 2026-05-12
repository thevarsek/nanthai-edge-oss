import assert from "node:assert/strict";
import test from "node:test";

import {
  createJob,
  createJobTriggerToken,
  deleteApiKey,
  deleteJob,
  pauseJob,
  resumeJob,
  revokeJobTriggerToken,
  rotateJobTriggerToken,
  runJobNow,
  updateJob,
  upsertApiKey,
} from "../scheduledJobs/mutations";

type Row = Record<string, any>;

function buildCtx(options?: {
  records?: Record<string, Row>;
  tableRows?: Record<string, Row[]>;
  cancelThrows?: boolean;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const inserts: Array<{ table: string; value: Row; id: string }> = [];
  const patches: Array<{ id: string; value: Row }> = [];
  const deletes: string[] = [];
  const cancelled: string[] = [];
  const scheduledAt: Array<{ at: number; args: Row }> = [];
  const scheduledAfter: Array<{ delay: number; args: Row }> = [];

  const rowsFor = (table: string) => tableRows.get(table) ?? [];
  const chainFor = (table: string) => {
    const chain = {
      withIndex: (_index: string, apply?: (q: any) => unknown) => {
        const q = { eq: () => q, lt: () => q, field: (name: string) => name };
        apply?.(q);
        return chain;
      },
      filter: () => chain,
      first: async () => rowsFor(table)[0] ?? null,
      unique: async () => rowsFor(table)[0] ?? null,
      collect: async () => rowsFor(table),
      take: async (count: number) => {
        const rows = rowsFor(table);
        if (table !== "jobRuns") return rows.slice(0, count);
        const batch = rows.splice(0, count);
        tableRows.set(table, rows);
        return batch;
      },
    };
    return chain;
  };

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => records.get(id) ?? null,
      query: (table: string) => chainFor(table),
      insert: async (table: string, value: Row) => {
        const id = `${table}_${inserts.length + 1}`;
        const row = { _id: id, ...value };
        inserts.push({ table, value, id });
        records.set(id, row);
        tableRows.set(table, [...rowsFor(table), row]);
        return id;
      },
      patch: async (id: string, value: Row) => {
        patches.push({ id, value });
        records.set(id, { ...(records.get(id) ?? { _id: id }), ...value });
      },
      delete: async (id: string) => {
        deletes.push(id);
        records.delete(id);
      },
    },
    scheduler: {
      runAt: async (at: number, _fn: unknown, args: Row) => {
        scheduledAt.push({ at, args });
        return `scheduled_at_${scheduledAt.length}`;
      },
      runAfter: async (delay: number, _fn: unknown, args: Row) => {
        scheduledAfter.push({ delay, args });
        return `scheduled_after_${scheduledAfter.length}`;
      },
      cancel: async (id: string) => {
        cancelled.push(id);
        if (options?.cancelThrows) throw new Error("already settled");
      },
    },
  } as any;

  return { ctx, inserts, patches, deletes, cancelled, scheduledAt, scheduledAfter };
}

function proRows() {
  return {
    purchaseEntitlements: [{ _id: "ent_1", userId: "user_1", status: "active" }],
  };
}

test("public scheduled job create and update validate ownership and reschedule changed recurrences", async () => {
  const invalidFolder = buildCtx({
    records: { folder_1: { _id: "folder_1", userId: "other_user" } },
    tableRows: proRows(),
  });
  await assert.rejects(
    (createJob as any)._handler(invalidFolder.ctx, {
      name: "Digest",
      prompt: "Summarize the week",
      modelId: "model_tools",
      recurrence: { type: "manual" },
      targetFolderId: "folder_1",
    }),
    /Target folder not found/,
  );
  assert.equal(invalidFolder.inserts.length, 0);

  const created = buildCtx({
    records: { folder_1: { _id: "folder_1", userId: "user_1" } },
    tableRows: proRows(),
  });
  const jobId = await (createJob as any)._handler(created.ctx, {
    name: " Daily Digest ",
    prompt: "Summarize updates",
    modelId: "model_tools",
    recurrence: { type: "interval", minutes: 30 },
    targetFolderId: "folder_1",
    searchComplexity: 9,
  });
  assert.equal(jobId, "scheduledJobs_1");
  assert.equal(created.inserts[0]?.value.name, "Daily Digest");
  assert.equal(created.inserts[0]?.value.searchComplexity, 3);
  assert.deepEqual(created.scheduledAt[0]?.args, { jobId: "scheduledJobs_1" });
  assert.equal(created.patches[0]?.value.scheduledFunctionId, "scheduled_at_1");

  const updated = buildCtx({
    records: {
      job_1: {
        _id: "job_1",
        userId: "user_1",
        name: "Digest",
        prompt: "Old",
        modelId: "model_tools",
        recurrence: { type: "interval", minutes: 30 },
        timezone: "UTC",
        status: "active",
        scheduledFunctionId: "old_sched",
      },
    },
    tableRows: proRows(),
    cancelThrows: true,
  });
  await (updateJob as any)._handler(updated.ctx, {
    jobId: "job_1",
    name: "Updated",
    prompt: "New",
    modelId: "model_tools",
    recurrence: { type: "interval", minutes: 45 },
    timezone: "Europe/London",
    targetFolderId: null,
  });
  assert.deepEqual(updated.cancelled, ["old_sched"]);
  assert.equal(updated.patches[0]?.value.targetFolderId, undefined);
  assert.equal(updated.patches[0]?.value.scheduledFunctionId, "scheduled_at_1");
});

test("scheduled job pause resume run-now and delete preserve lifecycle invariants", async () => {
  const pause = buildCtx({
    records: {
      job_1: { _id: "job_1", userId: "user_1", status: "active", scheduledFunctionId: "sched_1" },
    },
    tableRows: proRows(),
    cancelThrows: true,
  });
  await (pauseJob as any)._handler(pause.ctx, { jobId: "job_1" });
  assert.deepEqual(pause.cancelled, ["sched_1"]);
  assert.equal(pause.patches[0]?.value.status, "paused");

  const resume = buildCtx({
    records: {
      job_1: {
        _id: "job_1",
        userId: "user_1",
        status: "error",
        recurrence: { type: "daily", hourUTC: 23, minuteUTC: 55 },
      },
    },
    tableRows: proRows(),
  });
  await (resumeJob as any)._handler(resume.ctx, { jobId: "job_1" });
  assert.equal(resume.patches[0]?.value.status, "active");
  assert.equal(resume.patches[0]?.value.consecutiveFailures, 0);
  assert.equal(resume.patches[0]?.value.scheduledFunctionId, "scheduled_at_1");

  const runNow = buildCtx({
    records: {
      pausedManual: { _id: "pausedManual", userId: "user_1", status: "paused", recurrence: { type: "manual" } },
      pausedInterval: { _id: "pausedInterval", userId: "user_1", status: "paused", recurrence: { type: "interval", minutes: 30 } },
    },
    tableRows: proRows(),
  });
  await assert.rejects(
    (runJobNow as any)._handler(runNow.ctx, { jobId: "pausedManual" }),
    /Cannot run a paused manual job/,
  );
  const started = await (runJobNow as any)._handler(runNow.ctx, { jobId: "pausedInterval" });
  assert.equal(started.triggered, true);
  assert.deepEqual(runNow.scheduledAfter[0]?.args, { jobId: "pausedInterval", invocationSource: "manual" });

  const rows = Array.from({ length: 101 }, (_, index) => ({ _id: `run_${index}` }));
  const deletion = buildCtx({
    records: {
      job_1: { _id: "job_1", userId: "user_1", scheduledFunctionId: "sched_2" },
    },
    tableRows: { ...proRows(), jobRuns: rows },
  });
  await (deleteJob as any)._handler(deletion.ctx, { jobId: "job_1" });
  assert.equal(deletion.cancelled[0], "sched_2");
  assert.equal(deletion.deletes.length, 102);
  assert.equal(deletion.deletes.at(-1), "job_1");
});

test("scheduled job trigger tokens and API keys handle rotation, revocation, and storage branches", async () => {
  const tokens = buildCtx({
    records: {
      job_1: { _id: "job_1", userId: "user_1" },
      token_revoked: { _id: "token_revoked", userId: "user_1", status: "revoked" },
      token_active: { _id: "token_active", userId: "user_1", status: "active" },
    },
    tableRows: {
      ...proRows(),
      scheduledJobTriggerTokens: [
        { _id: "token_1", userId: "user_1", jobId: "job_1", status: "active", label: "Existing" },
      ],
    },
  });
  const created = await (createJobTriggerToken as any)._handler(tokens.ctx, {
    jobId: "job_1",
    label: "  Deploy hook  ",
  });
  assert.equal(created.tokenId, "scheduledJobTriggerTokens_1");
  assert.equal(tokens.inserts[0]?.value.label, "Deploy hook");

  const rotated = await (rotateJobTriggerToken as any)._handler(tokens.ctx, { jobId: "job_1" });
  assert.equal(rotated.tokenId, "scheduledJobTriggerTokens_2");
  assert.equal(tokens.patches[0]?.value.status, "revoked");
  assert.equal(tokens.inserts[1]?.value.label, "Existing");

  await (revokeJobTriggerToken as any)._handler(tokens.ctx, { tokenId: "token_revoked" });
  await (revokeJobTriggerToken as any)._handler(tokens.ctx, { tokenId: "token_active" });
  assert.equal(tokens.patches.at(-1)?.id, "token_active");

  await assert.rejects(
    (upsertApiKey as any)._handler(tokens.ctx, { apiKey: " " }),
    /API key cannot be empty/,
  );

  const secrets = buildCtx({
    tableRows: { userSecrets: [{ _id: "secret_1", userId: "user_1", apiKey: "old" }] },
  });
  await (upsertApiKey as any)._handler(secrets.ctx, { apiKey: "sk-new" });
  await (deleteApiKey as any)._handler(secrets.ctx, {});
  assert.equal(secrets.patches[0]?.id, "secret_1");
  assert.equal(secrets.deletes[0], "secret_1");
});
