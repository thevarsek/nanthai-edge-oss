import assert from "node:assert/strict";
import test from "node:test";

import { runSubagentRunHandler } from "../subagents/actions_run_subagent";

test("unclaimed stale streaming subagent runs are failed and resume the parent when all children are terminal", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  const scheduled: Array<Record<string, unknown>> = [];

  const ctx = {
    runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
      mutations.push(args);
      if (args.expectedStatuses) return false;
      if (args.status === "failed") {
        return { batchId: "batch_1", allTerminal: true };
      }
      if (args.status === "waiting_to_resume") return true;
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
  assert.deepEqual(scheduled, [{ batchId: "batch_1" }]);
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

  assert.equal(scheduled.length, 1);
  assert.deepEqual(scheduled[0]?.args, { runId: "run_1" });
  assert.ok(mutations.some((args) =>
    args.runId === "run_1"
    && args.status === "cancelled"
    && args.content === "started"
    && args.reasoning === "thinking"
    && args.error === "Subagent batch was cancelled."
  ));
});
