import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { getFunctionName } from "convex/server";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import { createTool, ToolRegistry } from "../tools/registry";

test("registry journals a side effect before dispatch and completes it afterward", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  let executions = 0;
  const ctx = createMockCtx({
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      if ("inputHash" in args) return { decision: "execute" as const };
      return null;
    },
  });
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "slack_send_message",
    description: "Send a message",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      executions += 1;
      return { success: true, data: { messageId: "m1" } };
    },
  }));
  const result = await registry.executeToolCall({
    id: "call_1",
    type: "function",
    function: { name: "slack_send_message", arguments: "{}" },
  }, {
    ctx,
    userId: "user_1",
    jobId: "job_1",
    executionAttemptId: "attempt_1" as Id<"executionAttempts">,
    executionFence: 4,
    authorizationSource: "explicit_user_turn",
  });
  assert.equal(result.result.success, true);
  assert.equal(executions, 1);
  assert.equal(mutationCalls.length, 3);
  assert.equal(mutationCalls[0].effect, "write");
  assert.equal(mutationCalls[0].retry, "never");
  assert.match(String(mutationCalls[0].operationKey), /^job_1:slack_send_message:/);
  assert.equal(mutationCalls[1].operationKey, mutationCalls[0].operationKey);
  assert.equal(mutationCalls[2].operationKey, mutationCalls[0].operationKey);
});

test("registry replays a completed operation without dispatching the tool", async () => {
  let executions = 0;
  const replay = { success: true, data: { messageId: "existing" } };
  const ctx = createMockCtx({
    runMutation: async () => ({
      decision: "replay" as const,
      resultJson: JSON.stringify(replay),
    }),
  });
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "gmail_send",
    description: "Send mail",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      executions += 1;
      return { success: true, data: {} };
    },
  }));
  const result = await registry.executeToolCall({
    id: "call_2",
    type: "function",
    function: { name: "gmail_send", arguments: "{}" },
  }, {
    ctx,
    userId: "user_1",
    jobId: "job_1",
    executionAttemptId: "attempt_1" as Id<"executionAttempts">,
    executionFence: 5,
  });
  assert.deepEqual(result.result, replay);
  assert.equal(executions, 0);
});

test("semantic write replay keeps one operation key across changed model tool-call ids", async () => {
  const operationKeys: string[] = [];
  const ctx = createMockCtx({
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      if (typeof args.operationKey === "string") operationKeys.push(args.operationKey);
      if ("inputHash" in args) return { decision: "execute" as const };
      return null;
    },
  });
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "gmail_send",
    description: "Send mail",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true, data: { id: "sent" } }),
  }));
  for (const id of ["call_original", "call_regenerated"]) {
    await registry.executeToolCall({
      id,
      type: "function",
      function: { name: "gmail_send", arguments: "{\"to\":\"a@example.com\"}" },
    }, {
      ctx,
      userId: "user_1",
      jobId: "job_1",
      executionAttemptId: "attempt_1" as Id<"executionAttempts">,
      executionFence: 7,
    });
  }
  assert.equal(new Set(operationKeys).size, 1);
});

test("semantic write identity canonicalizes object-key order and whitespace", async () => {
  const operationKeys: string[] = [];
  const ctx = createMockCtx({
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      if (typeof args.operationKey === "string") operationKeys.push(args.operationKey);
      if ("inputHash" in args) return { decision: "execute" as const };
      return null;
    },
  });
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "gmail_send",
    description: "Send mail",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true, data: { id: "sent" } }),
  }));
  for (const argumentsJson of [
    '{"to":"a@example.com","metadata":{"b":2,"a":1}}',
    '{ "metadata": { "a": 1, "b": 2 }, "to": "a@example.com" }',
  ]) {
    await registry.executeToolCall({
      id: crypto.randomUUID(),
      type: "function",
      function: { name: "gmail_send", arguments: argumentsJson },
    }, {
      ctx,
      userId: "user_1",
      jobId: "job_1",
      executionAttemptId: "attempt_1" as Id<"executionAttempts">,
      executionFence: 7,
    });
  }
  assert.equal(new Set(operationKeys).size, 1);
});

test("intentional identical writes in one round receive distinct stable occurrence keys", async () => {
  const preparedKeys: string[] = [];
  const ctx = createMockCtx({
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      if ("inputHash" in args) {
        preparedKeys.push(String(args.operationKey));
        return { decision: "execute" as const };
      }
      return null;
    },
  });
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "slack_send_message",
    description: "Send a message",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true, data: {} }),
  }));
  await registry.executeAllToolCalls([
    { id: "call_1", type: "function", function: { name: "slack_send_message", arguments: '{"text":"hello"}' } },
    { id: "call_2", type: "function", function: { name: "slack_send_message", arguments: '{"text":"hello"}' } },
  ], {
    ctx,
    userId: "user_1",
    jobId: "job_1",
    executionAttemptId: "attempt_1" as Id<"executionAttempts">,
    executionFence: 8,
    operationScope: "stable-transcript-prefix",
  });
  assert.equal(new Set(preparedKeys).size, 2);
});

test("identical writes in later durable rounds receive distinct operation keys", async () => {
  const preparedKeys: string[] = [];
  const ctx = createMockCtx({
    runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
      if ("inputHash" in args) {
        preparedKeys.push(String(args.operationKey));
        return { decision: "execute" as const };
      }
      return null;
    },
  });
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "slack_send_message",
    description: "Send a message",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true, data: {} }),
  }));
  for (const operationScope of ["job_1:continuation:0", "job_1:continuation:1"]) {
    await registry.executeToolCall({
      id: crypto.randomUUID(),
      type: "function",
      function: { name: "slack_send_message", arguments: '{"text":"hello"}' },
    }, {
      ctx,
      userId: "user_1",
      jobId: "job_1",
      executionAttemptId: "attempt_1" as Id<"executionAttempts">,
      executionFence: 8,
      operationScope,
    });
  }
  assert.equal(new Set(preparedKeys).size, 2);
});

test("safe read failures reset for retry instead of becoming outcome unknown", async () => {
  const mutationCalls: Array<Record<string, unknown>> = [];
  const mutationNames: string[] = [];
  const ctx = createMockCtx({
    runMutation: async (reference: unknown, args: Record<string, unknown>) => {
      mutationCalls.push(args);
      mutationNames.push(getFunctionName(reference as never));
      if ("inputHash" in args) return { decision: "execute" as const };
      return null;
    },
  });
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "gmail_read",
    description: "Read mail",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      throw new Error("temporary provider outage");
    },
  }));
  await registry.executeToolCall({
    id: "call_read",
    type: "function",
    function: { name: "gmail_read", arguments: "{}" },
  }, {
    ctx,
    userId: "user_1",
    jobId: "job_1",
    executionAttemptId: "attempt_1" as Id<"executionAttempts">,
    executionFence: 9,
  });
  assert.ok(mutationCalls.some((entry) => entry.errorSummary === "temporary provider outage"));
  assert.ok(mutationNames.includes("execution/operations:resetSafeFailure"));
  assert.equal(mutationNames.includes("execution/operations:markOutcomeUnknown"), false);
});

test("a successful provider write is reconciled when fenced journal completion loses its lease", async () => {
  const mutationNames: string[] = [];
  let executions = 0;
  const ctx = createMockCtx({
    runMutation: async (reference: unknown) => {
      const name = getFunctionName(reference as never);
      mutationNames.push(name);
      if (name === "execution/operations:prepare") {
        return { decision: "execute" as const };
      }
      if (name === "execution/operations:complete") {
        throw new Error("STALE_EXECUTION_FENCE");
      }
      return null;
    },
  });
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "slack_send_message",
    description: "Send a message",
    parameters: { type: "object", properties: {} },
    execute: async () => {
      executions += 1;
      return { success: true, data: { messageId: "m1" } };
    },
  }));

  const result = await registry.executeToolCall({
    id: "call_observed",
    type: "function",
    function: { name: "slack_send_message", arguments: "{}" },
  }, {
    ctx,
    userId: "user_1",
    jobId: "job_1",
    executionAttemptId: "attempt_1" as Id<"executionAttempts">,
    executionFence: 11,
  });

  assert.equal(result.result.success, true);
  assert.equal(executions, 1);
  assert.ok(mutationNames.includes("execution/operations:recordObservedExternalOutcome"));
  assert.equal(mutationNames.includes("execution/operations:markOutcomeUnknown"), false);
});
