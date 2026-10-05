import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { WorkflowCtx } from "@convex-dev/workflow";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { getDecisionBarrier } from "../collaboration/barrier";
import { COLLABORATION_MAX_DURATION_MS } from "../collaboration/constants";
import { runCollaborationWorkflowHandler } from "../collaboration/workflow";
import { heartbeatExecution } from "../execution/control_plane";
import { DOMAIN_EXECUTION_LEASE_MS } from "../execution/domain_lifecycle";
import { settleDecisionHandler } from "../collaboration/settle_mutation";

type BarrierArgs = { exchangeId: string; decisionId: string };
type Barrier = { terminal: boolean; stale: boolean; remainingMs: number };
const barrierHandler = (getDecisionBarrier as unknown as {
  _handler: (ctx: QueryCtx, args: BarrierArgs) => Promise<Barrier>;
})._handler;

function exchangeWorkflow(completionTimes: number[], context: test.TestContext) {
  let elapsed = 0;
  let wave = 0;
  let settledWaves = 0;
  const startedAt = 1_000_000;
  context.mock.method(Date, "now", () => startedAt + elapsed);
  const job = { _id: "job", status: "streaming" };
  const execution = {
    runId: "run" as never, attemptId: "attempt" as never,
    fence: 1, claimantId: "workflow",
  };
  const decision = {
    _id: "decision", exchangeId: "exchange", status: "dispatched",
    generationJobIds: ["job"], assistantMessageIds: ["assistant"],
  };
  const ctx = createStatefulMockCtx({
    collaborationExchanges: [{
      _id: "exchange", bounds: { deadlineAt: startedAt + 15 * 60_000 },
      executionRunId: "run", executionAttemptId: "attempt",
      executionFence: 1, executionClaimantId: "workflow",
      participantSnapshot: [], failedParticipantIds: [],
      pendingHumanMessageIds: [], frontierMessageIds: ["user"],
      publishedMessageCount: 0,
    }],
    collaborationDecisions: [decision],
    executionRuns: [{
      _id: "run", state: "running", activeAttemptId: "attempt", userId: "owner",
    }],
    executionAttempts: [{
      _id: "attempt", runId: "run", fence: 1, status: "running",
      claimantId: "workflow", leaseExpiresAt: startedAt + DOMAIN_EXECUTION_LEASE_MS,
    }],
    messages: [{ _id: "assistant", status: "completed" }],
    accountDeletionTombstones: [],
    generationJobs: [job],
  }) as unknown as QueryCtx;
  const step = {
    runMutation: async (ref: unknown, args: unknown) => {
      const name = getFunctionName(ref as never);
      if (name.endsWith(":heartbeat")) {
        return heartbeatExecution(ctx as unknown as MutationCtx,
          args as Parameters<typeof heartbeatExecution>[1]);
      }
      if (name.endsWith(":prepareWave")) {
        wave += 1;
        return { kind: "ready", wave, frontierMessageIds: ["user"] };
      }
      if (name.endsWith(":persistDecision")) return { decisionId: "decision", silent: false };
      if (name.endsWith(":dispatchDecision")) {
        job.status = "streaming";
        decision.status = "dispatched";
        return null;
      }
      if (name.endsWith(":settleDecision")) {
        await settleDecisionHandler(ctx as unknown as MutationCtx, {
          exchangeId: "exchange" as never, decisionId: "decision" as never, execution,
        });
        settledWaves += 1;
        return { terminal: settledWaves === completionTimes.length };
      }
      throw new Error(`Unexpected mutation: ${name}`);
    },
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name.endsWith(":hasCloudConnection")) return true;
      if (name.endsWith(":getDecisionBarrier")) {
        if (elapsed >= completionTimes[wave - 1]) job.status = "completed";
        return barrierHandler(ctx, { exchangeId: "exchange", decisionId: "decision" });
      }
      throw new Error(`Unexpected query: ${name}`);
    },
    runAction: async () => ({}),
    sleep: async (milliseconds: number) => { elapsed += milliseconds; },
  } as unknown as WorkflowCtx;
  return {
    run: () => runCollaborationWorkflowHandler(step, {
      exchangeId: "exchange" as never,
      execution,
    }),
    elapsed: () => elapsed,
    settledWaves: () => settledWaves,
  };
}

test("native human wait can finish after ten minutes within the fifteen-minute exchange", async (context) => {
  const workflow = exchangeWorkflow([14 * 60_000], context);
  assert.equal(COLLABORATION_MAX_DURATION_MS, 15 * 60_000);
  assert.equal(await workflow.run(), null);
  assert.equal(workflow.elapsed(), 14 * 60_000);
  assert.equal(workflow.settledWaves(), 1);
});

test("unfinished native work times out at fifteen minutes even when a question is Never", async (context) => {
  const workflow = exchangeWorkflow([Infinity], context);
  await assert.rejects(workflow.run(), /COLLABORATION_BARRIER_TIMEOUT/);
  assert.equal(workflow.elapsed(), 15 * 60_000);
  assert.equal(workflow.settledWaves(), 0);
});

test("later Collaboration waves spend only the remaining exchange budget", async (context) => {
  const workflow = exchangeWorkflow([14 * 60_000, 20 * 60_000], context);
  await assert.rejects(workflow.run(), /COLLABORATION_BARRIER_TIMEOUT/);
  assert.equal(workflow.elapsed(), 15 * 60_000);
  assert.equal(workflow.settledWaves(), 1);
});
