import assert from "node:assert/strict";
import test from "node:test";

import { attachRemoteMcpArtifacts } from "../tools/artifact_mcp_linker";

test("remote MCP artifacts are linked with their exact chat, job, and execution fence", async () => {
  const mutations: Array<Record<string, unknown>> = [];
  await attachRemoteMcpArtifacts({
    ctx: {
      runMutation: async (_reference: unknown, args: Record<string, unknown>) => {
        mutations.push(args);
      },
    } as never,
    metadata: {
      userId: "user-1",
      chatId: "chat-1" as never,
      jobId: "job-1" as never,
      executionAttemptId: "attempt-1" as never,
      executionFence: 7,
    },
    toolCalls: [{
      id: "call-1",
      type: "function",
      function: { name: "mcp_server_search", arguments: "{}" },
    }],
    results: [{
      toolCallId: "call-1",
      result: { success: true, data: { invocationId: "invocation-1" } },
    }],
  }, ["artifact-1" as never]);

  assert.deepEqual(mutations, [{
    publicId: "invocation-1",
    userId: "user-1",
    chatId: "chat-1",
    jobId: "job-1",
    artifactIds: ["artifact-1"],
    executionAttemptId: "attempt-1",
    executionFence: 7,
  }]);
});

test("non-MCP tool results do not create invocation links", async () => {
  let mutationCount = 0;
  await attachRemoteMcpArtifacts({
    ctx: {
      runMutation: async () => { mutationCount += 1; },
    } as never,
    metadata: {
      userId: "user-1",
      chatId: "chat-1" as never,
      jobId: "job-1" as never,
    },
    toolCalls: [{
      id: "call-1",
      type: "function",
      function: { name: "ordinary_tool", arguments: "{}" },
    }],
    results: [{ toolCallId: "call-1", result: { success: true, data: {} } }],
  }, ["artifact-1" as never]);

  assert.equal(mutationCount, 0);
});
