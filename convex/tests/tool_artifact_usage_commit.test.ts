import assert from "node:assert/strict";
import test from "node:test";

import { persistArtifactCapture } from "../tools/artifact_persistence";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";

const artifact = {
  userId: "user_1",
  chatId: "chat_1",
  messageId: "message_1",
  jobId: "job_1",
  runtimeKind: "chat_generation" as const,
  visibilityScope: "participant" as const,
  runtimeIsolationPolicy: "isolated" as const,
  toolCallId: "call_1",
  toolName: "web_search",
  round: 1,
  argumentsRaw: "{}",
  argumentsHash: "args_hash",
  argumentsBytes: 2,
  resultRaw: "{}",
  resultHash: "result_hash",
  resultBytes: 2,
  status: "completed" as const,
  privacyClassification: "normal" as const,
  contextClass: "operational" as const,
};

const usage = {
  messageId: "message_1",
  chatId: "chat_1",
  userId: "user_1",
  modelId: "openai/gpt-5",
  promptTokens: 4,
  completionTokens: 2,
  totalTokens: 6,
  cost: 0.001,
  source: "tool_web_search",
  idempotencyKey: "capture_1:tool:0:web_search",
};

test("artifact winner atomically owns usage and retry inserts neither twice", async () => {
  const artifactRows: Array<Record<string, unknown> & { _id: string }> = [];
  const usageRows: Array<Record<string, unknown> & { _id: string }> = [];
  const rows = {
    accountDeletionTombstones: [],
    chats: [{ _id: "chat_1", userId: "user_1" }],
    generationJobs: [{
      _id: "job_1",
      userId: "user_1",
      chatId: "chat_1",
      status: "streaming",
    }],
    toolExecutionArtifacts: artifactRows,
    toolMemories: [],
    usageRecords: usageRows,
    cachedModels: [],
  };
  const ctx = createStatefulMockCtx(rows) as never;
  const args = {
    captureKey: "capture_1",
    artifacts: [artifact] as never,
    usages: [usage] as never,
    extractMemories: false,
  };

  const first = await persistArtifactCapture(ctx, args);
  const replay = await persistArtifactCapture(ctx, args);

  assert.equal(first.inserted, true);
  assert.equal(replay.inserted, false);
  assert.equal(artifactRows.length, 1);
  assert.equal(usageRows.length, 1);
  assert.equal(usageRows[0]?.idempotencyKey, usage.idempotencyKey);
});

test("artifact commit after an account tombstone writes no artifact or usage", async () => {
  const artifactRows: Array<Record<string, unknown> & { _id: string }> = [];
  const usageRows: Array<Record<string, unknown> & { _id: string }> = [];
  const rows = {
    accountDeletionTombstones: [{ _id: "tombstone_1", userId: "user_1" }],
    chats: [{ _id: "chat_1", userId: "user_1" }],
    generationJobs: [{
      _id: "job_1",
      userId: "user_1",
      chatId: "chat_1",
      status: "streaming",
    }],
    toolExecutionArtifacts: artifactRows,
    toolMemories: [],
    usageRecords: usageRows,
    cachedModels: [],
  };
  const result = await persistArtifactCapture(createStatefulMockCtx(rows) as never, {
    captureKey: "capture_1",
    artifacts: [artifact] as never,
    usages: [usage] as never,
    extractMemories: false,
  });

  assert.equal(result.stale, true);
  assert.equal(artifactRows.length, 0);
  assert.equal(usageRows.length, 0);
});
