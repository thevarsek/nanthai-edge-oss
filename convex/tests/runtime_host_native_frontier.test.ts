import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import {
  advanceConversationFrontier, type RuntimeChatEventContext,
} from "../runtime_host/chat_terminal_ingestion";
import { TerminalAdapterEventSchema } from "../runtime_host/protocol_adapter_events";

function fixture() {
  const binding = {
    _id: "binding_1", chatParticipantId: "participant_1", routeSnapshotHash: "route",
    deviceId: "device_1", status: "active", canonicalFrontierMessageId: "previous",
    lastOwnedNativeTurnId: "native-previous",
  };
  const ctx = createStatefulMockCtx({ runtimeConversationBindings: [binding] }) as unknown as MutationCtx;
  const context = {
    host: { device: { deviceId: "device_1" } },
    attempt: { chatParticipantId: "participant_1", routeSnapshotHash: "route" },
    job: { messageId: "next", runtimeExpectedFrontierMessageId: "previous", status: "streaming" },
  } as unknown as RuntimeChatEventContext;
  const event = TerminalAdapterEventSchema.parse({
    protocolVersion: "nanthai.runtime.v1", eventId: "normalized-event-7", sequence: 7,
    occurredAt: 1, runId: "run_1", attemptId: "attempt_1", fence: 1,
    sessionId: "session_1", type: "terminal", outcome: "completed", summary: "Done",
    errorCode: null, checkpointRef: null, nativeTurnId: "native-turn-42",
  });
  return { ctx, context, binding, event };
}

test("commits the canonical frontier with the real native turn identity", async () => {
  const state = fixture();
  await advanceConversationFrontier(state.ctx, state.context, state.event, 2);
  assert.equal(state.binding.canonicalFrontierMessageId, "next");
  assert.equal(state.binding.lastOwnedNativeTurnId, "native-turn-42");
  assert.notEqual(state.binding.lastOwnedNativeTurnId, state.event.eventId);
});

for (const outcome of ["failed", "cancelled", "interrupted"] as const) {
  test(`${outcome} native work cannot advance the delivered frontier`, async () => {
    const state = fixture();
    await advanceConversationFrontier(state.ctx, state.context, { ...state.event, outcome }, 2);
    assert.equal(state.binding.canonicalFrontierMessageId, "previous");
    assert.equal(state.binding.lastOwnedNativeTurnId, "native-previous");
    assert.equal(state.binding.status, "released");
  });
}

test("older terminal payloads remain readable but do not invent native identity", async () => {
  const state = fixture();
  const { nativeTurnId: _nativeTurnId, ...olderEvent } = state.event;
  await advanceConversationFrontier(state.ctx, state.context, TerminalAdapterEventSchema.parse(olderEvent), 2);
  assert.equal(state.binding.status, "released");
  assert.equal(state.binding.lastOwnedNativeTurnId, "native-previous");
});

test("an out-of-order owned completion discards the ambiguous cache without blocking publication", async () => {
  const state = fixture();
  state.binding.canonicalFrontierMessageId = "other";
  await advanceConversationFrontier(state.ctx, state.context, state.event, 2);
  assert.equal(state.binding.status, "released");
  assert.equal(state.binding.canonicalFrontierMessageId, "other");
  assert.equal(state.binding.lastOwnedNativeTurnId, "native-previous");
});

test("another device still cannot advance a native binding", async () => {
  const state = fixture();
  state.binding.deviceId = "other-device";
  await assert.rejects(advanceConversationFrontier(state.ctx, state.context, state.event, 2), /RUNTIME_CONVERSATION_FRONTIER_CONFLICT/);
  assert.equal(state.binding.status, "active");
});
