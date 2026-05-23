import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  beginExecution,
  cleanOldJobRuns,
  createJob,
  createJobChat,
  createJobTriggerToken,
  createScheduledExecutionTurn,
  createSearchSession,
  deleteApiKey,
  deleteJob,
  pauseJob,
  recordRunFailure,
  recordRunSuccess,
  replaceScheduledFunction,
  resumeJob,
  revokeJobTriggerToken,
  rotateJobTriggerToken,
  triggerJobViaApi,
  updateJobInternal,
  upsertApiKey,
} from "../scheduledJobs/mutations";

function queryChain(result: {
  first?: unknown;
  collect?: unknown[];
  take?: unknown[];
  unique?: unknown;
}) {
  return {
    withIndex: (_index: string, apply?: (q: any) => unknown) => {
      apply?.({
        eq: () => ({ eq: () => ({}) }),
        lt: () => ({}),
      });
      return {
        filter: () => ({
          first: async () => result.first ?? null,
        }),
        first: async () => result.first ?? null,
        collect: async () => result.collect ?? [],
        take: async () => result.take ?? result.collect ?? [],
        unique: async () => result.unique ?? result.first ?? null,
      };
    },
  };
}

function auth(userId = "user_1") {
  return { getUserIdentity: async () => ({ subject: userId }) };
}

test("public scheduled job creation validates inputs and skips scheduling manual jobs", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  const ctx = {
    auth: auth(),
    db: {
      get: async (id: string) => {
        if (id === "folder_1") return { _id: "folder_1", userId: "user_1" };
        if (id === "persona_1") return { _id: "persona_1", userId: "user_1", modelId: "model/tools" };
        return null;
      },
      query: (table: string) => {
        if (table === "purchaseEntitlements") return queryChain({ first: { _id: "ent_1", status: "active" } });
        if (table === "cachedModels") return queryChain({ first: { _id: "model_1", supportsTools: false } });
        if (table === "generatedFiles") return queryChain({ first: { _id: "file_1", userId: "user_1", storageId: "storage_1" } });
        if (table === "fileAttachments") return queryChain({ first: null });
        if (table === "generatedMedia") return queryChain({ first: null });
        return queryChain({});
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return "job_1";
      },
      patch: async () => undefined,
    },
    scheduler: {
      runAt: async (_when: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
        return "sched_1";
      },
    },
  } as any;

  const jobId = await (createJob as any)._handler(ctx, {
    name: "  Manual Digest  ",
    prompt: "Summarize updates",
    modelId: "model/plain",
    personaId: "persona_1",
    targetFolderId: "folder_1",
    enabledIntegrations: ["notion"],
    turnSkillOverrides: [{ skillId: "skill_1", state: "always" }],
    turnIntegrationOverrides: [{ integrationId: "notion", enabled: true }],
    recurrence: { type: "manual" },
    timezone: "UTC",
  });

  assert.equal(jobId, "job_1");
  assert.equal(inserts[0]?.value.name, "Manual Digest");
  assert.equal(inserts[0]?.value.status, "active");
  assert.deepEqual(inserts[0]?.value.enabledIntegrations, []);
  assert.deepEqual(inserts[0]?.value.turnSkillOverrides, []);
  assert.deepEqual(inserts[0]?.value.turnIntegrationOverrides, []);
  assert.deepEqual(scheduled, []);

  await assert.rejects(
    (createJob as any)._handler(ctx, {
      name: "No model",
      recurrence: { type: "manual" },
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "VALIDATION",
  );

  await assert.rejects(
    (createJob as any)._handler(ctx, {
      name: "Wrong folder",
      prompt: "Run",
      modelId: "model/plain",
      recurrence: { type: "manual" },
      targetFolderId: "folder_other",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );
});

test("public scheduled job lifecycle covers idempotent pause/resume/delete and trigger tokens", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  const cancelled: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];
  let jobStatus = "active";
  let jobRunsBatch = 0;

  const ctx = {
    auth: auth(),
    db: {
      get: async (id: string) => {
        if (id === "job_1") {
          return {
            _id: "job_1",
            userId: "user_1",
            status: jobStatus,
            scheduledFunctionId: "sched_old",
            recurrence: { type: "daily", hourUTC: 9, minuteUTC: 30 },
            timezone: "UTC",
          };
        }
        if (id === "token_1") return { _id: "token_1", userId: "user_1", status: "active" };
        if (id === "token_revoked") return { _id: "token_revoked", userId: "user_1", status: "revoked" };
        return null;
      },
      query: (table: string) => {
        if (table === "purchaseEntitlements") return queryChain({ first: { _id: "ent_1", status: "active" } });
        if (table === "scheduledJobTriggerTokens") {
          return queryChain({ collect: [{ _id: "token_old", label: "Daily hook" }] });
        }
        if (table === "jobRuns") {
          jobRunsBatch += 1;
          return queryChain({
            take: jobRunsBatch === 1
              ? Array.from({ length: 100 }, (_, index) => ({ _id: `run_${index}` }))
              : [{ _id: "run_final" }],
          });
        }
        return queryChain({});
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}_${inserts.length}`;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        if (id === "job_1" && typeof patch.status === "string") jobStatus = patch.status;
      },
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
        if (id === "sched_old") throw new Error("already gone");
      },
      runAt: async (_when: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
        return "sched_new";
      },
    },
  } as any;

  await (pauseJob as any)._handler(ctx, { jobId: "job_1" });
  await (pauseJob as any)._handler(ctx, { jobId: "job_1" });
  assert.ok(patches.some((entry) => entry.id === "job_1" && entry.patch.status === "paused"));

  await (resumeJob as any)._handler(ctx, { jobId: "job_1" });
  await (resumeJob as any)._handler(ctx, { jobId: "job_1" });
  assert.ok(patches.some((entry) => entry.id === "job_1" && entry.patch.status === "active" && entry.patch.scheduledFunctionId === "sched_new"));
  assert.deepEqual(scheduled, [{ jobId: "job_1" }]);

  const createdToken = await (createJobTriggerToken as any)._handler(ctx, {
    jobId: "job_1",
    label: "  Daily hook  ",
  });
  assert.equal(createdToken.tokenId, "scheduledJobTriggerTokens_1");
  assert.equal(inserts[0]?.value.label, "Daily hook");

  const rotatedToken = await (rotateJobTriggerToken as any)._handler(ctx, { jobId: "job_1" });
  assert.equal(rotatedToken.tokenId, "scheduledJobTriggerTokens_2");
  assert.ok(patches.some((entry) => entry.id === "token_old" && entry.patch.status === "revoked"));
  assert.equal(inserts[1]?.value.label, "Daily hook");

  await (revokeJobTriggerToken as any)._handler(ctx, { tokenId: "token_1" });
  await (revokeJobTriggerToken as any)._handler(ctx, { tokenId: "token_revoked" });
  assert.ok(patches.some((entry) => entry.id === "token_1" && entry.patch.status === "revoked"));

  await (deleteJob as any)._handler(ctx, { jobId: "job_1" });
  assert.equal(deleted.length, 102);
  assert.equal(deleted.at(-1), "job_1");
  assert.ok(cancelled.includes("sched_old"));
});

test("scheduled job API key mutations validate, upsert, and delete user secrets", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  let secret: Record<string, unknown> | null = null;

  const ctx = {
    auth: auth(),
    db: {
      query: (table: string) => {
        if (table === "userSecrets") return queryChain({ unique: secret });
        return queryChain({});
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        secret = { _id: "secret_1", ...value };
        return "secret_1";
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        secret = { ...(secret ?? {}), ...patch };
      },
      delete: async (id: string) => {
        deleted.push(id);
        secret = null;
      },
    },
  } as any;

  await assert.rejects(
    (upsertApiKey as any)._handler(ctx, { apiKey: "  " }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "VALIDATION",
  );
  await (upsertApiKey as any)._handler(ctx, { apiKey: "sk-first" });
  await (upsertApiKey as any)._handler(ctx, { apiKey: "sk-second" });
  await (deleteApiKey as any)._handler(ctx, {});
  await (deleteApiKey as any)._handler(ctx, {});

  assert.deepEqual(inserts.map((entry) => entry.table), ["userSecrets"]);
  assert.equal(patches[0]?.id, "secret_1");
  assert.equal(patches[0]?.patch.apiKey, "sk-second");
  assert.deepEqual(deleted, ["secret_1"]);
});

test("updateJobInternal validates folders, personas, KB ownership, and reschedules active jobs", async () => {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const cancelled: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "job_1") {
          return {
            _id: "job_1",
            userId: "user_1",
            prompt: "Old prompt",
            modelId: "model/tools",
            enabledIntegrations: ["gmail"],
            recurrence: { type: "daily", hourUTC: 8, minuteUTC: 0 },
            timezone: "UTC",
            status: "active",
            scheduledFunctionId: "sched_old",
            steps: [{ prompt: "Old prompt", modelId: "model/tools" }],
          };
        }
        if (id === "folder_1") return { _id: "folder_1", userId: "user_1" };
        if (id === "persona_1") return { _id: "persona_1", userId: "user_1", modelId: "model/tools" };
        return null;
      },
      query: (table: string) => {
        if (table === "generatedFiles") return queryChain({ first: { _id: "file_1", userId: "user_1", storageId: "storage_1" } });
        if (table === "fileAttachments") return queryChain({ first: null });
        if (table === "generatedMedia") return queryChain({ first: null });
        if (table === "cachedModels") {
          return queryChain({
            first: {
              _id: "model_1",
              supportsTools: true,
              hasZdrEndpoint: true,
              provider: "openai",
            },
          });
        }
        return queryChain({});
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
      },
      runAt: async (_when: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
        return "sched_new";
      },
    },
  } as any;

  await (updateJobInternal as any)._handler(ctx, {
    jobId: "job_1",
    userId: "user_1",
    name: "  New Digest  ",
    targetFolderId: "folder_1",
    timezone: "Europe/London",
    steps: [{
      prompt: "Step one",
      modelId: "model/tools",
      personaId: "persona_1",
      enabledIntegrations: ["gmail"],
      knowledgeBaseFileIds: ["storage_1"],
      searchMode: "web",
      searchComplexity: 9,
    }],
  });

  assert.deepEqual(cancelled, ["sched_old"]);
  assert.deepEqual(scheduled, [{ jobId: "job_1" }]);
  assert.equal(patches[0]?.id, "job_1");
  assert.equal(patches[0]?.patch.name, "New Digest");
  assert.equal(patches[0]?.patch.targetFolderId, "folder_1");
  assert.equal(patches[0]?.patch.scheduledFunctionId, "sched_new");
  assert.equal((patches[0]?.patch.steps as Array<any>)[0].searchComplexity, 3);
});

test("scheduled execution internals create chats, turns, sessions, and lifecycle records", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  let nextId = 0;
  let executionStarted = false;

  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "job_1") {
          return {
            _id: "job_1",
            userId: "user_1",
            status: "active",
            totalRuns: 2,
            activeExecutionId: executionStarted ? "exec_1" : undefined,
            activeExecutionChatId: "chat_1",
            activeStepIndex: undefined,
            activeAssistantMessageId: undefined,
          };
        }
        return null;
      },
      query: (table: string) => {
        if (table === "folders") return queryChain({ first: null });
        if (table === "chatParticipants") return queryChain({ collect: [] });
        return queryChain({});
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}_${++nextId}`;
        inserts.push({ table, value });
        return id;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        if (id === "job_1" && patch.activeExecutionId === "exec_1") {
          executionStarted = true;
        }
        patches.push({ id, patch });
      },
    },
    scheduler: {
      cancel: async () => {},
    },
  } as any;

  assert.deepEqual(await (beginExecution as any)._handler(ctx, {
    jobId: "job_1",
    executionId: "exec_1",
    startedAt: 100,
    stepCount: 2,
    templateVariables: { topic: "coverage" },
  }), { started: true });

  const chatId = await (createJobChat as any)._handler(ctx, {
    jobId: "job_1",
    userId: "user_1",
    jobName: "Digest",
    sourceJobId: "job_1",
    executionId: "exec_1",
  });
  assert.equal(chatId, "chats_2");
  assert.equal(inserts[0]?.table, "folders");
  assert.equal(inserts[1]?.table, "chats");

  const turn = await (createScheduledExecutionTurn as any)._handler(ctx, {
    jobId: "job_1",
    chatId: "chat_1",
    userId: "user_1",
    executionId: "exec_1",
    stepIndex: 0,
    stepTitle: "Research",
    content: "Summarize",
    modelId: "model/tools",
    enabledIntegrations: ["notion"],
  });
  assert.equal(turn.created, true);
  assert.ok(inserts.some((entry) => entry.table === "generationJobs"));

  const searchId = await (createSearchSession as any)._handler(ctx, {
    chatId: "chat_1",
    userId: "user_1",
    assistantMessageId: turn.assistantMsgId,
    query: "nanthai",
    mode: "web",
    complexity: 7,
  });
  assert.equal(searchId, "searchSessions_7");

  await (recordRunSuccess as any)._handler(ctx, { jobId: "job_1", chatId: "chat_1", startedAt: 50 });
  await (recordRunFailure as any)._handler(ctx, {
    jobId: "job_1",
    error: "provider failed",
    consecutiveFailures: 3,
    autoPause: true,
    startedAt: 60,
  });

  assert.ok(patches.some((entry) => entry.patch.lastRunStatus === "success"));
  assert.ok(patches.some((entry) => entry.patch.lastRunStatus === "failed" && entry.patch.status === "error"));
});

test("API trigger idempotency logs duplicates and active triggers, and cleanup continues after full batches", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const deleted: string[] = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const oldRuns = Array.from({ length: 500 }, (_, index) => ({ _id: `run_${index}` }));

  const ctx = {
    db: {
      query: (table: string) => {
        if (table === "scheduledJobApiInvocations") {
          return queryChain({ first: { _id: "inv_1", requestId: "req_old" } });
        }
        if (table === "jobRuns") return queryChain({ take: oldRuns });
        return queryChain({});
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}_new`;
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
      },
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push(payload);
        return "sched_api";
      },
      cancel: async () => {},
    },
  } as any;

  const duplicate = await (triggerJobViaApi as any)._handler(ctx, {
    jobId: "job_1",
    userId: "user_1",
    requestId: "req_1",
    idempotencyKey: " idem ",
  });
  assert.equal(duplicate.duplicate, true);

  ctx.db.query = (table: string) => {
    if (table === "scheduledJobApiInvocations") return queryChain({ first: null });
    if (table === "jobRuns") return queryChain({ take: oldRuns });
    return queryChain({});
  };

  const triggered = await (triggerJobViaApi as any)._handler(ctx, {
    jobId: "job_1",
    userId: "user_1",
    tokenId: "token_1",
    requestId: "req_2",
    idempotencyKey: "idem-2",
    variables: { customer: "Ada" },
  });
  assert.equal(triggered.triggered, true);
  assert.ok(patches.some((entry) => entry.id === "token_1" && entry.patch.lastUsedAt));

  await (replaceScheduledFunction as any)._handler(ctx, {
    jobId: "job_1",
    nextRunAt: 123,
    scheduledFunctionId: "sched_new",
    previousScheduledFunctionId: "sched_old",
  });
  await (cleanOldJobRuns as any)._handler(ctx, {});

  assert.equal(deleted.length, 5000);
  assert.ok(scheduled.length >= 2);
  assert.ok(inserts.some((entry) => entry.value.status === "duplicate"));
  assert.ok(inserts.some((entry) => entry.value.status === "triggered"));
});
