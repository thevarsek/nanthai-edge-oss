import assert from "node:assert/strict";
import test from "node:test";
import {
  claimInvocationOperation,
  createInvocation,
  finishInvocation,
} from "../mcp/invocation_mutations";
import { mcpJsonFromStorage } from "../mcp/json_codec";

test("standalone MCP invocations do not require a pre-existing execution owner", async () => {
  const inserted: Array<{ table: string; value: Record<string, unknown> }> = [];
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({ unique: async () => null }),
      }),
      insert: async (table: string, value: Record<string, unknown>) => {
        inserted.push({ table, value });
        return "invocation_1";
      },
    },
  };
  const result = await (createInvocation as unknown as {
    _handler: (ctx: unknown, args: Record<string, unknown>) => Promise<string>;
  })._handler(ctx, {
    userId: "user_1",
    publicId: "public_1",
    connectionId: "connection_1",
    catalogItemId: "item_1",
    catalogStableKey: "prompt:worker",
    itemName: "Worker prompt",
    kind: "prompt",
    method: "prompts/get",
    requestHash: "hash_1",
    requestParams: { "$schema": "https://example.test/schema", "città": "Roma" },
  });

  assert.equal(result, "invocation_1");
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]?.table, "mcpInvocations");
  assert.equal(inserted[0]?.value.state, "dispatching");
  assert.equal(inserted[0]?.value.runId, undefined);
  assert.equal(inserted[0]?.value.catalogStableKey, "prompt:worker");
  assert.equal(inserted[0]?.value.itemName, "Worker prompt");
  assert.deepEqual(mcpJsonFromStorage(inserted[0]?.value.requestParams), {
    "$schema": "https://example.test/schema",
    "città": "Roma",
  });
});

test("MCP continuation claims are atomic and terminal states are monotonic", async () => {
  let invocation = {
    _id: "invocation_1",
    state: "awaiting_input",
    updatedAt: 1,
    taskId: undefined,
    activeOperationKey: undefined as string | undefined,
  };
  const ctx = {
    db: {
      get: async () => invocation,
      patch: async (_id: string, values: Record<string, unknown>) => {
        invocation = { ...invocation, ...values } as typeof invocation;
      },
    },
  };
  const claim = (claimInvocationOperation as unknown as {
    _handler: (context: unknown, args: Record<string, unknown>) => Promise<boolean>;
  })._handler;
  const finish = (finishInvocation as unknown as {
    _handler: (context: unknown, args: Record<string, unknown>) => Promise<boolean>;
  })._handler;

  assert.equal(await claim(ctx, {
    invocationId: "invocation_1",
    operationKey: "operation_1",
    mode: "continuation",
  }), true);
  assert.equal(invocation.state, "dispatching");
  assert.equal(await claim(ctx, {
    invocationId: "invocation_1",
    operationKey: "operation_2",
    mode: "continuation",
  }), false);
  assert.equal(await finish(ctx, {
    invocationId: "invocation_1",
    state: "cancelled",
    expectedOperationKey: "operation_1",
    result: { "$result": { "città": "Roma" } },
  }), true);
  assert.deepEqual(mcpJsonFromStorage((invocation as Record<string, unknown>).result), {
    "$result": { "città": "Roma" },
  });
  assert.equal(await finish(ctx, {
    invocationId: "invocation_1",
    state: "completed",
    expectedOperationKey: "operation_1",
  }), false);
  assert.equal(invocation.state, "cancelled");
});

test("generic continuation claims cannot consume task input", async () => {
  const invocation = {
    _id: "invocation_1",
    state: "awaiting_input",
    updatedAt: 1,
    taskId: "task_1",
  };
  const claim = (claimInvocationOperation as unknown as {
    _handler: (context: unknown, args: Record<string, unknown>) => Promise<boolean>;
  })._handler;
  const claimed = await claim({ db: { get: async () => invocation } }, {
    invocationId: "invocation_1",
    operationKey: "operation_1",
    mode: "continuation",
  });
  assert.equal(claimed, false);
});
