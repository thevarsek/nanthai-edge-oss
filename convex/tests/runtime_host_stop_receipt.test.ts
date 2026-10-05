import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { acknowledgeStoppedRuntimeHost } from "../runtime_host/host_stop_receipt";
import { authenticateRuntimeHost, sha256Hex } from "../runtime_host/security";
import { cancelRunState } from "../execution/teardown_run";
import { hasStoppedAttemptOwner } from "../runtime_host/host_session_auth";
import type { Doc } from "../_generated/dataModel";

async function fixture() {
    const args = { deviceId: "device_1", credentialId: "credential_1", credential: "QA secret", presenceSessionId: "session_1", reason: "host_closed" };
    const rows: Record<string, Array<Record<string, unknown>>> = {
        runtimeDeviceCredentials: [{ _id: "credential_row", userId: "user_1", runtimeDeviceId: "device_row", deviceId: args.deviceId, credentialId: args.credentialId, credentialHash: await sha256Hex(args.credential), status: "revoked" }],
        runtimeDevices: [{ _id: "device_row", userId: "user_1", deviceId: args.deviceId, status: "revoked" }],
        runtimeDevicePresences: [{ _id: "presence_1", userId: "user_1", runtimeDeviceId: "device_row", credentialId: args.credentialId, presenceSessionId: args.presenceSessionId, status: "offline" }],
        executionAttempts: [{ _id: "attempt_1", userId: "user_1", runId: "run_1", deviceId: args.deviceId, claimantId: "runtime-host:device_1:session_1", status: "running", fence: 1 }],
        executionRuns: [{ _id: "run_1", userId: "user_1", state: "cancelling", activeAttemptId: "attempt_1", eventCursor: 0 }],
        executionComponentRefs: [{ _id: "component_1", userId: "user_1", runId: "run_1", attemptId: "attempt_1", adapterId: "local-runtime", status: "cancel_requested" }],
    };
    return { args, rows, ctx: createStatefulMockCtx(rows) as unknown as MutationCtx };
}

test("revoked host can only acknowledge its own stopped cancellation; normal authority stays revoked", async () => {
    const { args, rows, ctx } = await fixture();
    await assert.rejects(authenticateRuntimeHost(ctx, args), /invalid or revoked/);
    assert.equal(await acknowledgeStoppedRuntimeHost(ctx, args), true);
    assert.equal(rows.executionComponentRefs[0].status, "cancelled");
    assert.equal(rows.executionRuns[0].state, "cancelled");
    assert.equal(rows.executionAttempts[0].status, "cancelled");
    await acknowledgeStoppedRuntimeHost(ctx, args);
    await assert.rejects(authenticateRuntimeHost(ctx, args), /invalid or revoked/);
});

test("authenticated shutdown before user Stop is retained and later cancellation settles", async () => {
    const { args, rows, ctx } = await fixture();
    Object.assign(rows.executionRuns[0], { state: "running", domainType: "chat", domainId: "chat_1" });
    rows.executionComponentRefs[0].status = "active";
    await acknowledgeStoppedRuntimeHost(ctx, args);
    assert.equal(rows.executionRuns[0].state, "running");
    assert.equal(typeof rows.runtimeDevicePresences[0].executionStoppedAt, "number");
    const result = await cancelRunState(ctx, rows.executionRuns[0] as unknown as Doc<"executionRuns">,
        "user_1", "User stopped after host shutdown", Date.now());
    assert.deepEqual(result.components, []);
    assert.equal(rows.executionComponentRefs[0].status, "cancelled");
    assert.equal(rows.executionRuns[0].state, "cancelled");
});

test("offline presence alone and another user's stop receipt do not prove owned execution stopped", async () => {
    const { rows, ctx } = await fixture();
    const attempt = rows.executionAttempts[0] as unknown as Doc<"executionAttempts">;
    assert.equal(await hasStoppedAttemptOwner(ctx, attempt), false);
    rows.runtimeDevicePresences[0].executionStoppedAt = Date.now();
    rows.runtimeDevicePresences[0].userId = "other";
    assert.equal(await hasStoppedAttemptOwner(ctx, attempt), false);
    rows.runtimeDevicePresences[0].userId = "user_1";
    attempt.claimantId = "runtime-host:device_1:replacement";
    assert.equal(await hasStoppedAttemptOwner(ctx, attempt), false);
});

for (const changed of ["credential", "presence", "claimant", "state", "activeAttempt"] as const) {
    test(`stop receipt cannot settle a mismatched ${changed}`, async () => {
        const { args, rows, ctx } = await fixture();
        if (changed === "credential") args.credential = "wrong";
        if (changed === "presence") args.presenceSessionId = "other";
        if (changed === "claimant") rows.executionAttempts[0].claimantId = "runtime-host:device_1:other";
        if (changed === "state") rows.executionRuns[0].state = "running";
        if (changed === "activeAttempt") rows.executionRuns[0].activeAttemptId = "other";
        if (changed === "credential" || changed === "presence") await assert.rejects(acknowledgeStoppedRuntimeHost(ctx, args), /not authenticated|does not own/);
        else await acknowledgeStoppedRuntimeHost(ctx, args);
        assert.equal(rows.executionComponentRefs[0].status, "cancel_requested");
    });
}

test("stopped host wakes a waiting helper as failed without changing ordinary replay authority", async (t) => {
    const { mock } = await import("node:test");
    const { durableWorkflow } = await import("../execution/components");
    t.after(() => mock.restoreAll());
    const { args, rows, ctx } = await fixture();
    const signals: unknown[] = [];
    mock.method(durableWorkflow, "sendEvent", async (_ctx: unknown, value: unknown) => { signals.push(value); });
    Object.assign(rows.executionRuns[0], { state: "running", domainType: "local_helper" });
    rows.runtimeHelperTasks = [{ _id: "helper_1", runId: "run_1", status: "waiting", completionEventId: "event_1", commandRecordId: "command_1" }];
    rows.runtimeCommands = [{ _id: "command_1", attemptId: "attempt_1", commandId: "helper_command" }];
    await acknowledgeStoppedRuntimeHost(ctx, args);
    assert.equal(rows.runtimeHelperTasks[0].status, "failed");
    assert.equal(signals.length, 1);
    assert.equal(rows.executionRuns[0].state, "running"); // Workflow owns terminal settlement.
    assert.equal(rows.executionComponentRefs[0].status, "cancel_requested");
});

test("queued helper Stop follows the source turn owner and cannot cancel a replacement host", async (t) => {
    const { mock } = await import("node:test");
    const { durableWorkflow } = await import("../execution/components");
    t.after(() => mock.restoreAll());
    mock.method(durableWorkflow, "sendEvent", async () => undefined);
    const { args, rows, ctx } = await fixture();
    Object.assign(rows.executionRuns[0], { state: "queued", domainType: "local_helper" });
    Object.assign(rows.executionAttempts[0], { status: "queued", claimantId: undefined });
    rows.executionAttempts.push({ _id: "source_attempt", claimantId: "runtime-host:device_1:session_1" });
    rows.generationJobs = [{ _id: "source_job", executionAttemptId: "source_attempt" }];
    rows.runtimeHelperTasks = [{ _id: "helper_1", runId: "run_1", sourceJobId: "source_job", status: "waiting", completionEventId: "event_1" }];
    rows.runtimeDevices[0].currentPresenceId = "replacement_presence";
    await acknowledgeStoppedRuntimeHost(ctx, args);
    assert.equal(rows.runtimeHelperTasks[0].status, "waiting");
    rows.runtimeDevices[0].currentPresenceId = undefined;
    await acknowledgeStoppedRuntimeHost(ctx, args);
    assert.equal(rows.runtimeHelperTasks[0].status, "failed");
});

test("a queued decision helper without a public job wakes on its current host's stop receipt", async (t) => {
    const { mock } = await import("node:test");
    const { durableWorkflow } = await import("../execution/components");
    t.after(() => mock.restoreAll());
    const signals: unknown[] = [];
    mock.method(durableWorkflow, "sendEvent", async (_ctx: unknown, value: unknown) => { signals.push(value); });
    const { args, rows, ctx } = await fixture();
    Object.assign(rows.executionRuns[0], { state: "queued", domainType: "local_helper" });
    Object.assign(rows.executionAttempts[0], { status: "queued", claimantId: undefined });
    rows.runtimeHelperTasks = [{ _id: "helper_1", runId: "run_1", purpose: "decision", status: "waiting", completionEventId: "event_1" }];
    rows.runtimeDevices[0].currentPresenceId = "replacement_presence";
    await acknowledgeStoppedRuntimeHost(ctx, args);
    assert.equal(signals.length, 0);
    assert.equal(rows.runtimeHelperTasks[0].status, "waiting");
    rows.runtimeDevices[0].currentPresenceId = "presence_1";
    await acknowledgeStoppedRuntimeHost(ctx, args);
    assert.equal(signals.length, 1);
    assert.equal(rows.runtimeHelperTasks[0].status, "failed");
});
