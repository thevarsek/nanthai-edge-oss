import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { WorkflowCtx } from "@convex-dev/workflow";
import type { Id } from "../_generated/dataModel";
import { decisionFixture, handler } from "./local_decision_helper_fixture";
import { start, bindWorkflow } from "../runtime_host/decision_helpers";
import { commit } from "../runtime_host/helper_dispatch";
import { get, expire, setEvent, finish } from "../runtime_host/helper_tasks";
import { runHelperWorkflowHandler } from "../runtime_host/helper_workflow";
import { runLocalDecisionHelper } from "../runtime_host/decision_workflow";
import { requestRunTeardown } from "../execution/teardown";
import { durableWorkflow } from "../execution/components";
import type { RuntimeCompletionEventValue } from "../runtime_host/runtime_workflow_events";
import { persistDecision } from "../collaboration/lifecycle_mutations";
import { dispatchDecision } from "../collaboration/dispatch_mutation";
import { reconcileOwnedWorkflowHandler } from "../execution/workflow_lifecycle";

const args = {
  parentAttemptId: "attempt-1" as Id<"executionAttempts">, parentFence: 7,
  chatId: "chat-1" as Id<"chats">, sourceMessageId: "message-1" as Id<"messages">,
  requestKey: "speakers:exchange:2", participantIds: ["participant-1" as Id<"chatParticipants">],
  messages: [{ role: "user", content: "Choose the second-wave speaker" }],
};
const startHandler = handler<typeof args, Id<"runtimeHelperTasks"> | null>(start);
const commitHandler = handler<{
  taskId: Id<"runtimeHelperTasks">; commandId: string; storageId: Id<"_storage">;
  packetHash: string; byteLength: number;
}, null>(commit);
const execution = { runId: "run-1" as never, attemptId: "attempt-1" as never,
  fence: 7, claimantId: "runtime-host:device-1:presence-1" };

async function exchangeFixture(now: number) {
  const state = await decisionFixture();
  Object.assign(state.rows.executionRuns[0], { domainType: "collaboration_exchange", domainId: "exchange" });
  state.rows.executionAttempts[0].leaseExpiresAt = now + 24 * 60 * 60_000;
  state.rows.collaborationExchanges = [{
    _id: "exchange", status: "scheduling", currentWave: 2, frontierMessageIds: ["message-1"],
    executionRunId: execution.runId, executionAttemptId: execution.attemptId,
    executionFence: execution.fence, executionClaimantId: execution.claimantId,
    bounds: { deadlineAt: now + 15 * 60_000 }, activeParticipantIds: [],
  }];
  return state;
}

for (const elapsed of [0, 14]) test(`scheduler at minute ${elapsed} inherits the fifteen-minute exchange deadline`, async (t) => {
  const startedAt = 1_000_000;
  let now = startedAt;
  t.mock.method(Date, "now", () => now);
  const state = await exchangeFixture(startedAt);
  now += elapsed * 60_000;
  state.rows.runtimeDevicePresences[0].expiresAt = now + 120_000;
  const taskId = await startHandler(state.ctx, args);
  assert.ok(taskId);
  const scheduledAt: number[] = [];
  t.mock.method(state.ctx.scheduler, "runAt", async (at: number) => { scheduledAt.push(at); return "timer" as never; });
  await commitHandler(state.ctx, { taskId, commandId: `helper-${taskId}-1`,
    storageId: "packet" as never, packetHash: "a".repeat(64), byteLength: 50 });
  assert.deepEqual(scheduledAt, [startedAt + 15 * 60_000, startedAt + 15 * 60_000]);
  assert.equal(state.rows.runtimeTurnPackets[0].expiresAt, startedAt + 15 * 60_000);
  assert.equal(state.rows.runtimeCommands.at(-1)?.expiresAt, startedAt + 15 * 60_000);
});

test("standalone decision helpers retain the existing ten-minute transport budget", async (t) => {
  t.mock.method(Date, "now", () => 1_000_000);
  const state = await decisionFixture();
  const taskId = await startHandler(state.ctx, args);
  assert.ok(taskId);
  await commitHandler(state.ctx, { taskId, commandId: `helper-${taskId}-1`,
    storageId: "packet" as never, packetHash: "a".repeat(64), byteLength: 50 });
  assert.equal(state.rows.runtimeTurnPackets[0].expiresAt, 1_000_000 + 10 * 60_000);
});

test("second-wave scheduler expiry wakes the real helper join and prevents overdue participant work", async (t) => {
  const startedAt = 1_000_000;
  let now = startedAt;
  t.mock.method(Date, "now", () => now);
  const state = await exchangeFixture(startedAt);
  now += 14 * 60_000;
  state.rows.runtimeDevicePresences[0].expiresAt = now + 120_000;
  state.rows.executionComponentRefs.push({
    _id: "parent-component", runId: "run-1", attemptId: "attempt-1",
    adapterId: "convex-workflow", operationId: "parent-workflow", status: "active",
  });
  let completion: RuntimeCompletionEventValue | undefined;
  t.mock.method(durableWorkflow, "sendEvent", async (_ctx: unknown, signal: { value: unknown }) => {
    completion = signal.value as RuntimeCompletionEventValue;
  });
  t.mock.method(state.ctx, "runMutation", async (ref: unknown, payload: unknown) => {
    assert.equal(getFunctionName(ref as never), "execution/teardown:requestRunTeardown");
    return handler<{ runId: Id<"executionRuns">; requestedBy: string; reason: string }, unknown>(requestRunTeardown)(state.ctx, payload as never);
  });
  let taskId: Id<"runtimeHelperTasks">;
  const step = {
    workflowId: "helper-workflow",
    runMutation: async (ref: unknown, payload: unknown) => {
      const name = getFunctionName(ref as never);
      if (name.endsWith("decision_helpers:start")) {
        const startedTaskId = await startHandler(state.ctx, payload as typeof args);
        assert.ok(startedTaskId);
        taskId = startedTaskId;
        return taskId;
      }
      if (name.endsWith(":createGenerationResume")) return "completion-event";
      if (name.endsWith("helper_tasks:setEvent")) return handler<{ taskId: Id<"runtimeHelperTasks">; eventId: string }, null>(setEvent)(state.ctx, payload as never);
      if (name.endsWith("helper_tasks:finish")) return handler<{ taskId: Id<"runtimeHelperTasks">; failed: boolean }, null>(finish)(state.ctx, payload as never);
      throw new Error(`Unexpected mutation ${name}`);
    },
    runAction: async (ref: unknown) => {
      assert.equal(getFunctionName(ref as never), "runtime_host/helper_dispatch:dispatch");
      return commitHandler(state.ctx, { taskId, commandId: `helper-${taskId}-1`,
        storageId: "packet" as never, packetHash: "a".repeat(64), byteLength: 50 });
    },
    runWorkflow: async () => {
      await handler<{ taskId: Id<"runtimeHelperTasks">; workflowId: string }, null>(bindWorkflow)(state.ctx, { taskId, workflowId: "helper-workflow" });
      return runHelperWorkflowHandler(step, { taskId });
    },
    awaitEvent: async () => {
      now = startedAt + 15 * 60_000;
      await handler<{ taskId: Id<"runtimeHelperTasks"> }, null>(expire)(state.ctx, { taskId });
      assert.equal(completion?.status, "failed");
      return completion;
    },
    runQuery: async (ref: unknown, payload: unknown) => {
      assert.equal(getFunctionName(ref as never), "runtime_host/helper_tasks:get");
      return handler<{ taskId: Id<"runtimeHelperTasks"> }, unknown>(get)(state.ctx, payload as never);
    },
  } as unknown as WorkflowCtx;
  assert.equal(await runLocalDecisionHelper(step, args), null);
  assert.equal(now, startedAt + 15 * 60_000);
  const jobCount = state.rows.generationJobs.length;
  await assert.rejects(handler<unknown, unknown>(persistDecision)(state.ctx, {
    exchangeId: "exchange", wave: 2, frontierMessageIds: ["message-1"],
    selections: [], excludedParticipantIds: [], diagnosticCategory: "silent",
    schedulerVersion: "test", execution,
  }), /COLLABORATION_BARRIER_TIMEOUT/);
  state.rows.collaborationDecisions = [{ _id: "decision", exchangeId: "exchange", status: "selected", wave: 2 }];
  await assert.rejects(handler<unknown, unknown>(dispatchDecision)(state.ctx, {
    exchangeId: "exchange", decisionId: "decision", execution,
  }), /COLLABORATION_BARRIER_TIMEOUT/);
  await reconcileOwnedWorkflowHandler(state.ctx, { workflowId: "parent-workflow",
    result: { kind: "failed", error: "COLLABORATION_BARRIER_TIMEOUT" }, context: {} });
  assert.equal(state.rows.collaborationExchanges[0].status, "failed");
  assert.equal(state.rows.generationJobs.length, jobCount);
  assert.equal(state.rows.runtimeCommands.filter(command => command.type === "start").length, 2);
  await assert.rejects(startHandler(state.ctx, { ...args, requestKey: "late-scheduler" }), /TERMINAL|FENCE/);
});

test("an already elapsed exchange cannot create or commit a new scheduler helper", async (t) => {
  const startedAt = 1_000_000;
  let now = startedAt;
  t.mock.method(Date, "now", () => now);
  const state = await exchangeFixture(startedAt);
  const taskId = await startHandler(state.ctx, args);
  assert.ok(taskId);
  now += 15 * 60_000;
  await assert.rejects(startHandler(state.ctx, { ...args, requestKey: "late" }), /COLLABORATION_BARRIER_TIMEOUT/);
  await assert.rejects(commitHandler(state.ctx, { taskId, commandId: `helper-${taskId}-1`,
    storageId: "packet" as never, packetHash: "a".repeat(64), byteLength: 50 }), /COLLABORATION_BARRIER_TIMEOUT/);
  assert.equal(state.rows.runtimeTurnPackets?.length ?? 0, 0);
});
