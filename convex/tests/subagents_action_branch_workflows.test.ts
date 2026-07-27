import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { runSubagentRunHandler } from "../subagents/actions_run_subagent";

function sseResponse(events: unknown[]) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => [
      ...events.map((event) => `data: ${JSON.stringify(event)}`),
      "data: [DONE]",
      "",
    ].join("\n\n"),
  } as any;
}

function makeClaimedRunCtx(options: {
  fetchError?: unknown;
  streamEvents?: unknown[];
  finalizeResult?: Record<string, unknown> | null;
} = {}) {
  const mutations: Array<Record<string, unknown>> = [];
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
    paramsSnapshot: { requestParams: {} },
    participantSnapshot: {
      userId: "user_1",
      chatId: "chat_1",
      participant: { modelId: "openai/gpt-5" },
    },
  };
  return {
    mutations,
    scheduled,
    ctx: {
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        if ("expectedStatuses" in args) return true;
        if ("runId" in args && "status" in args) return options.finalizeResult ?? null;
        return null;
      },
      runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
        if ("runId" in args) return run;
        if ("batchId" in args) return batch;
        if ("modelId" in args) {
          return { supportedParameters: [], hasImageGeneration: false, hasReasoning: false };
        }
        if ("userId" in args) return "sk-test";
        return null;
      },
      scheduler: {
        runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
          scheduled.push(args);
          return "scheduled_1";
        },
      },
    } as any,
  };
}

test("stale Workflow-owned subagents hand terminal batches back to the parent Workflow", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  const ctx = {
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.expectedStatuses) return false;
      if (args.status === "failed") {
        return { batchId: "batch_1", allTerminal: true };
      }
      return undefined;
    },
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.runId === "run_1") {
        return {
          _id: "run_1",
          batchId: "batch_1",
          status: "streaming",
          content: "partial answer",
          reasoning: "working",
          updatedAt: Date.now() - (11 * 60 * 1000),
          usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
          toolCalls: [{ id: "call_1", name: "search", arguments: "{}" }],
          toolResults: [{ toolCallId: "call_1", toolName: "search", result: "ok" }],
          generatedFiles: [{ storageId: "storage_1", filename: "report.md", mimeType: "text/markdown" }],
          generatedCharts: [{ toolName: "chart", chartType: "bar", title: "Trend", elements: [] }],
        };
      }
      if (args.batchId === "batch_1") {
        return {
          _id: "batch_1",
          status: "running_children",
          userId: "user_1",
          chatId: "chat_1",
          parentMessageId: "parent_1",
          parentJobId: "job_1",
          paramsSnapshot: { analytics: { platform: "web" } },
          participantSnapshot: { participant: { modelId: "openai/gpt-5" } },
        };
      }
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "scheduled_1";
      },
    },
  } as any;

  await runSubagentRunHandler(ctx, { runId: "run_1" as any });

  assert.ok(mutations.some((args) =>
    args.runId === "run_1"
    && args.status === "failed"
    && args.content === "partial answer"
    && String(args.error).includes("lease expired")
  ));
  assert.ok(mutations.some((args) =>
    args.batchId === "batch_1"
    && args.status === "waiting_to_resume"
    && args.expectedCurrentStatus === "running_children"
  ));
  assert.ok(scheduled.some((entry) =>
    entry.event === "assistant_response_started"
      && (entry.properties as Record<string, unknown>).stale_recovery === true));
  assert.ok(scheduled.some((entry) =>
    entry.event === "assistant_response_failed"
      && (entry.properties as Record<string, unknown>).stale_recovery === true));
  assert.equal(scheduled.some((entry) => entry.batchId === "batch_1"), false);
});

test("claimed subagent run exits cleanly when the run disappears before recovery scheduling", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  await runSubagentRunHandler({
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      return true;
    },
    runQuery: async () => null,
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "scheduled_1";
      },
    },
  } as any, { runId: "run_missing" as any });

  assert.deepEqual(mutations, [{
    runId: "run_missing",
    expectedStatuses: ["queued", "waiting_continuation"],
  }]);
  assert.deepEqual(scheduled, []);
});

test("claimed subagent run marks itself cancelled when its batch was cancelled", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<{ delay: number; args: Record<string, unknown> }> = [];

  const ctx = {
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.expectedStatuses) return true;
      return undefined;
    },
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if (args.runId === "run_1") {
        return {
          _id: "run_1",
          batchId: "batch_1",
          status: "streaming",
          content: "started",
          reasoning: "thinking",
        };
      }
      if (args.batchId === "batch_1") {
        return {
          _id: "batch_1",
          status: "cancelled",
          userId: "user_1",
        };
      }
      if (args.userId === "user_1") return "sk-test";
      throw new Error(`Unexpected query args: ${JSON.stringify(args)}`);
    },
    scheduler: {
      runAfter: async (delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push({ delay, args });
        return "scheduled_1";
      },
    },
  } as any;

  await runSubagentRunHandler(ctx, { runId: "run_1" as any });

  assert.equal(scheduled.length, 0);
  assert.ok(mutations.some((args) =>
    args.runId === "run_1"
    && args.status === "cancelled"
    && args.content === "started"
    && args.reasoning === "thinking"
    && args.error === "Subagent batch was cancelled."
  ));
});

test("claimed subagent run stores an explicit empty-response fallback without resuming unfinished batches", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => sseResponse([
    { choices: [{ delta: { content: "   " } }] },
    { choices: [{ finish_reason: "stop" }] },
  ])) as any;

  const state = makeClaimedRunCtx({
    finalizeResult: { batchId: "batch_1", allTerminal: false },
  });

  await runSubagentRunHandler(state.ctx, { runId: "run_1" as any });

  const completed = state.mutations.find((args) => args.status === "completed");
  assert.equal(completed?.content, "[No response received from subagent]");
  assert.equal(completed?.reasoning, undefined);
  assert.equal(completed?.usage, undefined);
  assert.equal(state.scheduled.some((args) => args.batchId === "batch_1"), false);
});

test("Workflow-owned subagent failures hand terminal batches back through the mutation boundary", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => {
    throw "subagent transport failed";
  }) as any;

  const state = makeClaimedRunCtx({
    finalizeResult: { batchId: "batch_1", allTerminal: true },
  });

  await runSubagentRunHandler(state.ctx, { runId: "run_1" as any });

  const failed = state.mutations.find((args) => args.status === "failed");
  assert.equal(failed?.content, undefined);
  assert.equal(failed?.reasoning, undefined);
  assert.equal(failed?.error, "subagent transport failed");
  assert.ok(state.mutations.some((args) =>
    args.batchId === "batch_1"
    && args.status === "waiting_to_resume"
    && args.expectedCurrentStatus === "running_children"
  ));
  assert.equal(state.scheduled.some((args) => args.batchId === "batch_1"), false);
});
