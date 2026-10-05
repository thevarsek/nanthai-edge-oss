import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { closeRunWriterForCancellation } from "../execution/cancel_fence";
import { heartbeatAttempt } from "../runtime_host/host_execution";
import { sha256Hex } from "../runtime_host/security";

type Rows = Record<string, Array<Record<string, unknown>>>;
type HeartbeatMutation = {
  _handler: (ctx: MutationCtx, args: {
    deviceId: string;
    credentialId: string;
    credential: string;
    presenceSessionId: string;
    attemptId: Id<"executionAttempts">;
    fence: number;
  }) => Promise<number>;
};

async function fixture(runState: "running" | "cancelling" = "running") {
  const now = Date.now();
  const claimantId = "runtime-host:device-1:presence-1";
  const rows: Rows = {
    chats: [{ _id: "chat-1", userId: "user-1" }],
    accountDeletionTombstones: [],
    executionRuns: [{
      _id: "run-1", userId: "user-1", chatId: "chat-1",
      activeAttemptId: "attempt-1", state: runState, updatedAt: now,
    }],
    executionAttempts: [{
      _id: "attempt-1", runId: "run-1", userId: "user-1", status: "running",
      fence: 7, claimantId, deviceId: "device-1", updatedAt: now,
    }, {
      _id: "attempt-other", runId: "run-other", userId: "user-1", status: "running",
      fence: 2, claimantId, deviceId: "device-1", updatedAt: now,
    }],
    runtimeNativeAgentGroups: [{
      _id: "group-1", runId: "run-1", attemptId: "attempt-1", fence: 7,
      status: "active", updatedAt: now,
    }, {
      _id: "group-other", runId: "run-other", attemptId: "attempt-other", fence: 2,
      status: "active", updatedAt: now,
    }],
    runtimeNativeAgents: [{
      _id: "agent-1", groupId: "group-1", status: "running", updatedAt: now,
    }, {
      _id: "agent-other", groupId: "group-other", status: "running", updatedAt: now,
    }],
    runtimeDevices: [{
      _id: "device-row-1", userId: "user-1", deviceId: "device-1", status: "active",
    }],
    runtimeDeviceCredentials: [{
      _id: "credential-row-1", userId: "user-1", runtimeDeviceId: "device-row-1",
      deviceId: "device-1", credentialId: "credential-1",
      credentialHash: await sha256Hex("secret-1"), status: "active", issuedAt: now,
    }],
    runtimeDevicePresences: [{
      _id: "presence-row-1", userId: "user-1", runtimeDeviceId: "device-row-1",
      deviceId: "device-1", presenceSessionId: "presence-1",
      credentialId: "credential-1", status: "online", expiresAt: now + 60_000,
    }],
  };
  return { rows, now, ctx: createStatefulMockCtx(rows) as unknown as MutationCtx };
}

test("closing the parent writer immediately cancels only its native-agent descendants", async () => {
  const state = await fixture();
  await closeRunWriterForCancellation(
    state.ctx, "run-1" as Id<"executionRuns">, "user-1", "Stopped", state.now + 10,
  );

  assert.equal(state.rows.executionRuns[0].state, "cancelling");
  assert.equal(state.rows.runtimeNativeAgentGroups[0].status, "cancelled");
  assert.equal(state.rows.runtimeNativeAgents[0].status, "interrupted");
  assert.equal(state.rows.runtimeNativeAgentGroups[1].status, "active");
  assert.equal(state.rows.runtimeNativeAgents[1].status, "running");
});

test("the current fenced Runtime Host attempt may heartbeat while cancelling only", async () => {
  const state = await fixture("cancelling");
  const handler = (heartbeatAttempt as unknown as HeartbeatMutation)._handler;
  const args = {
    deviceId: "device-1", credentialId: "credential-1", credential: "secret-1",
    presenceSessionId: "presence-1", attemptId: "attempt-1" as Id<"executionAttempts">,
    fence: 7,
  };

  const leaseExpiresAt = await handler(state.ctx, args);
  assert.ok(leaseExpiresAt > state.now);
  await assert.rejects(() => handler(state.ctx, { ...args, fence: 8 }), /STALE_EXECUTION_FENCE/);
  Object.assign(state.rows.executionRuns[0], { state: "cancelled", terminalOutcome: "cancelled" });
  Object.assign(state.rows.executionAttempts[0], { status: "cancelled" });
  await assert.rejects(() => handler(state.ctx, args), /TERMINAL_EXECUTION_RUN/);
});
