import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  cancelScheduledFunction,
  createJobChat,
  createScheduledExecutionTurn,
  createSearchSession,
  logApiInvocation,
  replaceScheduledFunction,
} from "../scheduledJobs/mutations";

function buildCtx(options?: {
  records?: Record<string, Record<string, unknown>>;
  tableRows?: Record<string, Array<Record<string, unknown>>>;
  cancelThrows?: boolean;
}) {
  const records = new Map(Object.entries(options?.records ?? {}));
  const tableRows = new Map(Object.entries(options?.tableRows ?? {}));
  const inserts: Array<{ table: string; value: Record<string, unknown>; id: string }> = [];
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const cancelled: string[] = [];

  const chainFor = (table: string) => {
    const chain = {
      withIndex: (_index: string, apply?: (q: any) => unknown) => {
        const q = { eq: () => q, lt: () => q, field: (name: string) => name };
        apply?.(q);
        return chain;
      },
      filter: (_apply?: (q: any) => unknown) => chain,
      first: async () => (tableRows.get(table) ?? [])[0] ?? null,
      collect: async () => tableRows.get(table) ?? [],
      take: async () => tableRows.get(table) ?? [],
    };
    return chain;
  };

  const ctx = {
    db: {
      get: async (id: string) => records.get(id) ?? null,
      query: (table: string) => chainFor(table),
      insert: async (table: string, value: Record<string, unknown>) => {
        const id = `${table}_${inserts.length + 1}`;
        const row = { _id: id, ...value };
        inserts.push({ table, value, id });
        records.set(id, row);
        tableRows.set(table, [...(tableRows.get(table) ?? []), row]);
        return id;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
        records.set(id, { ...(records.get(id) ?? { _id: id }), ...value });
      },
    },
    scheduler: {
      cancel: async (id: string) => {
        cancelled.push(id);
        if (options?.cancelThrows) throw new Error("already settled");
      },
    },
  } as never;

  return { ctx, inserts, patches, cancelled };
}

test("createJobChat rejects missing jobs and honors an owned target folder", async () => {
  await assert.rejects(
    (createJobChat as any)._handler(buildCtx().ctx, {
      jobId: "job_missing",
      userId: "user_1",
      jobName: "Digest",
      sourceJobId: "job_missing",
      executionId: "exec_1",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );

  const ownedFolder = buildCtx({
    records: {
      job_1: { _id: "job_1", activeExecutionId: "exec_1" },
      folder_1: { _id: "folder_1", userId: "user_1" },
    },
  });
  const chatId = await (createJobChat as any)._handler(ownedFolder.ctx, {
    jobId: "job_1",
    userId: "user_1",
    jobName: "Weekly Digest",
    targetFolderId: "folder_1",
    sourceJobId: "job_1",
    executionId: "exec_1",
  });

  assert.equal(chatId, "chats_1");
  assert.equal(ownedFolder.inserts[0]?.table, "chats");
  assert.equal(ownedFolder.inserts[0]?.value.folderId, "folder_1");
  assert.equal(ownedFolder.patches[0]?.value.lastRunChatId, "chats_1");
});

test("scheduled execution turn guards stale, mismatched, and duplicate step creation", async () => {
  const baseArgs = {
    jobId: "job_1",
    chatId: "chat_1",
    userId: "user_1",
    executionId: "exec_1",
    stepIndex: 0,
    stepTitle: "Research",
    content: "Run",
    modelId: "model_a",
  };

  await assert.rejects(
    (createScheduledExecutionTurn as any)._handler(buildCtx().ctx, baseArgs),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "NOT_FOUND",
  );

  const stale = buildCtx({
    records: { job_1: { _id: "job_1", activeExecutionId: "exec_2", activeExecutionChatId: "chat_1" } },
  });
  await assert.rejects(
    (createScheduledExecutionTurn as any)._handler(stale.ctx, baseArgs),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "EXECUTION_STALE",
  );

  const mismatch = buildCtx({
    records: { job_1: { _id: "job_1", activeExecutionId: "exec_1", activeExecutionChatId: "chat_2" } },
  });
  await assert.rejects(
    (createScheduledExecutionTurn as any)._handler(mismatch.ctx, baseArgs),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "EXECUTION_MISMATCH",
  );

  const duplicateWithoutIds = buildCtx({
    records: { job_1: { _id: "job_1", activeExecutionId: "exec_1", activeExecutionChatId: "chat_1", activeStepIndex: 0 } },
  });
  await assert.rejects(
    (createScheduledExecutionTurn as any)._handler(duplicateWithoutIds.ctx, baseArgs),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "DUPLICATE_STEP",
  );
});

test("scheduled search sessions clamp complexity and choose the correct initial phase", async () => {
  const simple = buildCtx();
  const simpleId = await (createSearchSession as any)._handler(simple.ctx, {
    chatId: "chat_1",
    userId: "user_1",
    assistantMessageId: "assistant_1",
    query: "latest filings",
    mode: "web",
    complexity: 0,
  });

  assert.equal(simpleId, "searchSessions_1");
  assert.equal(simple.inserts[0]?.value.complexity, 1);
  assert.equal(simple.inserts[0]?.value.status, "searching");
  assert.equal(simple.inserts[0]?.value.currentPhase, "searching");
  assert.equal(simple.patches[0]?.id, "assistant_1");

  const research = buildCtx();
  await (createSearchSession as any)._handler(research.ctx, {
    chatId: "chat_1",
    userId: "user_1",
    assistantMessageId: "assistant_2",
    query: "peer reviewed synthesis",
    mode: "paper",
    complexity: 10,
  });

  assert.equal(research.inserts[0]?.value.complexity, 3);
  assert.equal(research.inserts[0]?.value.status, "planning");
  assert.equal(research.inserts[0]?.value.currentPhase, "planning");
});

test("scheduled function replacement, cancellation, and API audit logging handle settled scheduler state", async () => {
  const replacement = buildCtx({ cancelThrows: true });
  await (replaceScheduledFunction as any)._handler(replacement.ctx, {
    jobId: "job_1",
    nextRunAt: 123,
    scheduledFunctionId: "sched_new",
    previousScheduledFunctionId: "sched_old",
  });
  assert.deepEqual(replacement.cancelled, ["sched_old"]);
  assert.equal(replacement.patches[0]?.value.scheduledFunctionId, "sched_new");

  const sameId = buildCtx();
  await (replaceScheduledFunction as any)._handler(sameId.ctx, {
    jobId: "job_1",
    nextRunAt: 456,
    scheduledFunctionId: "sched_same",
    previousScheduledFunctionId: "sched_same",
  });
  assert.deepEqual(sameId.cancelled, []);

  const cancellation = buildCtx({ cancelThrows: true });
  await (cancelScheduledFunction as any)._handler(cancellation.ctx, {
    jobId: "job_1",
    scheduledFunctionId: "sched_settled",
  });
  assert.deepEqual(cancellation.cancelled, ["sched_settled"]);
  assert.equal(cancellation.patches[0]?.value.scheduledFunctionId, undefined);

  const audit = buildCtx();
  await (logApiInvocation as any)._handler(audit.ctx, {
    userId: "user_1",
    jobId: "job_1",
    tokenId: "token_1",
    requestId: "req_1",
    idempotencyKey: "   ",
    status: "error",
    variables: { topic: "sales" },
    note: "provider error",
  });

  assert.equal(audit.inserts[0]?.table, "scheduledJobApiInvocations");
  assert.equal(audit.inserts[0]?.value.idempotencyKey, undefined);
  assert.equal(audit.inserts[0]?.value.status, "error");
});
