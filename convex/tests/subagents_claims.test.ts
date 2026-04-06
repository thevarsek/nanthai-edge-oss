import assert from "node:assert/strict";
import test from "node:test";

import { claimBatchForResume, claimRunForExecution, finalizeRun } from "../subagents/mutations";
import { SUBAGENT_RECOVERY_LEASE_MS } from "../subagents/shared";

test("claimRunForExecution only claims queued work once", async () => {
  const run = {
    _id: "run_1",
    status: "queued",
    startedAt: undefined,
  };
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async () => run,
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
        Object.assign(run, value);
      },
    },
  } as any;

  const first = await (claimRunForExecution as any)._handler(ctx, {
    runId: "run_1",
    expectedStatuses: ["queued", "waiting_continuation"],
  });
  const second = await (claimRunForExecution as any)._handler(ctx, {
    runId: "run_1",
    expectedStatuses: ["queued", "waiting_continuation"],
  });

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(run.status, "streaming");
  assert.equal(patches.length, 1);
});

test("claimBatchForResume only claims waiting batches once", async () => {
  const batch = {
    _id: "batch_1",
    status: "waiting_to_resume",
  };
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async () => batch,
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
        Object.assign(batch, value);
      },
    },
  } as any;

  const first = await (claimBatchForResume as any)._handler(ctx, {
    batchId: "batch_1",
  });
  const second = await (claimBatchForResume as any)._handler(ctx, {
    batchId: "batch_1",
  });

  assert.equal(first, true);
  assert.equal(second, false);
  assert.equal(batch.status, "resuming");
  assert.equal(patches.length, 1);
});

test("claimRunForExecution does not reclaim a stale streaming lease", async () => {
  const run = {
    _id: "run_1",
    status: "streaming",
    startedAt: 1,
    updatedAt: Date.now() - SUBAGENT_RECOVERY_LEASE_MS - 1_000,
  };
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async () => run,
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
        Object.assign(run, value);
      },
    },
  } as any;

  const claimed = await (claimRunForExecution as any)._handler(ctx, {
    runId: "run_1",
    expectedStatuses: ["queued", "waiting_continuation"],
  });

  assert.equal(claimed, false);
  assert.equal(run.status, "streaming");
  assert.equal(patches.length, 0);
});

test("claimBatchForResume does not reclaim a stale resuming lease", async () => {
  const batch = {
    _id: "batch_1",
    status: "resuming",
    updatedAt: Date.now() - SUBAGENT_RECOVERY_LEASE_MS - 1_000,
  };
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async () => batch,
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
        Object.assign(batch, value);
      },
    },
  } as any;

  const claimed = await (claimBatchForResume as any)._handler(ctx, {
    batchId: "batch_1",
  });

  assert.equal(claimed, false);
  assert.equal(batch.status, "resuming");
  assert.equal(patches.length, 0);
});

test("finalizeRun preserves stored tool metadata when new values are omitted", async () => {
  const run = {
    _id: "run_1",
    batchId: "batch_1",
    status: "streaming",
    content: "partial",
    reasoning: "thinking",
    usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    toolCalls: [{ id: "call_1", name: "generate_text_file", arguments: "{}" }],
    toolResults: [{
      toolCallId: "call_1",
      toolName: "generate_text_file",
      result: "{\"storageId\":\"storage_1\",\"filename\":\"child.txt\"}",
    }],
    generatedFiles: [{
      storageId: "storage_1",
      filename: "child.txt",
      mimeType: "text/plain",
      toolName: "generate_text_file",
    }],
  };
  const sibling = {
    _id: "run_2",
    batchId: "batch_1",
    status: "completed",
  };
  const patches: Array<Record<string, unknown>> = [];
  const ctx = {
    db: {
      get: async (id: string) => {
        if (id === "run_1") return run;
        if (id === "batch_1") return { _id: "batch_1" };
        return null;
      },
      patch: async (_id: string, value: Record<string, unknown>) => {
        patches.push(value);
        if (_id === "run_1") {
          Object.assign(run, value);
        }
      },
      query: (_table: string) => ({
        withIndex: () => ({
          collect: async () => [run, sibling],
        }),
      }),
    },
  } as any;

  const result = await (finalizeRun as any)._handler(ctx, {
    runId: "run_1",
    status: "failed",
    error: "boom",
  });

  assert.deepEqual(run.toolCalls, [{ id: "call_1", name: "generate_text_file", arguments: "{}" }]);
  assert.deepEqual(run.toolResults, [{
    toolCallId: "call_1",
    toolName: "generate_text_file",
    result: "{\"storageId\":\"storage_1\",\"filename\":\"child.txt\"}",
  }]);
  assert.deepEqual(run.generatedFiles, [{
    storageId: "storage_1",
    filename: "child.txt",
    mimeType: "text/plain",
    toolName: "generate_text_file",
  }]);
  assert.equal(result.allTerminal, true);
  assert.equal(patches.length, 2);
});
