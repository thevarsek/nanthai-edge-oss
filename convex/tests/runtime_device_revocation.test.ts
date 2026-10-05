import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { revokeDeviceHandler } from "../runtime_host/pairing";

test("removing a Mac fences all its runs without combining paginated teardowns", async () => {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    runtimeDevices: [{ _id: "mac", userId: "owner", deviceId: "device", status: "active" }],
    runtimeDeviceCredentials: [{ _id: "credential", runtimeDeviceId: "mac", status: "active" }],
    runtimeDevicePresences: [{ _id: "presence", runtimeDeviceId: "mac", status: "online" }],
    executionRuns: [
      { _id: "run-1", activeAttemptId: "attempt-1", state: "running", userId: "owner" },
      { _id: "run-2", activeAttemptId: "attempt-2", state: "queued", userId: "owner" },
      { _id: "other-run", activeAttemptId: "other-attempt", state: "running", userId: "owner" },
    ],
    executionAttempts: [
      { _id: "attempt-1", runId: "run-1", deviceId: "device", status: "running", fence: 1 },
      { _id: "attempt-2", runId: "run-2", deviceId: "device", status: "queued", fence: 2 },
      { _id: "other-attempt", runId: "other-run", deviceId: "other-device", status: "running", fence: 1 },
    ],
    runtimeNativeAgentGroups: [],
    runtimeNativeAgents: [],
  };
  const state = createStatefulMockCtx(rows);
  const ctx = state as unknown as MutationCtx;
  const query = ctx.db.query.bind(ctx.db);
  ctx.db.query = ((table) => {
    const result = query(table);
    result.paginate = async () => { throw new Error("Teardown pages belong to separate owned actions"); };
    return result;
  }) as typeof ctx.db.query;

  assert.equal(await revokeDeviceHandler(ctx, {
    userId: "owner", runtimeDeviceId: "mac" as Id<"runtimeDevices">, reason: "Removed", now: 100,
  }), true);
  assert.equal(rows.runtimeDevices[0].status, "revoked");
  assert.equal(rows.runtimeDeviceCredentials[0].status, "revoked");
  assert.equal(rows.runtimeDevicePresences[0].status, "offline");
  assert.deepEqual(rows.executionRuns.map((run) => run.state), ["cancelling", "cancelling", "running"]);
  assert.equal(state.scheduled.length, 2);
  assert.equal(await revokeDeviceHandler(ctx, {
    userId: "owner", runtimeDeviceId: "mac" as Id<"runtimeDevices">, reason: "Removed again", now: 101,
  }), false);
  assert.equal(state.scheduled.length, 2);
});
