import assert from "node:assert/strict";
import test from "node:test";

import {
  beginExecution,
  cleanOldJobRuns,
  createJobChat,
  createScheduledExecutionTurn,
  createSearchSession,
  recordRunFailure,
  recordRunSuccess,
  replaceScheduledFunction,
  triggerJobViaApi,
  updateJobInternal,
} from "../scheduledJobs/mutations";

function queryChain(result: {
  first?: unknown;
  collect?: unknown[];
  take?: unknown[];
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
      };
    },
  };
}

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
        if (table === "cachedModels") return queryChain({ first: { _id: "model_1", supportsTools: true } });
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
