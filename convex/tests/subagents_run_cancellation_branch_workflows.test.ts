import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { runSubagentRunHandler } from "../subagents/actions_run_subagent";

function sseResponse(deltaCount: number) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: async () => [
      ...Array.from({ length: deltaCount }, () =>
        `data: ${JSON.stringify({ choices: [{ delta: { content: "x" } }] })}`),
      "data: [DONE]",
      "",
    ].join("\n\n"),
  } as any;
}

function baseBatch() {
  return {
    _id: "batch_1",
    status: "running_children",
    userId: "user_1",
    chatId: "chat_1",
    parentMessageId: "parent_1",
    childConversationSeed: [{ role: "assistant", content: "Seed." }],
    paramsSnapshot: { enabledIntegrations: [], requestParams: {} },
    participantSnapshot: {
      userId: "user_1",
      chatId: "chat_1",
      participant: { modelId: "openai/gpt-5" },
    },
  };
}

test("unclaimed fresh or missing subagent runs do not finalize stale work", async () => {
  for (const run of [null, { _id: "run_1", status: "queued", updatedAt: Date.now() }]) {
    const mutations: Array<Record<string, unknown>> = [];
    await runSubagentRunHandler({
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
        return false;
      },
      runQuery: async () => run,
      scheduler: { runAfter: async () => "scheduled" },
    } as any, { runId: "run_1" as any });

    assert.deepEqual(mutations, [{ runId: "run_1", expectedStatuses: ["queued", "waiting_continuation"] }]);
  }
});

test("claimed subagent run exits after scheduling recovery when its batch disappears", async () => {
  const scheduled: Array<Record<string, unknown>> = [];
  await runSubagentRunHandler({
    runMutation: async () => true,
    runQuery: async (_ref: unknown, args: Record<string, unknown>) =>
      "runId" in args
        ? { _id: "run_1", batchId: "batch_1", status: "queued", title: "T", taskPrompt: "P" }
        : null,
    scheduler: {
      runAfter: async (_delay: number, _ref: unknown, args: Record<string, unknown>) => {
        scheduled.push(args);
        return "scheduled";
      },
    },
  } as any, { runId: "run_1" as any });

  assert.deepEqual(scheduled, [{ runId: "run_1" }]);
});

test("streaming subagent run cancels when the batch is cancelled during periodic checks", async (t) => {
  t.after(() => mock.restoreAll());
  mock.method(globalThis, "fetch", async () => sseResponse(10)) as any;

  const mutations: Array<Record<string, unknown>> = [];
  let batchReadCount = 0;
  const ctx = {
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if ("expectedStatuses" in args) return true;
      if ("runId" in args && "status" in args) return { batchId: "batch_1", allTerminal: false };
      return null;
    },
    runQuery: async (_ref: unknown, args: Record<string, unknown>) => {
      if ("runId" in args) {
        return { _id: "run_1", batchId: "batch_1", status: "streaming", title: "T", taskPrompt: "P" };
      }
      if ("batchId" in args) {
        batchReadCount += 1;
        return batchReadCount >= 2 ? { ...baseBatch(), status: "cancelled" } : baseBatch();
      }
      if ("userId" in args) return "sk-test";
      if ("modelId" in args) return { supportedParameters: [], hasImageGeneration: false, hasReasoning: false };
      return null;
    },
    scheduler: { runAfter: async () => "scheduled" },
  } as any;

  await runSubagentRunHandler(ctx, { runId: "run_1" as any });

  assert.ok(mutations.some((args) => args.status === "cancelled" && args.error === "Generation cancelled"));
});
