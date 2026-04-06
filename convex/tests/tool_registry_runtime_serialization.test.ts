import assert from "node:assert/strict";
import test from "node:test";

import { createTool, ToolRegistry } from "../tools/registry";

test("workspace and analytics tools are serialized within one tool round", async () => {
  const registry = new ToolRegistry();
  const starts: string[] = [];
  const finishes: string[] = [];

  const makeTool = (name: string, delayMs: number) =>
    createTool({
      name,
      description: name,
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        starts.push(name);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        finishes.push(name);
        return { success: true, data: { name } };
      },
    });

  registry.register(
    makeTool("workspace_import_file", 30),
    makeTool("data_python_exec", 10),
    makeTool("fetch_image", 5),
  );

  const startedAt = Date.now();
  const results = await registry.executeAllToolCalls([
    {
      id: "call_1",
      type: "function",
      function: { name: "workspace_import_file", arguments: "{}" },
    },
    {
      id: "call_2",
      type: "function",
      function: { name: "data_python_exec", arguments: "{}" },
    },
    {
      id: "call_3",
      type: "function",
      function: { name: "fetch_image", arguments: "{}" },
    },
  ], {
    ctx: {} as any,
    userId: "user_123",
    chatId: "chat_123",
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((entry) => entry.result.success),
    [true, true, true],
  );
  assert.equal(starts.indexOf("workspace_import_file") >= 0, true);
  assert.equal(starts.indexOf("data_python_exec") >= 0, true);
  assert.equal(finishes.indexOf("workspace_import_file") >= 0, true);
  assert.equal(finishes.indexOf("data_python_exec") >= 0, true);
  assert.ok(
    finishes.indexOf("workspace_import_file") < starts.indexOf("data_python_exec"),
    "Expected data_python_exec to start only after workspace_import_file finished",
  );
  assert.ok(
    elapsedMs >= 35,
    `Expected serialized runtime tools to take at least 35ms, got ${elapsedMs}ms`,
  );
});
