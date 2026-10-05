import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import { createPermissionFixture } from "./runtime_host_permission_fixture";
import { waitForRuntimeDeviceHandler, wakeRuntimeDeviceWaits } from "../runtime_host/device_wait";

async function waitingFixture() {
  const fixture = await createPermissionFixture(1000);
  Object.assign(fixture.rows.executionAttempts[0], { status: "queued", claimantId: undefined, leaseExpiresAt: undefined });
  fixture.rows.executionRuns[0].state = "queued";
  fixture.rows.generationJobs[0].status = "queued";
  fixture.rows.runtimeDevicePresences[0].status = "offline";
  return fixture;
}
const jobId = "job-1" as Id<"generationJobs">;

test("manual turn waits without claiming a lease or preparing an expiring packet", async () => {
  const { ctx, rows } = await waitingFixture();
  assert.equal(await waitForRuntimeDeviceHandler(ctx, { jobId, eventId: "ready-1", now: 1000 }), true);
  assert.equal(rows.executionRuns[0].state, "waiting");
  assert.equal(rows.executionAttempts[0].status, "queued");
  assert.equal(rows.executionAttempts[0].claimantId, undefined);
  assert.equal(rows.generationJobs[0].runtimeDeviceReadyEventId, "ready-1");
  assert.equal(rows.runEvents[0].phase, "waiting_for_device");
});

test("only the selected authenticated adapter wakes the owned turn, once", async () => {
  const { ctx, rows } = await waitingFixture();
  await waitForRuntimeDeviceHandler(ctx, { jobId, eventId: "ready-1", now: 1000 });
  const device = rows.runtimeDevices[0] as unknown as Doc<"runtimeDevices">;
  const signals: string[] = [];
  const signal = async (_ctx: typeof ctx, id: string) => { signals.push(id); };
  assert.equal(await wakeRuntimeDeviceWaits(ctx, device, [{ adapterId: "pi", authState: "ready" }], 2000, signal), 0);
  assert.equal(await wakeRuntimeDeviceWaits(ctx, device, [{ adapterId: "codex", authState: "signed_out" }], 2000, signal), 0);
  assert.equal(await wakeRuntimeDeviceWaits(ctx, device, [{ adapterId: "codex", authState: "ready" }], 2000, signal), 1);
  assert.equal(await wakeRuntimeDeviceWaits(ctx, device, [{ adapterId: "codex", authState: "ready" }], 3000, signal), 0);
  assert.deepEqual(signals, ["ready-1"]);
  assert.equal(rows.executionRuns[0].state, "queued");
});

test("cancelled or superseded waiting turns are never woken", async () => {
  for (const cancelled of [true, false]) {
    const { ctx, rows } = await waitingFixture();
    await waitForRuntimeDeviceHandler(ctx, { jobId, eventId: "ready-1", now: 1000 });
    if (cancelled) rows.executionRuns[0].state = "cancelled";
    else rows.executionRuns[0].activeAttemptId = "another-attempt";
    const device = rows.runtimeDevices[0] as unknown as Doc<"runtimeDevices">;
    assert.equal(await wakeRuntimeDeviceWaits(ctx, device, [{ adapterId: "codex", authState: "ready" }], 2000,
      async () => { throw new Error("Unexpected signal"); }), 0);
    assert.equal(rows.generationJobs[0].runtimeDeviceReadyEventId, undefined);
  }
});

test("online race skips waiting; missed schedules retain no-catch-up semantics", async () => {
  const { ctx, rows } = await waitingFixture();
  rows.runtimeDevicePresences[0].status = "online";
  assert.equal(await waitForRuntimeDeviceHandler(ctx, { jobId, eventId: "ready-1", now: 1000 }), false);
  rows.runtimeDevicePresences[0].status = "offline";
  rows.generationJobs[0].sourceJobId = "schedule-1";
  await assert.rejects(waitForRuntimeDeviceHandler(ctx, { jobId, eventId: "ready-1", now: 1000 }), /SCHEDULED_RUNTIME_UNAVAILABLE/);
  assert.equal(rows.generationJobs[0].runtimeWaitingDeviceId, undefined);
});

test("composed local Workflow awaits ready before dispatching its one native turn", async () => {
  const { runGenerationParticipantWorkflowHandler } = await import("../chat/generation_workflow");
  const { getFunctionName } = await import("convex/server");
  const order: string[] = [];
  const step = {
    workflowId: "workflow-wait",
    runQuery: async () => ({ placement: "local" }),
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(ref as never);
      if (name.endsWith(":waitForDevice")) { order.push("wait"); return true; }
      return args.name;
    },
    awaitEvent: async ({ id }: { id: string }) => { order.push(id.startsWith("runtime-device:") ? "ready" : "terminal"); },
    runAction: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name.endsWith(":dispatchLocalGeneration")) { order.push("dispatch"); return "enqueued"; }
      order.push("finalize"); return null;
    },
  } as unknown as import("@convex-dev/workflow").WorkflowCtx;
  await runGenerationParticipantWorkflowHandler(step, {
    chatId: "chat-1" as never, userMessageId: "user-1" as never,
    assistantMessageIds: ["message-1" as never], generationJobIds: [jobId],
    participant: { modelId: "model", messageId: "message-1" as never, jobId },
    userId: "user", expandMultiModelGroups: false, webSearchEnabled: false,
    effectiveIntegrations: [], isPro: true, allowSubagents: true,
  });
  assert.deepEqual(order, ["wait", "ready", "dispatch", "terminal", "finalize"]);
});
