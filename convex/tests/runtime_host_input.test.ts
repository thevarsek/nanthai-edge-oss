import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createPermissionFixture, permissionHost, permissionRequestedEvent } from "./runtime_host_permission_fixture";
import { ingestRuntimeEventHandler } from "../runtime_host/chat_event_ingestion";
import { listMyPendingPermissionsHandler } from "../runtime_host/permissions";
import { respondToRuntimeInput, decryptRuntimeInputPayload } from "../runtime_host/input_requests";
import { closeRuntimePermissionsForRun } from "../runtime_host/permission_ingestion";
import { validateRuntimeInput } from "../runtime_host/input_form";
import type { Doc } from "../_generated/dataModel";

function inputEvent(now: number) {
  const envelope = permissionRequestedEvent(0, now);
  return { ...envelope, payload: { ...envelope.payload, payload: { sessionId: "attempt-1", event: {
    protocolVersion: "nanthai.runtime.v1", eventId: "input-1", sequence: 0, occurredAt: now,
    runId: "run-1", attemptId: "attempt-1", fence: 7, sessionId: "attempt-1", type: "input_requested",
    inputRequestId: "native-input-1", nativeAgentThreadId: null, source: "request_user_input",
    prompt: "Choose a destination", requestSchema: { questions: [{ id: "destination", question: "Where?", isSecret: true, options: [{ label: "A" }] }] }, sensitiveFieldPaths: ["answers.destination"],
  } } } };
}
test("native input is owned, encrypted, replayable, and closes with centralized teardown", async () => {
  const previous = process.env.CONVEX_SECRET_ENCRYPTION_KEY;
  process.env.CONVEX_SECRET_ENCRYPTION_KEY = "fixture-input-key";
  try {
    const state = await createPermissionFixture();
    const event = inputEvent(state.now);
    await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event });
    await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event });
    assert.equal(state.rows.runtimePermissionRequests.length, 1);
    const pending = await listMyPendingPermissionsHandler(state.ctx as unknown as QueryCtx, { userId: "user_1", chatId: "chat-1" as Id<"chats"> });
    assert.equal(pending[0].canRespond, true);
    assert.equal(pending[0].inputForm?.fields[0].secret, true);
    const args = { userId: "user_1", requestId: pending[0].requestId, outcome: "submitted" as const, content: JSON.stringify({ destination: "PRIVATE_TEST_INPUT" }) };
    await assert.rejects(respondToRuntimeInput(state.ctx, { ...args, userId: "another" }), /not found/);
    const commandId = await respondToRuntimeInput(state.ctx, args);
    assert.equal(await respondToRuntimeInput(state.ctx, args), commandId);
    const command = state.rows.runtimeCommands.find(row => row._id === commandId) as unknown as Doc<"runtimeCommands">;
    assert.ok(command.payload?.startsWith("enc:v2:"));
    assert.ok(!command.payload?.includes("PRIVATE_TEST_INPUT"));
    assert.ok(!JSON.stringify(state.rows.runEvents).includes("PRIVATE_TEST_INPUT"));
    assert.equal(JSON.parse((await decryptRuntimeInputPayload(command)) ?? "{}").response.content.destination, "PRIVATE_TEST_INPUT");
    await assert.rejects(decryptRuntimeInputPayload({ ...command, userId: "another" }));
    await assert.rejects(respondToRuntimeInput(state.ctx, { ...args, content: '{"destination":"changed"}' }), /already has a response/);
    await closeRuntimePermissionsForRun(state.ctx, "run-1" as Id<"executionRuns">, "cancelled");
    await assert.rejects(respondToRuntimeInput(state.ctx, args), /no longer active/);
  } finally { if (previous === undefined) delete process.env.CONVEX_SECRET_ENCRYPTION_KEY; else process.env.CONVEX_SECRET_ENCRYPTION_KEY = previous; }
});
test("input validates native required values and MCP typed/enumerated fields", () => {
  const raw = JSON.stringify({ source: "mcp_elicitation", requestSchema: { requestedSchema: { properties: { count: { type: "integer" }, color: { type: "string", enum: ["blue"] } }, required: ["count", "color"] } } });
  assert.deepEqual(validateRuntimeInput(raw, { count: 2, color: "blue" }), { count: 2, color: "blue" });
  assert.throws(() => validateRuntimeInput(raw, { count: 2.5, color: "blue" }));
  assert.throws(() => validateRuntimeInput(raw, { count: 2, color: "green" }));
});
