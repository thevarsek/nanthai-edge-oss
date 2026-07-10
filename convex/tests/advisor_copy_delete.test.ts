import assert from "node:assert/strict";
import test from "node:test";
import { copyAdvisorData } from "../advisors/copy";
import { deleteChatAdvisorDataBatch } from "../chat/manage_advisor_delete_helpers";
import {
  deleteUserAdvisorBatchesBatch,
  deleteUserAdvisorRunsBatch,
} from "../account/mutations_advisor_cleanup";

type TestRow = Record<string, unknown>;

test("chat copy remaps kept Advisors, terminal history, and every retry reference", async () => {
  const sourceBatch = {
    _id: "batch_old",
    userId: "user_1",
    chatId: "chat_old",
    userMessageId: "user_old",
    assistantMessageIds: ["assistant_old"],
    status: "failed",
    expectedRunCount: 1,
    completedRunCount: 0,
    failedRunCount: 1,
    generationSnapshot: {},
    createdAt: 1,
    updatedAt: 2,
  };
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const rows: Record<string, TestRow[]> = {
    chatAdvisors: [{
      personaId: "persona_1",
      instanceName: "persona_1",
      sortOrder: 0,
      allowWebSearch: true,
    }],
    advisorBatches: [sourceBatch],
    advisorRuns: [{
      _id: "run_old",
      batchId: "batch_old",
      userId: "user_1",
      chatId: "chat_old",
      userMessageId: "user_old",
      personaId: "persona_1",
      personaSnapshot: { displayName: "Reviewer" },
      instanceName: "persona_1",
      sortOrder: 0,
      status: "failed",
      stage: "failed",
      allowWebSearch: true,
      resolvedInstructions: "Advise",
      requestedModelId: "model",
      errorCode: "INTERNAL_ERROR",
      errorMessage: "SDKValidationError rawValue PRIVATE_PROMPT_SENTINEL",
      createdAt: 1,
      updatedAt: 2,
    }],
    messages: [
      { _id: "assistant_old", advisorBatchId: "batch_old" },
      { _id: "retry_old", advisorBatchId: "batch_old" },
    ],
  };
  await copyAdvisorData({
    db: {
      query: (table: string) => ({
        withIndex: () => ({ collect: async () => rows[table] ?? [] }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserted.push({ table, value });
        return table === "advisorBatches" ? "batch_new" : `${table}_new`;
      },
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
    },
  } as unknown as Parameters<typeof copyAdvisorData>[0], {
    sourceChatId: "chat_old" as Parameters<typeof copyAdvisorData>[1]["sourceChatId"],
    targetChatId: "chat_new" as Parameters<typeof copyAdvisorData>[1]["targetChatId"],
    userId: "user_1",
    messageIdMap: new Map([
      ["user_old", "user_new"],
      ["assistant_old", "assistant_new"],
      ["retry_old", "retry_new"],
    ]),
  });

  assert.equal(inserted.filter((entry) => entry.table === "chatAdvisors").length, 1);
  assert.equal(inserted.filter((entry) => entry.table === "advisorBatches").length, 1);
  assert.equal(inserted.filter((entry) => entry.table === "advisorRuns").length, 1);
  const copiedSnapshot = inserted.find((entry) => entry.table === "advisorRuns")
    ?.value.personaSnapshot as Record<string, unknown> | undefined;
  assert.equal(copiedSnapshot?.displayName, "Reviewer");
  const copiedRun = inserted.find((entry) => entry.table === "advisorRuns")?.value;
  assert.equal(copiedRun?.errorMessage, "Advisor consultation failed.");
  assert.doesNotMatch(String(copiedRun?.errorMessage), /PRIVATE_PROMPT_SENTINEL/);
  assert.deepEqual(patches, [
    { id: "assistant_new", patch: { advisorBatchId: "batch_new" } },
    { id: "retry_new", patch: { advisorBatchId: "batch_new" } },
  ]);
});

test("chat fork preserves a reachable retry batch when its original response is not copied", async () => {
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];
  const rows: Record<string, TestRow[]> = {
    chatAdvisors: [],
    advisorBatches: [{
      _id: "batch_old",
      userId: "user_1",
      chatId: "chat_old",
      userMessageId: "user_old",
      assistantMessageIds: ["assistant_original_outside_fork"],
      status: "completed",
      expectedRunCount: 1,
      completedRunCount: 1,
      failedRunCount: 0,
      generationSnapshot: {},
      createdAt: 1,
      updatedAt: 2,
    }],
    advisorRuns: [{
      _id: "run_old",
      batchId: "batch_old",
      userId: "user_1",
      chatId: "chat_old",
      userMessageId: "user_old",
      personaId: "persona_1",
      personaSnapshot: { displayName: "Reviewer" },
      instanceName: "persona_1",
      sortOrder: 0,
      status: "completed",
      stage: "completed",
      allowWebSearch: false,
      resolvedInstructions: "Advise",
      requestedModelId: "model",
      advice: "Reused advice",
      createdAt: 1,
      updatedAt: 2,
    }],
    messages: [{ _id: "retry_old", advisorBatchId: "batch_old" }],
  };

  await copyAdvisorData({
    db: {
      query: (table: string) => ({
        withIndex: () => ({ collect: async () => rows[table] ?? [] }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserted.push({ table, value });
        return table === "advisorBatches" ? "batch_new" : `${table}_new`;
      },
      patch: async (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
    },
  } as unknown as Parameters<typeof copyAdvisorData>[0], {
    sourceChatId: "chat_old" as Parameters<typeof copyAdvisorData>[1]["sourceChatId"],
    targetChatId: "chat_new" as Parameters<typeof copyAdvisorData>[1]["targetChatId"],
    userId: "user_1",
    messageIdMap: new Map([
      ["user_old", "user_new"],
      ["retry_old", "retry_new"],
    ]),
  });

  const copiedBatch = inserted.find((entry) => entry.table === "advisorBatches");
  assert.deepEqual(copiedBatch?.value.assistantMessageIds, ["retry_new"]);
  assert.equal(inserted.filter((entry) => entry.table === "advisorRuns").length, 1);
  assert.deepEqual(patches, [
    { id: "retry_new", patch: { advisorBatchId: "batch_new" } },
  ]);
});

test("chat and account deletion cancel delayed Advisor work before removing rows", async () => {
  const deleted: string[] = [];
  const cancelled: string[] = [];
  const queryRows: Record<string, TestRow[]> = {
    advisorBatches: [{
      _id: "batch_1",
      scheduledFinalGenerationId: "final_1",
      scheduledFinalGenerationIds: ["final_2"],
    }],
    advisorRuns: [{
      _id: "run_1",
      scheduledFunctionId: "run_schedule",
      watchdogScheduledFunctionId: "watchdog_schedule",
    }],
    chatAdvisors: [{ _id: "assignment_1" }],
  };
  const ctx = {
    db: {
      query: (table: string) => ({
        withIndex: () => ({
          collect: async () => queryRows[table] ?? [],
          take: async () => queryRows[table] ?? [],
        }),
      }),
      delete: async (id: string) => { deleted.push(id); },
    },
    scheduler: { cancel: async (id: string) => { cancelled.push(id); } },
  } as unknown as Parameters<typeof deleteChatAdvisorDataBatch>[0];

  assert.equal(await deleteChatAdvisorDataBatch(
    ctx,
    "chat_1" as Parameters<typeof deleteChatAdvisorDataBatch>[1],
    200,
  ), false);
  assert.deepEqual(deleted, ["run_1", "batch_1", "assignment_1"]);
  assert.deepEqual(cancelled, ["run_schedule", "watchdog_schedule", "final_2", "final_1"]);

  deleted.length = 0;
  cancelled.length = 0;
  assert.equal(await deleteUserAdvisorRunsBatch(ctx, "user_1", 200), 1);
  assert.equal(await deleteUserAdvisorBatchesBatch(ctx, "user_1", 200), 1);
  assert.deepEqual(deleted, ["run_1", "batch_1"]);
  assert.deepEqual(cancelled, ["run_schedule", "watchdog_schedule", "final_2", "final_1"]);
});
