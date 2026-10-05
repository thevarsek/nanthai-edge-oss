import test from "node:test";
import assert from "node:assert/strict";
import type { Id } from "../_generated/dataModel";
import { createPermissionFixture, permissionHost } from "./runtime_host_permission_fixture";
import { importOfflineResultHandler } from "../runtime_host/offline_import";
import { sha256Hex } from "../runtime_host/security";

async function fixture() {
  const fixture = await createPermissionFixture();
  Object.assign(fixture.rows.executionRuns[0], { state: "completed" });
  Object.assign(fixture.rows.generationJobs[0], { status: "completed" });
  Object.assign(fixture.rows.messages[0], { content: "Saved answer", status: "completed", parentMessageIds: [] });
  Object.assign(fixture.rows.chats[0], { activeBranchLeafId: "message-1", messageCount: 1 });
  fixture.rows.generatedFiles = [];
  fixture.rows.runtimeOfflineImports = [];
  const ctx = fixture.ctx;
  ctx.storage.getMetadata = async () => ({ storageId: "storage-1" as Id<"_storage">, size: 5, contentType: "text/plain", sha256: "hash" });
  return fixture;
}
async function args() {
  return { ...permissionHost, id: "result-1", originRunId: "run-1" as Id<"executionRuns">,
    previousResultId: null, inputHash: "immutable", baseOutputHash: await sha256Hex("Saved answer"),
    prompt: "Continue", output: "Local answer", outcome: "completed" as const, createdAt: 1,
    files: [{ storageId: "storage-1" as Id<"_storage">, filename: "answer.txt", mimeType: "text/plain", sizeBytes: 5 }], usageJson: "[]" };
}
test("unchanged shared task imports answer/artifact once, including lost acknowledgement replay", async () => {
  const { ctx, rows, state } = await fixture();
  const input = await args();
  const first = await importOfflineResultHandler(ctx, input);
  assert.equal(first.disposition, "synced");
  assert.equal(rows.chats[0].activeBranchLeafId, first.assistantMessageId);
  const second = await importOfflineResultHandler(ctx, { ...input, files: [{ ...input.files[0], storageId: "storage-retry" as Id<"_storage"> }] });
  assert.deepEqual(second, first);
  assert.equal(rows.messages.length, 3);
  assert.equal(rows.generatedFiles.length, 1);
  assert.deepEqual(state.storageDeletes, ["storage-retry"]);
  assert.equal(rows.executionRuns[0].state, "completed");
  const { messageExecutionRoute } = await import("../chat/queries_message_handlers");
  const route = await messageExecutionRoute(ctx, rows.messages.find(message => message._id === first.assistantMessageId) as never);
  assert.equal(route?.placement, "local");
});
test("changed or cancelled tasks retain a separate branch and never reopen or overwrite", async () => {
  for (const change of ["cancelled", "frontier", "edited"]) {
    const { ctx, rows } = await fixture();
    if (change === "cancelled") rows.executionRuns[0].state = "cancelled";
    if (change === "frontier") rows.chats[0].activeBranchLeafId = "new-shared-message";
    if (change === "edited") rows.messages[0].content = "Edited answer";
    const frontier = rows.chats[0].activeBranchLeafId;
    const result = await importOfflineResultHandler(ctx, await args());
    assert.equal(result.disposition, "review");
    assert.equal(rows.chats[0].activeBranchLeafId, frontier);
    assert.equal(rows.executionRuns[0].state, change === "cancelled" ? "cancelled" : "completed");
    assert.equal(rows.messages[2].content, "Local answer");
    assert.deepEqual(rows.messages[1].parentMessageIds, ["message-1"]);
  }
});
test("idempotency cannot hide changed payloads; device and linked-task ownership are required", async () => {
  const { ctx, rows } = await fixture();
  const input = await args();
  await importOfflineResultHandler(ctx, input);
  await assert.rejects(importOfflineResultHandler(ctx, { ...input, inputHash: "changed" }), /IMPORT_IDENTITY_CHANGED/);
  rows.executionAttempts[0].deviceId = "another-device";
  await assert.rejects(importOfflineResultHandler(ctx, { ...input, id: "new-result" }), /SAVED_TASK_UNAVAILABLE/);
  assert.equal(rows.runtimeOfflineImports.length, 1);
});
test("linked local follow-ups synchronize in order while preserving review disposition", async () => {
  const { ctx, rows } = await fixture();
  const input = await args();
  const first = await importOfflineResultHandler(ctx, input);
  const next = await importOfflineResultHandler(ctx, { ...input, id: "result-2", previousResultId: "result-1", inputHash: "next", files: [] });
  assert.equal(next.disposition, "synced");
  assert.deepEqual(rows.messages[3].parentMessageIds, [first.assistantMessageId]);
  assert.equal(rows.chats[0].activeBranchLeafId, next.assistantMessageId);
});

test("saved usage counts owned root/child reports once and keeps unknown reasoning unknown", async () => {
  const { ctx, rows } = await fixture();
  const { importOfflineUsage } = await import("../runtime_host/offline_import_usage");
  const base = { protocolVersion: "nanthai.runtime.v1", eventId: "root-1", sequence: 1, occurredAt: 1,
    runId: "local-result-1", attemptId: "local-attempt-result-1", fence: 1, sessionId: "session",
    type: "usage_reported", actualModel: { provider: "openai", modelId: "model", reportedByAdapter: true },
    tokens: { input: 10, output: 5, cachedInput: 2, reasoning: null, total: 15 },
    cost: { source: "unpriced", reason: "subscription cost is not reported" } };
  const child = { ...base, eventId: "child-1", nativeAgentThreadId: "child-thread", tokens: { ...base.tokens, input: 3, output: 2, total: 5 } };
  await importOfflineUsage(ctx, { json: JSON.stringify([base, base, child, child]), localResultId: "result-1",
    messageId: "message-1" as never, chatId: "chat-1" as never, userId: "user", deviceId: "device", adapterId: "pi" });
  assert.equal(rows.usageRecords.length, 2);
  const root = rows.usageRecords.find(record => record.source === "runtime_generation");
  assert.ok(root);
  assert.equal(root.promptTokens, 10);
  assert.equal(root.reasoningTokens, undefined);
  assert.equal(root.cost, undefined);
  assert.equal(rows.usageRecords.find(record => record.source === "runtime_native_child")?.promptTokens, 3);
});
