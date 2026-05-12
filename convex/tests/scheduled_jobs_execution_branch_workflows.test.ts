import assert from "node:assert/strict";
import test from "node:test";

import { ConvexError } from "convex/values";
import {
  createAssistantAndJob,
  createJobChat,
  createScheduledExecutionTurn,
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
  const scheduled: Array<{ delay?: number; when?: number; payload: Record<string, unknown> }> = [];

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
      runAfter: async (delay: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push({ delay, payload });
        return `scheduled_${scheduled.length}`;
      },
      runAt: async (when: number, _ref: unknown, payload: Record<string, unknown>) => {
        scheduled.push({ when, payload });
        return `scheduled_${scheduled.length}`;
      },
      cancel: async (id: string) => {
        cancelled.push(id);
        if (options?.cancelThrows) throw new Error("already settled");
      },
    },
  } as never;

  return { ctx, records, tableRows, inserts, patches, cancelled, scheduled };
}

test("createJobChat rejects stale executions and falls back to the Scheduled folder", async () => {
  const stale = buildCtx({
    records: {
      job_1: { _id: "job_1", activeExecutionId: "newer" },
    },
  });
  await assert.rejects(
    (createJobChat as any)._handler(stale.ctx, {
      jobId: "job_1",
      userId: "user_1",
      jobName: "Digest",
      sourceJobId: "job_1",
      executionId: "old",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "EXECUTION_STALE",
  );

  const existingFolder = buildCtx({
    records: {
      job_1: { _id: "job_1", activeExecutionId: "exec_1" },
      folder_wrong: { _id: "folder_wrong", userId: "user_2" },
    },
    tableRows: {
      folders: [{ _id: "folder_scheduled", userId: "user_1", name: "Scheduled" }],
    },
  });
  const chatId = await (createJobChat as any)._handler(existingFolder.ctx, {
    jobId: "job_1",
    userId: "user_1",
    jobName: "Daily Digest",
    targetFolderId: "folder_wrong",
    sourceJobId: "job_1",
    executionId: "exec_1",
  });

  assert.equal(chatId, "chats_1");
  assert.equal(existingFolder.inserts[0]?.table, "chats");
  assert.equal(existingFolder.inserts[0]?.value.folderId, "folder_scheduled");
  assert.equal(existingFolder.patches[0]?.value.activeExecutionChatId, "chats_1");

  const createFolder = buildCtx({
    records: { job_2: { _id: "job_2", activeExecutionId: "exec_2" } },
    tableRows: { folders: [] },
  });
  await (createJobChat as any)._handler(createFolder.ctx, {
    jobId: "job_2",
    userId: "user_1",
    jobName: "Weekly Digest",
    sourceJobId: "job_2",
    executionId: "exec_2",
  });
  assert.equal(createFolder.inserts[0]?.table, "folders");
  assert.equal(createFolder.inserts[1]?.value.folderId, "folders_1");
});

test("assistant/job creation and scheduled execution turns dedupe participants and enforce step ordering", async () => {
  const assistantCtx = buildCtx({
    tableRows: {
      chatParticipants: [
        { _id: "participant_1", modelId: "model_a", personaId: "persona_a" },
      ],
    },
  });
  const existingParticipant = await (createAssistantAndJob as any)._handler(assistantCtx.ctx, {
    chatId: "chat_1",
    userId: "user_1",
    modelId: "model_a",
    userMessageId: "message_user",
    personaId: "persona_a",
    personaName: "Analyst",
    enabledIntegrations: ["gmail"],
    sourceJobId: "job_1",
    sourceExecutionId: "exec_1",
    sourceStepIndex: 0,
    sourceStepTitle: "Research",
  });
  assert.equal(existingParticipant.assistantMsgId, "messages_1");
  assert.equal(assistantCtx.inserts.filter((insert) => insert.table === "chatParticipants").length, 0);

  await (createAssistantAndJob as any)._handler(assistantCtx.ctx, {
    chatId: "chat_1",
    userId: "user_1",
    modelId: "model_b",
    userMessageId: "message_user",
  });
  assert.equal(assistantCtx.inserts.filter((insert) => insert.table === "chatParticipants").length, 1);

  const duplicate = buildCtx({
    records: {
      job_1: {
        _id: "job_1",
        activeExecutionId: "exec_1",
        activeExecutionChatId: "chat_1",
        activeStepIndex: 0,
        activeUserMessageId: "message_user",
        activeAssistantMessageId: "message_assistant",
        activeGenerationJobId: "gen_1",
      },
    },
  });
  const duplicateResult = await (createScheduledExecutionTurn as any)._handler(duplicate.ctx, {
    jobId: "job_1",
    chatId: "chat_1",
    userId: "user_1",
    executionId: "exec_1",
    stepIndex: 0,
    stepTitle: "Research",
    content: "Run",
    modelId: "model_a",
  });
  assert.deepEqual(duplicateResult, {
    userMessageId: "message_user",
    assistantMsgId: "message_assistant",
    genJobId: "gen_1",
    created: false,
  });

  const outOfOrder = buildCtx({
    records: {
      job_2: {
        _id: "job_2",
        activeExecutionId: "exec_2",
        activeExecutionChatId: "chat_2",
        activeStepIndex: 0,
      },
    },
  });
  await assert.rejects(
    (createScheduledExecutionTurn as any)._handler(outOfOrder.ctx, {
      jobId: "job_2",
      chatId: "chat_2",
      userId: "user_1",
      executionId: "exec_2",
      stepIndex: 2,
      stepTitle: "Skipped",
      content: "Run",
      modelId: "model_a",
    }),
    (error: unknown) => error instanceof ConvexError && error.data?.code === "STEP_ORDER",
  );

  const createTurn = buildCtx({
    records: {
      job_3: {
        _id: "job_3",
        activeExecutionId: "exec_3",
        activeExecutionChatId: "chat_3",
        activeStepIndex: 0,
        activeAssistantMessageId: "previous_assistant",
      },
    },
    tableRows: { chatParticipants: [] },
  });
  const created = await (createScheduledExecutionTurn as any)._handler(createTurn.ctx, {
    jobId: "job_3",
    chatId: "chat_3",
    userId: "user_1",
    executionId: "exec_3",
    stepIndex: 1,
    stepTitle: "Second",
    content: "Continue",
    modelId: "model_a",
  });
  assert.equal(created.created, true);
  assert.deepEqual(createTurn.inserts[0]?.value.parentMessageIds, ["previous_assistant"]);
  assert.equal(createTurn.patches[0]?.value.activeStepIndex, 1);
});
