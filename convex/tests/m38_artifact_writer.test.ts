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

test("artifact writer preserves full raw args/results and stores oversized payloads", async () => {
  const mutations: Array<Record<string, any>> = [];
  const stored: Blob[] = [];
  const ctx = {
    storage: {
      store: async (blob: Blob) => {
        stored.push(blob);
        return `storage_${stored.length}`;
      },
    },
    runMutation: async (_ref: unknown, args: Record<string, any>) => {
      mutations.push(args);
      return args.artifacts.map((_artifact: unknown, index: number) => `artifact_${index + 1}`);
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
  const artifact = mutations[0]?.artifacts[0];
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
    },
    runMutation: async (_ref: unknown, args: Record<string, any>) => {
      mutations.push(args);
      return ["artifact_1"];
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

  const artifact = mutations[0]?.artifacts[0];
  assert.equal(stored.length, 2);
  assert.equal(artifact.argumentsRaw, undefined);
  assert.equal(artifact.resultRaw, undefined);
  assert.equal(artifact.argumentsStorageId, "storage_1");
  assert.equal(artifact.resultStorageId, "storage_2");
  assert.match(stored[0], /"query"/);
  assert.match(stored[1], /"text"/);
});

test("artifact writer marks deferred and failed calls as recovery context", async () => {
  const mutations: Array<Record<string, any>> = [];
  const ctx = {
    storage: { store: async () => "storage_1" },
    runMutation: async (_ref: unknown, args: Record<string, any>) => {
      mutations.push(args);
      return ["artifact_1", "artifact_2"];
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

  const artifacts = mutations[0]?.artifacts;
  assert.equal(artifacts[0].status, "deferred");
  assert.equal(artifacts[0].deferredKind, "drive_picker");
  assert.equal(artifacts[0].contextClass, "recovery");
  assert.equal(artifacts[1].status, "failed");
  assert.equal(artifacts[1].isError, true);
  assert.equal(artifacts[1].privacyClassification, "google_data");
});
