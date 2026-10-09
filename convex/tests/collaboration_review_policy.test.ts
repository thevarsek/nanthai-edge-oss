import assert from "node:assert/strict";
import test from "node:test";
import { createMockCtx } from "../../test_helpers/convex_mock_ctx";
import { createTool, ToolRegistry } from "../tools/registry";

test("opt-in read-only review prevents actual resource writes before journal or adapter dispatch", async () => {
  let writes = 0;
  const registry = new ToolRegistry();
  registry.register(createTool({ name: "test_writer", description: "Writes a resource",
    parameters: { type: "object", properties: {} }, effectPolicy: { effect: "write", retry: "safe" },
    execute: async () => { writes += 1; return { success: true, data: null }; } }));
  const call = { id: "write", type: "function" as const, function: { name: "test_writer", arguments: "{}" } };
  const context = { ctx: createMockCtx({}), userId: "owner", readOnlyReview: true };
  const blocked = await registry.executeToolCall(call, context);
  assert.equal(blocked.result.success, false);
  assert.match(blocked.result.error ?? "", /read-only review/);
  assert.equal(writes, 0);
  assert.equal((await registry.executeToolCall(call, { ...context, readOnlyReview: false })).result.success, true);
  assert.equal(writes, 1);
});

test("read-only review still permits reads and committing the scoped review findings", async () => {
  const registry = new ToolRegistry();
  for (const [name, effect] of [["test_reader", "read"], ["update_collaboration_work", "write"]] as const) {
    registry.register(createTool({ name, description: name, parameters: { type: "object", properties: {} },
      effectPolicy: { effect, retry: "safe" }, execute: async () => ({ success: true, data: name }) }));
    const result = await registry.executeToolCall({ id: name, type: "function",
      function: { name, arguments: "{}" } }, { ctx: createMockCtx({}), userId: "owner", readOnlyReview: true });
    assert.equal(result.result.success, true);
  }
});
