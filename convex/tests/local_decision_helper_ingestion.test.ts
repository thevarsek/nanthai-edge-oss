import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { createPermissionFixture, permissionHost, permissionRequestedEvent } from "./runtime_host_permission_fixture";
import { ingestRuntimeEventHandler } from "../runtime_host/chat_event_ingestion";
import { listMyPendingPermissionsHandler, respondToPermissionHandler } from "../runtime_host/permissions";

async function fixture() {
  const state = await createPermissionFixture();
  Object.assign(state.rows.executionRuns[0], { domainType: "local_helper", domainId: "helper-1", generationJobId: undefined, sourceMessageId: "message-1" });
  state.rows.generationJobs = [];
  state.rows.runtimeHelperTasks = [{ _id: "helper-1", userId: "user_1", chatId: "chat-1", sourceMessageId: "message-1", personaId: "persona-1", purpose: "decision",
    runId: "run-1", attemptId: "attempt-1", fence: 7, commandRecordId: "command-1", completionEventId: "event-1", content: "", status: "waiting", createdAt: state.now }];
  return state;
}

test("a private judge request appears in the existing permission UI and can be answered without a public generation job", async () => {
  const state = await fixture();
  await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event: permissionRequestedEvent(0, state.now) });
  const requests = await listMyPendingPermissionsHandler(state.ctx, { userId: "user_1", chatId: "chat-1" as Id<"chats"> });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].generationJobId, undefined);
  assert.equal(requests[0].messageId, "message-1");
  assert.equal(requests[0].canRespond, true);
  const response = await respondToPermissionHandler(state.ctx, { userId: "user_1", requestId: requests[0].requestId, decision: "allow_once" });
  assert.equal(response.status, "responding");
  assert.equal(state.rows.runtimeCommands.at(-1)?.type, "permission_response");
});

test("private judge usage enters canonical history exactly once with the actual runtime and cost attribution", async () => {
  const state = await fixture();
  const base = permissionRequestedEvent(0, state.now);
  const event = { ...base, payload: { ...base.payload, payload: { sessionId: "attempt-1", event: {
    protocolVersion: "nanthai.runtime.v1", eventId: "judge-usage", sequence: 0,
    occurredAt: state.now, runId: "run-1", attemptId: "attempt-1", fence: 7, sessionId: "attempt-1", type: "usage_reported",
    actualModel: { provider: "openai", modelId: "gpt-6-luna", reportedByAdapter: true },
    tokens: { input: 100, output: 20, cachedInput: 80, reasoning: 5, total: 120 },
    cost: { source: "api_equivalent_estimate", amount: 0.0001, currency: "USD", pricingVersion: "test" },
  } } } };
  await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event });
  await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event });
  assert.equal(state.rows.usageRecords.length, 1);
  const record = state.rows.usageRecords[0];
  assert.equal(record.source, "runtime_decision");
  assert.equal(record.runtimeDeviceId, "device-1");
  assert.equal(record.runtimeAdapterId, "codex");
  assert.equal(record.costAttribution, "api_equivalent_estimate");
  assert.equal(record.modelId, "openai/gpt-6-luna");
  assert.equal(record.reasoningTokens, 5);
  assert.equal(record.cachedTokens, 80);
  assert.equal(state.rows.messages[0].content, "");
});

test("an authenticated late helper event after Stop cannot publish output or reopen a request", async () => {
  const state = await fixture();
  state.rows.executionRuns[0].state = "cancelled";
  state.rows.runtimeHelperTasks[0].status = "failed";
  await ingestRuntimeEventHandler(state.ctx, { ...permissionHost, event: permissionRequestedEvent(0, state.now) });
  assert.equal(state.rows.runtimePermissionRequests.length, 0);
  assert.equal(state.rows.runtimeCommands.length, 1);
  assert.equal(state.rows.runtimeHelperTasks[0].content, "");
  assert.equal(state.rows.messages[0].content, "");
});
