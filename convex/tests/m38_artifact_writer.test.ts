import assert from "node:assert/strict";
import test from "node:test";

import { captureToolRoundArtifacts } from "../tools/artifact_writer";
import type { ToolCall } from "../lib/openrouter_types";

function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return {
    id,
    type: "function",
    function: { name, arguments: JSON.stringify(args) },
  };
}

function artifactMutationResult(args: Record<string, any>) {
  if (!Array.isArray(args.artifacts)) {
    return { decision: "execute", artifactIds: [] };
  }
  return {
    inserted: true,
    stale: false,
    artifactIds: args.artifacts.map((_artifact: unknown, index: number) => `artifact_${index + 1}`),
  };
}

test("artifact writer preserves full raw args/results and stores oversized payloads", async () => {
  const mutations: Array<Record<string, any>> = [];
  const stored: Blob[] = [];
  const ctx = {
    storage: {
      store: async (blob: Blob) => {
        stored.push(blob);
        return `storage_${stored.length}`;
      },
      delete: async () => undefined,
    },
    runMutation: async (_ref: unknown, args: Record<string, any>) => {
      mutations.push(args);
      return artifactMutationResult(args);
    },
  } as any;

  const large = "x".repeat(100_000);
  const ids = await captureToolRoundArtifacts({
    ctx,
    metadata: {
      userId: "user_1",
      chatId: "chat_1" as any,
      messageId: "msg_1" as any,
      jobId: "job_1" as any,
      sourceUserMessageId: "user_msg_1" as any,
      ownerParticipantId: "p1",
      ownerModelRunId: "job_1",
      provider: "openai",
      runtime: "mobileBasic",
      activeProfiles: ["documents"],
    },
    round: 2.0,
    toolCalls: [toolCall("call_1", "read_document", { doc_id: "doc-0" })],
    results: [{
      toolCallId: "call_1",
      result: { success: true, data: { text: large, filename: "brief.docx" } },
    }],
  });

  assert.deepEqual(ids, ["artifact_1"]);
  assert.equal(stored.length, 1);
  const artifact = mutations.find((entry) => Array.isArray(entry.artifacts))?.artifacts[0];
  assert.equal(artifact.toolCallId, "call_1");
  assert.equal(artifact.argumentsRaw, "{\"doc_id\":\"doc-0\"}");
  assert.equal(artifact.resultRaw, undefined);
  assert.equal(artifact.resultStorageId, "storage_1");
  assert.equal(artifact.argumentsStorageId, undefined);
  assert.equal(artifact.status, "completed");
  assert.equal(artifact.privacyClassification, "document_data");
  assert.equal(artifact.contextClass, "operational");
  assert.equal(typeof artifact.resultHash, "string");
  assert.ok(artifact.resultBytes > 100_000);
});

test("artifact writer stores oversized args and results under separate storage ids", async () => {
  const mutations: Array<Record<string, any>> = [];
  const stored: string[] = [];
  const ctx = {
    storage: {
      store: async (blob: Blob) => {
        stored.push(await blob.text());
        return `storage_${stored.length}`;
      },
      delete: async () => undefined,
    },
    runMutation: async (_ref: unknown, args: Record<string, any>) => {
      mutations.push(args);
      return artifactMutationResult(args);
    },
  } as any;

  const largeArgs = { query: "a".repeat(100_000) };
  const largeResult = { text: "b".repeat(100_000) };
  await captureToolRoundArtifacts({
    ctx,
    metadata: {
      userId: "user_1",
      chatId: "chat_1" as any,
      messageId: "msg_1" as any,
      jobId: "job_1" as any,
    },
    round: 1.0,
    toolCalls: [toolCall("call_large", "read_document", largeArgs)],
    results: [{
      toolCallId: "call_large",
      result: { success: true, data: largeResult },
    }],
  });

  const artifact = mutations.find((entry) => Array.isArray(entry.artifacts))?.artifacts[0];
  assert.equal(stored.length, 2);
  assert.equal(artifact.argumentsRaw, undefined);
  assert.equal(artifact.resultRaw, undefined);
  assert.equal(artifact.argumentsStorageId, "storage_1");
  assert.equal(artifact.resultStorageId, "storage_2");
  assert.match(stored[0], /"query"/);
  assert.match(stored[1], /"text"/);
});

test("artifact writer atomically commits materialized web_search usage with artifacts", async () => {
  const mutations: Array<Record<string, any>> = [];
  const ctx = {
    storage: { store: async () => "storage_1", delete: async () => undefined },
    runMutation: async (_ref: unknown, args: Record<string, any>) => {
      mutations.push(args);
      return artifactMutationResult(args);
    },
  } as any;

  await captureToolRoundArtifacts({
    ctx,
    metadata: {
      userId: "user_1",
      chatId: "chat_1" as any,
      messageId: "msg_1" as any,
      jobId: "job_1" as any,
    },
    round: 1.0,
    toolCalls: [toolCall("call_web", "web_search", { query: "current news" })],
    results: [{
      toolCallId: "call_web",
      result: {
        success: true,
        data: { content: "summary" },
        artifactData: {
          content: "summary",
          usage: {
            promptTokens: 11,
            completionTokens: 7,
            totalTokens: 18,
            cost: 0.0012,
            isByok: true,
            webSearchRequests: 1,
          },
          generationId: "gen_web_1",
          modelId: "openai/gpt-5",
        },
      },
    }],
  });

  const artifactInsert = mutations.find((entry) => Array.isArray(entry.artifacts));
  const usageMutation = artifactInsert?.usages[0];
  assert.equal(usageMutation?.messageId, "msg_1");
  assert.equal(usageMutation?.modelId, "openai/gpt-5");
  assert.equal(usageMutation?.promptTokens, 11);
  assert.equal(usageMutation?.completionTokens, 7);
  assert.equal(usageMutation?.totalTokens, 18);
  assert.equal(usageMutation?.cost, 0.0012);
  assert.equal(usageMutation?.isByok, true);
  assert.equal(usageMutation?.webSearchRequests, 1);
  assert.equal(usageMutation?.generationId, "gen_web_1");
  assert.match(String(usageMutation?.idempotencyKey), /^[a-f0-9]{64}:tool:0:web_search$/);
  assert.equal(artifactInsert?.artifacts[0].toolName, "web_search");
  assert.equal(mutations.some((entry) => entry.source === "tool_web_search"), false);
});

test("artifact writer marks deferred and failed calls as recovery context", async () => {
  const mutations: Array<Record<string, any>> = [];
  const ctx = {
    storage: { store: async () => "storage_1", delete: async () => undefined },
    runMutation: async (_ref: unknown, args: Record<string, any>) => {
      mutations.push(args);
      return artifactMutationResult(args);
    },
  } as any;

  await captureToolRoundArtifacts({
    ctx,
    metadata: {
      userId: "user_1",
      chatId: "chat_1" as any,
      messageId: "msg_1" as any,
      jobId: "job_1" as any,
    },
    round: 1.0,
    toolCalls: [
      toolCall("call_drive", "drive_picker", {}),
      toolCall("call_fail", "gmail_fetch", {}),
    ],
    results: [
      {
        toolCallId: "call_drive",
        result: {
          success: true,
          data: { requiresDrivePicker: true },
          deferred: { kind: "drive_picker", data: { prompt: "pick" } },
        },
      },
      {
        toolCallId: "call_fail",
        result: { success: false, error: "missing scope", data: { code: "AUTH" } },
      },
    ],
  });

  const artifacts = mutations.find((entry) => Array.isArray(entry.artifacts))?.artifacts;
  assert.equal(artifacts[0].status, "deferred");
  assert.equal(artifacts[0].deferredKind, "drive_picker");
  assert.equal(artifacts[0].contextClass, "recovery");
  assert.equal(artifacts[1].status, "failed");
  assert.equal(artifacts[1].isError, true);
  assert.equal(artifacts[1].privacyClassification, "google_data");
});

test("artifact writer rejects a stale capture before creating blobs or usage", async () => {
  let stores = 0;
  const mutations: Array<Record<string, any>> = [];
  const ctx = {
    storage: {
      store: async () => { stores += 1; return "storage_1"; },
      delete: async () => undefined,
    },
    runMutation: async (_ref: unknown, args: Record<string, any>) => {
      mutations.push(args);
      return { decision: "stale", artifactIds: [] };
    },
  } as any;

  const ids = await captureToolRoundArtifacts({
    ctx,
    metadata: {
      userId: "user_1", chatId: "chat_1" as any, messageId: "msg_1" as any,
      jobId: "job_1" as any, executionAttemptId: "attempt_old" as any, executionFence: 1,
    },
    round: 1,
    toolCalls: [toolCall("call_1", "web_search", { query: "news" })],
    results: [{
      toolCallId: "call_1",
      result: {
        success: true,
        data: {},
        artifactData: {
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          generationId: "generation_stale",
          modelId: "openai/gpt-5",
        },
      },
    }],
  });

  assert.deepEqual(ids, []);
  assert.equal(stores, 0);
  assert.equal(mutations.some((entry) => entry.source === "tool_web_search"), false);
});

test("artifact capture race loser removes duplicate oversized blobs", async () => {
  const deleted: string[] = [];
  let mutationCount = 0;
  const ctx = {
    storage: {
      store: async () => "storage_duplicate",
      delete: async (storageId: string) => { deleted.push(storageId); },
    },
    runMutation: async () => {
      mutationCount += 1;
      if (mutationCount === 1) return { decision: "execute", artifactIds: [] };
      return { inserted: false, stale: false, artifactIds: ["artifact_existing"] };
    },
  } as any;

  const ids = await captureToolRoundArtifacts({
    ctx,
    metadata: { userId: "user_1", chatId: "chat_1" as any, messageId: "msg_1" as any, jobId: "job_1" as any },
    round: 1,
    toolCalls: [toolCall("call_1", "read_document", {})],
    results: [{ toolCallId: "call_1", result: { success: true, data: { text: "x".repeat(100_000) } } }],
  });

  assert.deepEqual(ids, ["artifact_existing"]);
  assert.deepEqual(deleted, ["storage_duplicate"]);
});
