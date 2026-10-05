import assert from "node:assert/strict";
import test from "node:test";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { createPermissionFixture } from "./runtime_host_permission_fixture";
import { reconcileOwnedWorkflowHandler } from "../execution/workflow_lifecycle";
import { advanceRunTreeTeardown } from "../execution/teardown_graph";
import { assertCurrentExecution } from "../execution/attempts";
import { getActiveJobsHandler } from "../chat/queries_handlers_public";
import { waitForRuntimeDeviceHandler, wakeRuntimeDeviceWaits } from "../runtime_host/device_wait";

for (const wait of ["offline", "permission", "input"] as const) {
  test(`exchange timeout finalizes the ${wait} reply while child teardown keeps its fence`, async (t) => {
    const startedAt = 1_000_000;
    let now = startedAt;
    t.mock.method(Date, "now", () => now);
    const { ctx, rows } = await createPermissionFixture(startedAt);
    t.mock.method(ctx.auth, "getUserIdentity", async () => ({ subject: "user_1" }));
    Object.assign(ctx.db, { system: {} });
    Object.assign(rows.executionRuns[0], {
      parentRunId: "parent", state: wait === "permission" ? "waiting_for_permission"
        : wait === "input" ? "waiting_for_input" : "queued",
    });
    rows.executionRuns.push({
      _id: "parent", userId: "user_1", chatId: "chat-1", state: "running",
      activeAttemptId: "parent-attempt", domainType: "collaboration_exchange",
      domainId: "exchange", nextEventSequence: 0,
    });
    rows.executionAttempts.push({
      _id: "parent-attempt", runId: "parent", userId: "user_1", status: "running",
      fence: 1, leaseExpiresAt: startedAt + 24 * 60 * 60_000,
    });
    rows.collaborationExchanges = [{
      _id: "exchange", status: "waiting", activeParticipantIds: ["participant-1"],
      bounds: { deadlineAt: startedAt + 15 * 60_000 },
    }];
    rows.executionComponentRefs.push(
      { _id: "parent-component", runId: "parent", attemptId: "parent-attempt",
        adapterId: "convex-workflow", operationId: "parent-workflow", status: "active" },
      { _id: "child-component", runId: "run-1", attemptId: "attempt-1",
        adapterId: "convex-workflow", operationId: "child-workflow", status: "active" },
    );
    rows.messages.push({ _id: "completed-message", status: "completed", content: "Completed peer" });
    rows.generationJobs.push({ _id: "completed-job", messageId: "completed-message", status: "completed" });
    rows.executionRuns.push({ _id: "completed-peer", parentRunId: "parent",
      generationJobId: "completed-job", state: "completed" });
    rows.runtimeDevicePresences[0].status = "offline";
    if (wait === "offline") {
      Object.assign(rows.generationJobs[0], { status: "queued", runtimeCommandRecordId: undefined });
      assert.equal(await waitForRuntimeDeviceHandler(ctx, { jobId: "job-1" as never, eventId: "device-ready" }), true);
    } else {
      rows.streamingMessages[0].content = "Partial reply";
      if (wait === "permission") rows.runtimePermissionRequests.push({
        _id: "request", runId: "run-1", attemptId: "attempt-1", status: "pending",
      });
    }
    now = startedAt + 15 * 60_000;
    await reconcileOwnedWorkflowHandler(ctx, {
      workflowId: "parent-workflow",
      result: { kind: "failed", error: "COLLABORATION_BARRIER_TIMEOUT" }, context: {},
    });
    assert.equal(rows.collaborationExchanges[0].status, "failed");
    assert.equal(rows.collaborationExchanges[0].error, "Collaboration timed out.");
    assert.equal(rows.collaborationExchanges[0].terminalReason, "deadline_expired");
    assert.deepEqual(rows.collaborationExchanges[0].activeParticipantIds, []);
    assert.equal(rows.executionRuns[0].state, "cancelling");
    assert.equal(rows.generationJobs[0].status, "failed");
    assert.equal(rows.generationJobs[0].error, "Collaboration timed out.");
    assert.equal(rows.generationJobs[0].terminalErrorCode, "stream_timeout");
    assert.equal(rows.messages[0].status, "failed");
    assert.equal(rows.messages[0].terminalErrorCode, "stream_timeout");
    assert.equal(rows.messages[0].content, wait === "offline" ? "" : "Partial reply");
    assert.equal(rows.streamingMessages.length, 0);
    assert.deepEqual(await getActiveJobsHandler(ctx as unknown as QueryCtx, { chatId: "chat-1" as never }), []);
    await assert.rejects(assertCurrentExecution(ctx, { attemptId: "attempt-1" as never, fence: 7 }), /CANCELL/);
    // The physical component reports cancellation; the real tree reconciler settles it.
    rows.executionComponentRefs[1].status = "cancelled";
    for (let i = 0; i < 6; i += 1) await advanceRunTreeTeardown(ctx,
      rows.executionRuns[0] as unknown as Doc<"executionRuns">, "user_1", "Collaboration coordinator failed");
    assert.equal(rows.executionRuns[0].state, "cancelled");
    assert.equal(rows.generationJobs[0].status, "failed");
    if (wait === "permission") assert.equal(rows.runtimePermissionRequests[0].status, "closed");
    assert.equal(rows.messages[1].content, "Completed peer");
    assert.equal(rows.generationJobs[1].status, "completed");
    let wakeSignals = 0;
    assert.equal(await wakeRuntimeDeviceWaits(ctx, rows.runtimeDevices[0] as unknown as Doc<"runtimeDevices">,
      [{ adapterId: "codex", authState: "ready" }], now, async () => { wakeSignals += 1; }), 0);
    assert.equal(wakeSignals, 0);
  });
}
