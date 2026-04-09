import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { sendMessageHandler, cancelActiveGenerationHandler } from "../chat/mutations_public_handlers";
import { updateChatHandler } from "../chat/manage_handlers";
import { continueParentAfterSubagentsHandler } from "../subagents/actions_continue_parent";
import { runSubagentRunHandler } from "../subagents/actions_run_subagent";
import { addParticipant } from "../participants/mutations";
import { revokeEntitlement } from "../preferences/mutations";
import { SUBAGENT_RECOVERY_LEASE_MS } from "../subagents/shared";

function textResponse(status: number, text: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => text,
  } as any;
}

function sseTextResponse(content: string, generationId = "subagent_gen_1") {
  return textResponse(
    200,
    [
      `data: ${JSON.stringify({ id: generationId, choices: [{ delta: { content } }] })}`,
      `data: ${JSON.stringify({
        choices: [{ finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16, cost: 0.02 },
      })}`,
      "data: [DONE]",
      "",
    ].join("\n\n"),
  );
}

test("sendMessageHandler downgrades stale non-Pro subagent requests", async () => {
  const inserts: Array<{ table: string; value: Record<string, unknown> }> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            title: "Chat",
            messageCount: 1,
          };
        }
        return null;
      },
      insert: async (table: string, value: Record<string, unknown>) => {
        inserts.push({ table, value });
        return `${table}_${inserts.length}`;
      },
      patch: async () => undefined,
      query: (table: string) => {
        if (table === "usageRecords") {
          return {
            withIndex: () => ({
              take: async () => [],
            }),
          };
        }
        if (table === "purchaseEntitlements") {
          return {
            withIndex: () => ({
              first: async () => null,
            }),
          };
        }
        if (table === "userPreferences") {
          return {
            withIndex: () => ({
              first: async () => ({ userId: "user_1" }),
            }),
          };
        }
        if (table === "messages") {
          return {
            withIndex: () => ({
              order: () => ({
                take: async () => [],
              }),
            }),
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "sched_1";
      },
    },
    storage: {
      getUrl: async () => null,
    },
  } as any;

  await assert.doesNotReject(
    sendMessageHandler(ctx, {
      chatId: "chat_1",
      text: "Hello",
      participants: [{ modelId: "openai/gpt-4o" }],
      subagentsEnabled: true,
    } as any),
  );

  const assistantInsert = inserts.find((entry) => entry.table === "messages" && entry.value.role === "assistant");
  assert.ok(assistantInsert);
  assert.equal(assistantInsert.value.subagentsEnabled, false);
  assert.equal(scheduled[0]?.subagentsEnabled, false);
});

test("updateChatHandler rejects enabling subagents on a multi-model chat", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return { _id: "chat_1", userId: "user_1", title: "Chat" };
        }
        return null;
      },
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
      },
      query: (table: string) => {
        if (table === "purchaseEntitlements") {
          return {
            withIndex: () => ({
              first: async () => ({ userId: "user_1", status: "active" }),
            }),
          };
        }
        if (table === "userPreferences") {
          return {
            withIndex: () => ({
              first: async () => ({ userId: "user_1" }),
            }),
          };
        }
        if (table === "chatParticipants") {
          return {
            withIndex: () => ({
              collect: async () => [{ _id: "cp_1" }, { _id: "cp_2" }],
            }),
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
    },
  } as any;

  await assert.rejects(
    updateChatHandler(ctx, {
      chatId: "chat_1",
      subagentOverride: "enabled",
    } as any),
    /single-model chats/i,
  );

  assert.equal(patches.length, 0);
});

test("revokeEntitlement clears stale enabled subagent settings", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const scheduled: Array<{ fnRef: unknown; payload: Record<string, unknown> }> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      query: (table: string) => {
        if (table === "purchaseEntitlements") {
          return {
            withIndex: (index: string) => ({
              first: async () => null,
              collect: async () =>
                index === "by_external_purchase"
                  ? [{ _id: "ent_ios", userId: "user_1", source: "app_store" }]
                  : [],
            }),
          };
        }
        if (table === "userPreferences") {
          return {
            withIndex: () => ({
              first: async () => ({ _id: "prefs_1", userId: "user_1" }),
            }),
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
    },
    scheduler: {
      runAfter: async (_delay: number, fnRef: unknown, payload: Record<string, unknown>) => {
        scheduled.push({ fnRef, payload });
        return "sched_1";
      },
    },
  } as any;

  await (revokeEntitlement as any)._handler(ctx, { originalTransactionId: "tx_ios_123" });

  const prefsPatch = patches.find((entry) => entry.id === "prefs_1");
  assert.ok(prefsPatch);
  assert.equal(prefsPatch?.value.memoryGatingMode, "disabled");
  assert.equal(prefsPatch?.value.subagentsEnabledByDefault, false);

  // Chat subagentOverride resets are now done asynchronously via the
  // disableProChatsBatch scheduled mutation — assert it was scheduled.
  const chatBatchScheduled = scheduled.some((s) => s.payload.userId === "user_1");
  assert.ok(chatBatchScheduled);
});

test("cancelActiveGenerationHandler preserves timedOut subagent runs", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return { _id: "chat_1", userId: "user_1" };
        }
        if (id === "msg_1") {
          return { _id: "msg_1", status: "streaming" };
        }
        return null;
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      query: (table: string) => {
        if (table === "generationJobs") {
          return {
            withIndex: (_index: string, apply: (query: any) => any) => {
              let status = "";
              apply({
                eq: (_field: string, value: string) => {
                  status = value;
                  return {
                    eq: (_nestedField: string, nestedValue: string) => {
                      status = nestedValue;
                      return {};
                    },
                  };
                },
              });
              return {
                collect: async () => (status === "streaming"
                  ? [{ _id: "job_1", messageId: "msg_1" }]
                  : []),
              };
            },
          };
        }
        if (table === "subagentBatches") {
          return {
            withIndex: () => ({
              first: async () => ({ _id: "batch_1", status: "running_children" }),
            }),
          };
        }
        if (table === "subagentRuns") {
          return {
            withIndex: () => ({
              collect: async () => [
                { _id: "run_timed", status: "timedOut" },
                { _id: "run_live", status: "streaming" },
              ],
            }),
          };
        }
        if (table === "searchSessions") {
          return {
            withIndex: () => ({
              collect: async () => [
                { _id: "search_1", status: "running", currentPhase: "searching" },
              ],
            }),
          };
        }
        if (table === "streamingMessages") {
          return {
            withIndex: () => ({
              collect: async () => [],
              first: async () => null,
            }),
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
    },
  } as any;

  await cancelActiveGenerationHandler(ctx, { chatId: "chat_1" } as any);

  assert.ok(patches.some((entry) => entry.id === "run_live" && entry.value.status === "cancelled"));
  assert.ok(!patches.some((entry) => entry.id === "run_timed"));
  assert.ok(patches.some((entry) => entry.id === "search_1" && entry.value.status === "cancelled"));
});

test("continueParentAfterSubagentsHandler reconciles stale completed resumes without replaying generation", async () => {
  const runMutationCalls: Array<Record<string, unknown>> = [];
  let queryStep = 0;
  let userScopedQueryCount = 0;
  const ctx = {
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      runMutationCalls.push(args);
      if ("batchId" in args && !("status" in args) && !("generatedFiles" in args)) {
        return false;
      }
      return true;
    },
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("userId" in args) {
        userScopedQueryCount += 1;
        return userScopedQueryCount === 1
          ? { isPro: true }
          : "sk-test";
      }
      queryStep += 1;
      if (queryStep === 1) {
        return {
          _id: "batch_1",
          status: "resuming",
          updatedAt: Date.now() - SUBAGENT_RECOVERY_LEASE_MS - 1_000,
          parentMessageId: "msg_1",
          sourceUserMessageId: "user_msg_1",
          parentJobId: "job_1",
          chatId: "chat_1",
          userId: "user_1",
          resumeConversationSeed: [],
          toolCallId: "tool_1",
          participantSnapshot: {
            chatId: "chat_1",
            userId: "user_1",
            participant: { modelId: "openai/gpt-4o" },
          },
          paramsSnapshot: {},
        };
      }
      if (queryStep === 2) {
        return [];
      }
      if (queryStep === 3) {
        return { _id: "msg_1", status: "cancelled" };
      }
      if (queryStep === 4) {
        return { _id: "job_1", status: "cancelled" };
      }
      throw new Error(`Unexpected query step ${queryStep}`);
    },
    scheduler: {
      runAfter: async () => "sched_1",
    },
  } as any;

  await continueParentAfterSubagentsHandler(ctx, { batchId: "batch_1" } as any);

  assert.ok(runMutationCalls.some((call) => call.status === "cancelled"));
});

test("continueParentAfterSubagentsHandler schedules postProcess with the source user message id", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  let queryStep = 0;
  let userScopedQueryCount = 0;
  const ctx = {
    runMutation: async (_fn: unknown, _args: Record<string, unknown>) => true,
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("userId" in args) {
        userScopedQueryCount += 1;
        return userScopedQueryCount === 1
          ? { isPro: true }
          : "sk-test";
      }
      queryStep += 1;
      if (queryStep === 1) {
        return {
          _id: "batch_1",
          status: "resuming",
          updatedAt: Date.now(),
          parentMessageId: "assistant_msg_1",
          sourceUserMessageId: "user_msg_1",
          parentJobId: "job_1",
          chatId: "chat_1",
          userId: "user_1",
          resumeConversationSeed: [],
          toolCallId: "tool_1",
          participantSnapshot: {
            chatId: "chat_1",
            userId: "user_1",
            participant: { modelId: "openai/gpt-4o" },
          },
          paramsSnapshot: {},
        };
      }
      if (queryStep === 2) {
        return [];
      }
      if (queryStep === 3) {
        return { _id: "assistant_msg_1", status: "completed" };
      }
      if (queryStep === 4) {
        return { _id: "job_1", status: "completed" };
      }
      throw new Error(`Unexpected query step ${queryStep}`);
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "sched_1";
      },
    },
  } as any;

  await continueParentAfterSubagentsHandler(ctx, { batchId: "batch_1" } as any);

  const postProcessArgs = scheduled.find((entry) => Array.isArray(entry.assistantMessageIds));
  assert.ok(postProcessArgs);
  assert.equal(postProcessArgs?.userMessageId, "user_msg_1");
  assert.deepEqual(postProcessArgs?.assistantMessageIds, ["assistant_msg_1"]);
});

test("runSubagentRunHandler fails stale streaming runs instead of replaying them", async () => {
  const runMutationCalls: Array<Record<string, unknown>> = [];
  let userScopedQueryCount = 0;
  const ctx = {
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      runMutationCalls.push(args);
      if ("expectedStatuses" in args) {
        return false;
      }
      if ("runId" in args && "status" in args) {
        return { batchId: "batch_1", allTerminal: true };
      }
      if ("batchId" in args && "status" in args) {
        return true;
      }
      return null;
    },
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("userId" in args) {
        userScopedQueryCount += 1;
        return userScopedQueryCount === 1
          ? { isPro: true }
          : "sk-test";
      }
      if ("runId" in args) {
        return {
          _id: "run_1",
          batchId: "batch_1",
          status: "streaming",
          updatedAt: Date.now() - SUBAGENT_RECOVERY_LEASE_MS - 1_000,
          content: "partial",
          reasoning: "thinking",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          toolCalls: [],
          toolResults: [],
          generatedFiles: [],
        };
      }
      return null;
    },
    scheduler: {
      runAfter: async () => "sched_1",
    },
  } as any;

  await runSubagentRunHandler(ctx, { runId: "run_1" } as any);

  assert.ok(runMutationCalls.some((call) =>
    call.runId === "run_1"
      && call.status === "failed"
      && typeof call.error === "string"
      && call.error.includes("lease expired")));
});

test("runSubagentRunHandler cancels claimed work when the batch is already cancelled", async () => {
  const runMutationCalls: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  const ctx = {
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      runMutationCalls.push(args);
      if ("expectedStatuses" in args) return true;
      if ("runId" in args && "status" in args) return { batchId: "batch_1", allTerminal: false };
      return null;
    },
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("runId" in args) {
        return {
          _id: "run_1",
          batchId: "batch_1",
          status: "queued",
          title: "Research",
          taskPrompt: "Find the answer.",
          content: "",
          reasoning: "",
          toolCalls: [],
          toolResults: [],
        };
      }
      if ("batchId" in args) {
        return {
          _id: "batch_1",
          status: "cancelled",
          userId: "user_1",
          chatId: "chat_1",
          parentMessageId: "parent_1",
          childConversationSeed: [],
          paramsSnapshot: { requestParams: {} },
          participantSnapshot: { userId: "user_1", chatId: "chat_1", participant: { modelId: "openai/gpt-5" } },
        };
      }
      if ("userId" in args) return "sk-test";
      return null;
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "sched_1";
      },
    },
  } as any;

  await runSubagentRunHandler(ctx, { runId: "run_1" } as any);

  assert.equal(scheduled.some((entry) => entry.runId === "run_1"), true);
  assert.ok(runMutationCalls.some((call) =>
    call.runId === "run_1"
      && call.status === "cancelled"
      && call.error === "Subagent batch was cancelled."));
});

test("runSubagentRunHandler completes a simple streaming run and schedules parent continuation", async (t) => {
  t.after(() => mock.restoreAll());

  mock.method(globalThis, "fetch", async () => sseTextResponse("Child answer complete.")) as any;

  const runMutationCalls: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];
  const run = {
    _id: "run_1",
    batchId: "batch_1",
    status: "queued",
    title: "Research",
    taskPrompt: "Find the answer.",
    content: "",
    reasoning: "",
    toolCalls: [],
    toolResults: [],
    continuationCount: 0,
  };
  const batch = {
    _id: "batch_1",
    status: "running_children",
    userId: "user_1",
    chatId: "chat_1",
    parentMessageId: "parent_1",
    childConversationSeed: [{ role: "assistant", content: "Seed context." }],
    paramsSnapshot: {
      requestParams: {},
    },
    participantSnapshot: {
      userId: "user_1",
      chatId: "chat_1",
      participant: { modelId: "openai/gpt-5" },
    },
  };

  const ctx = {
    runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
      runMutationCalls.push(args);
      if ("expectedStatuses" in args) return true;
      if ("runId" in args && args.status === "completed") {
        return { batchId: "batch_1", allTerminal: true };
      }
      if ("batchId" in args && args.status === "waiting_to_resume") return true;
      return null;
    },
    runQuery: async (_fn: unknown, args: Record<string, unknown>) => {
      if ("runId" in args) return run;
      if ("batchId" in args) return batch;
      if ("modelId" in args) {
        return {
          supportedParameters: [],
          hasImageGeneration: false,
          hasReasoning: false,
          contextLength: 128_000,
        };
      }
      if ("userId" in args) {
        if (Object.keys(args).length === 1) return "sk-test";
        return { isPro: false };
      }
      return null;
    },
    scheduler: {
      runAfter: async (_delay: number, _fn: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "sched_1";
      },
    },
  } as any;

  await runSubagentRunHandler(ctx, { runId: "run_1" } as any);

  assert.ok(runMutationCalls.some((call) =>
    call.runId === "run_1"
      && call.status === "completed"
      && call.content === "Child answer complete."));
  assert.ok(runMutationCalls.some((call) =>
    call.batchId === "batch_1" && call.status === "waiting_to_resume"));
  assert.equal(scheduled.some((entry) => entry.source === "subagent"), true);
  assert.equal(
    scheduled.some((entry) => entry.batchId === "batch_1" && !("source" in entry)),
    true,
  );
});

test("addParticipant clears an enabled subagent override when chat becomes multi-model", async () => {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const inserts: Array<Record<string, unknown>> = [];
  const ctx = {
    auth: {
      getUserIdentity: async () => ({ subject: "user_1" }),
    },
    db: {
      get: async (id: string) => {
        if (id === "chat_1") {
          return {
            _id: "chat_1",
            userId: "user_1",
            subagentOverride: "enabled",
          };
        }
        return null;
      },
      insert: async (_table: string, value: Record<string, unknown>) => {
        inserts.push(value);
        return "participant_2";
      },
      patch: async (id: string, value: Record<string, unknown>) => {
        patches.push({ id, value });
      },
      query: (table: string) => {
        if (table === "autonomousSessions") {
          return {
            withIndex: () => ({
              collect: async () => [],
            }),
          };
        }
        if (table === "chatParticipants") {
          return {
            withIndex: () => ({
              collect: async () => [{ _id: "participant_1", sortOrder: 0 }],
            }),
          };
        }
        throw new Error(`Unexpected table query: ${table}`);
      },
    },
  } as any;

  await (addParticipant as any)._handler(ctx, {
    chatId: "chat_1",
    modelId: "openai/gpt-4o",
  });

  assert.equal(inserts.length, 1);
  const chatPatch = patches.find((entry) => entry.id === "chat_1");
  assert.ok(chatPatch);
  assert.equal(chatPatch?.value.subagentOverride, undefined);
});
