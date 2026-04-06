import assert from "node:assert/strict";
import test from "node:test";

import { ToolRegistry, createTool } from "../tools/registry";
import { SubagentStreamWriter } from "../subagents/stream_writer";
import {
  guessMimeTypeFromPath,
  isTextLikeMime,
  runtimeWorkspaceCwd,
  runtimeWorkspacePaths,
} from "../runtime/shared";

test("ToolRegistry executeAllToolCalls serializes workspace/notion tools and preserves input order", async () => {
  const registry = new ToolRegistry();
  const executionOrder: string[] = [];

  const makeTool = (name: string, delay: number) =>
    createTool({
      name,
      description: name,
      parameters: { type: "object", properties: {} },
      execute: async () => {
        executionOrder.push(`start:${name}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        executionOrder.push(`end:${name}`);
        return { success: true, data: { name } };
      },
    });

  registry.register(
    makeTool("workspace_exec", 5),
    makeTool("notion_search", 1),
    makeTool("search_chats", 1),
  );

  const results = await registry.executeAllToolCalls([
    { id: "1", type: "function", function: { name: "workspace_exec", arguments: "{}" } },
    { id: "2", type: "function", function: { name: "search_chats", arguments: "{}" } },
    { id: "3", type: "function", function: { name: "notion_search", arguments: "{}" } },
  ], {
    ctx: {} as any,
    userId: "user_1",
  });

  assert.deepEqual(results.map((row) => row.toolCallId), ["1", "2", "3"]);
  assert.ok(executionOrder.indexOf("end:workspace_exec") < executionOrder.indexOf("start:notion_search"));
});

test("ToolRegistry executeToolCall reports unknown tools and invalid JSON arguments", async () => {
  const registry = new ToolRegistry();
  registry.register(createTool({
    name: "search_chats",
    description: "search",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ success: true, data: {} }),
  }));

  const unknown = await registry.executeToolCall({
    id: "1",
    type: "function",
    function: { name: "missing_tool", arguments: "{}" },
  }, {
    ctx: {} as any,
    userId: "user_1",
  });

  const invalid = await registry.executeToolCall({
    id: "2",
    type: "function",
    function: { name: "search_chats", arguments: "{oops" },
  }, {
    ctx: {} as any,
    userId: "user_1",
  });

  assert.equal(unknown.result.success, false);
  assert.match(String(unknown.result.error ?? ""), /Unknown tool/);
  assert.equal(invalid.result.success, false);
  assert.match(String(invalid.result.error ?? ""), /Failed to parse arguments/);
});

test("runtime shared helpers derive stable workspace paths and text MIME detection", () => {
  assert.equal(runtimeWorkspaceCwd("chat_1"), "/tmp/nanthai-edge/chat_1");
  assert.deepEqual(runtimeWorkspacePaths("chat_1"), {
    root: "/tmp/nanthai-edge/chat_1",
    inputs: "/tmp/nanthai-edge/chat_1/inputs",
    outputs: "/tmp/nanthai-edge/chat_1/outputs",
    charts: "/tmp/nanthai-edge/chat_1/charts",
  });
  assert.equal(isTextLikeMime("application/json"), true);
  assert.equal(isTextLikeMime("application/pdf"), false);
  assert.equal(guessMimeTypeFromPath("report.md"), "text/markdown");
  assert.equal(
    guessMimeTypeFromPath("deck.pptx"),
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  );
});

test("SubagentStreamWriter flushes streaming content and reasoning with beforePatch hook", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  let beforePatchCalls = 0;

  const writer = new SubagentStreamWriter({
    ctx: {
      runMutation: async (_fn: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    } as any,
    runId: "run_1" as any,
    beforePatch: async () => {
      beforePatchCalls += 1;
    },
  });

  await writer.appendReasoning("Planning");
  await writer.handleContentDeltaBoundary(5);
  await writer.appendContent("Hello world");
  await writer.flush();

  assert.equal(beforePatchCalls >= 2, true);
  assert.equal(writer.hasSeenContentDelta, true);
  assert.equal(writer.totalContent, "Hello world");
  assert.equal(writer.totalReasoning, "Planning");
  assert.equal(mutations[0]?.reasoning, "Planning");
  assert.ok(mutations.some((mutation) => mutation.content === "Hello world" && mutation.status === "streaming"));
});
