import assert from "node:assert/strict";
import test from "node:test";

import { cleanStaleSandboxSessions } from "../runtime/cleanup";
import {
  getSessionByChatInternal,
  getStaleSessionsInternal,
  hasActiveGenerationForChatInternal,
  resolveOwnedStorageFileInternal,
} from "../runtime/queries";
import { scheduleGenerationContinuation } from "../chat/actions_run_generation_continuation";

function queryChain(rows: Array<Record<string, unknown>>) {
  return {
    withIndex: () => ({
      order: () => ({
        first: async () => rows[0] ?? null,
      }),
      first: async () => rows[0] ?? null,
      collect: async () => rows,
      take: async (limit: number) => rows.slice(0, limit),
    }),
  };
}

test("generation continuation persists only a Workflow-owned checkpoint", async () => {
  const mutations: Array<{ args: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const args = {
    chatId: "chat_1",
    userId: "user_1",
    participant: {
      messageId: "message_1",
      jobId: "job_1",
      modelId: "openai/gpt-5",
    },
    workflowManaged: true,
    workflowResumeEventId: "event_1",
  };
  const checkpoint = { messages: [{ role: "user", content: "continue" }] };

  await scheduleGenerationContinuation({
    runMutation: async (_fn: unknown, mutationArgs: Record<string, unknown>) => {
      mutations.push({ args: mutationArgs });
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, runArgs: Record<string, unknown>) => {
        scheduled.push(runArgs);
        return "scheduled_resume";
      },
    },
  } as any, args as any, checkpoint as any);

  assert.deepEqual(mutations[0]?.args, {
    chatId: "chat_1",
    messageId: "message_1",
    jobId: "job_1",
    userId: "user_1",
    checkpoint: { ...checkpoint, roundKey: "event_1" },
  });
  assert.deepEqual(scheduled, []);
});

test("generation continuation rejects scheduler-owned resume routing", async () => {
  await assert.rejects(
    scheduleGenerationContinuation({} as any, {
      chatId: "chat_1",
      userId: "user_1",
      participant: {
        messageId: "message_1",
        jobId: "job_1",
        modelId: "openai/gpt-5",
      },
    } as any, { messages: [] } as any),
    /GENERATION_WORKFLOW_ROUND_KEY_REQUIRED/,
  );
});

test("runtime queries resolve latest sessions, active generations, owned files, and stale batches", async () => {
  const session = await (getSessionByChatInternal as any)._handler({
    db: {
      query: () => queryChain([
        { _id: "session_old", updatedAt: 10 },
        { _id: "session_new", updatedAt: 30 },
        { _id: "session_mid", updatedAt: 20 },
      ]),
    },
  }, { userId: "user_1", chatId: "chat_1", environment: "python" });
  assert.equal(session._id, "session_new");

  const active = await (hasActiveGenerationForChatInternal as any)._handler({
    db: { query: () => queryChain([{ _id: "job_1" }]) },
  }, { chatId: "chat_1" });
  const inactive = await (hasActiveGenerationForChatInternal as any)._handler({
    db: { query: () => queryChain([]) },
  }, { chatId: "chat_1" });
  assert.equal(active, true);
  assert.equal(inactive, false);

  const uploaded = await (resolveOwnedStorageFileInternal as any)._handler({
    db: {
      query: (table: string) => queryChain(table === "fileAttachments"
        ? [{ storageId: "storage_1", userId: "user_1", filename: "in.txt", mimeType: "text/plain", sizeBytes: 12 }]
        : []),
    },
  }, { userId: "user_1", storageId: "storage_1" });
  const generated = await (resolveOwnedStorageFileInternal as any)._handler({
    db: {
      query: (table: string) => queryChain(table === "generatedFiles"
        ? [{ storageId: "storage_2", userId: "user_1", filename: "out.txt", mimeType: "text/plain", sizeBytes: 9 }]
        : []),
    },
  }, { userId: "user_1", storageId: "storage_2" });
  assert.equal(uploaded.source, "upload");
  assert.equal(generated.source, "generated");

  const calls: string[] = [];
  const stale = await (getStaleSessionsInternal as any)._handler({
    db: {
      query: () => ({
        withIndex: (_index: string, apply?: (q: any) => unknown) => {
          let status = "";
          const q = {
            eq: (_field: string, value: string) => {
              status = value;
              return q;
            },
            lt: () => q,
          };
          apply?.(q);
          return {
            take: async (limit: number) => {
              calls.push(`${status}:${limit}`);
              if (status === "running") {
                return [{ _id: "run_1", environment: "node", status, providerSandboxId: "vm_1" }];
              }
              if (status === "pendingCreate") {
                return [{ _id: "pending_1", environment: "python", status, providerSandboxId: "" }];
              }
              return [{
                _id: "failed_1",
                environment: "node",
                status,
                providerSandboxId: "vm_failed",
              }];
            },
          };
        },
      }),
    },
  });

  assert.deepEqual(calls, ["running:100", "pendingCreate:99", "failed:98"]);
  assert.deepEqual(stale.sessions.map((s: { id: string; hasVm: boolean }) => [s.id, s.hasVm]), [
    ["run_1", true],
    ["pending_1", false],
    ["failed_1", true],
  ]);
  assert.equal(stale.hitBatchLimit, false);
});

test("runtime stale sandbox cleanup marks sessions and schedules continuation when capped", async () => {
  const originalLog = console.log;
  const logs: string[] = [];
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const emptyMutations: unknown[] = [];
    await (cleanStaleSandboxSessions as any)._handler({
      runQuery: async () => ({ sessions: [], hitBatchLimit: false }),
      runMutation: async (_fn: unknown, args: unknown) => emptyMutations.push(args),
      scheduler: { runAfter: async () => "unused" },
    });
    assert.deepEqual(emptyMutations, []);

    const mutations: unknown[] = [];
    const continuations: unknown[] = [];
    await (cleanStaleSandboxSessions as any)._handler({
      runQuery: async () => ({
        sessions: [
          { id: "session_db", hasVm: false },
          { id: "session_vm_without_env", hasVm: true, providerSandboxId: "sandbox_1" },
        ],
        hitBatchLimit: true,
      }),
      runAction: async () => false,
      runMutation: async (_fn: unknown, args: unknown) => mutations.push(args),
      scheduler: {
        runAfter: async (_delay: number, _fn: unknown, args: unknown) => {
          continuations.push(args);
          return "scheduled_cleanup";
        },
      },
    });

    assert.deepEqual(mutations, [{
      sessionIds: ["session_db"],
      reason: "Stale session cleanup (cron)",
    }]);
    assert.deepEqual(continuations, [{ failureAttempt: 1 }]);
    assert.ok(logs.some((entry) => entry.includes("Marked 1 stale sessions as deleted")));
  } finally {
    console.log = originalLog;
  }
});
