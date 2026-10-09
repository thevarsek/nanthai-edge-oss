import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { WorkflowCtx } from "@convex-dev/workflow";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { COLLABORATION_MAX_DURATION_MS } from "../collaboration/constants";
import { observeProgress } from "../collaboration/work_progress";
import { runCollaborationWorkflowHandler } from "../collaboration/workflow";
import { heartbeatExecution } from "../execution/control_plane";
import { DOMAIN_EXECUTION_LEASE_MS } from "../execution/domain_lifecycle";
import { settleDecisionHandler } from "../collaboration/settle_mutation";
import type { CollaborationExecutionRef } from "../collaboration/validators";

const observe = (observeProgress as unknown as {
  _handler: (ctx: MutationCtx, args: { exchangeId: Id<"collaborationExchanges">;
    execution: CollaborationExecutionRef }) => Promise<{ kind: string; decisionId?: Id<"collaborationDecisions"> }>;
})._handler;

function exchangeWorkflow(completionTimes: number[], context: test.TestContext) {
  let elapsed = 0;
  let wave = 0;
  let settledWaves = 0;
  let wakeCount = 0;
  const startedAt = 1_000_000;
  context.mock.method(Date, "now", () => startedAt + elapsed);
  const job = { _id: "job", messageId: "assistant", status: "streaming" };
  const execution = { runId: "run" as Id<"executionRuns">,
    attemptId: "attempt" as Id<"executionAttempts">, fence: 1, claimantId: "workflow" };
  const decision = { _id: "decision", exchangeId: "exchange", wave: 1, status: "settled",
    generationJobIds: ["job"], assistantMessageIds: ["assistant"] };
  const exchange = { _id: "exchange", userId: "owner", chatId: "chat", status: "queued",
    bounds: { deadlineAt: startedAt + 15 * 60_000 },
    executionRunId: "run", executionAttemptId: "attempt",
    executionFence: 1, executionClaimantId: "workflow",
    participantSnapshot: [], failedParticipantIds: [],
    pendingHumanMessageIds: [], frontierMessageIds: ["user"], publishedMessageCount: 0 };
  const ctx = createStatefulMockCtx({
    collaborationExchanges: [exchange], collaborationDecisions: [decision],
    executionRuns: [{ _id: "run", state: "running", activeAttemptId: "attempt", userId: "owner" }],
    executionAttempts: [{ _id: "attempt", runId: "run", fence: 1, status: "running",
      claimantId: "workflow", leaseExpiresAt: startedAt + DOMAIN_EXECUTION_LEASE_MS }],
    messages: [{ _id: "assistant", status: "completed" }],
    accountDeletionTombstones: [], generationJobs: [job],
  }) as unknown as MutationCtx;
  const step = {
    runMutation: async (ref: unknown, args: unknown) => {
      const name = getFunctionName(ref as never);
      if (name.endsWith(":heartbeat")) return heartbeatExecution(ctx,
        args as Parameters<typeof heartbeatExecution>[1]);
      if (name.endsWith(":armWake")) return "wake-event";
      if (name.endsWith(":observeProgress")) return observe(ctx, { exchangeId: "exchange" as never, execution });
      if (name.endsWith(":prepareWave")) {
        wave += 1;
        return { kind: "ready", wave, frontierMessageIds: ["user"] };
      }
      if (name.endsWith(":selectWorkSpeakers")) return null;
      if (name.endsWith(":persistDecision")) return { decisionId: "decision", silent: false };
      if (name.endsWith(":dispatchDecision")) {
        job.status = "streaming"; decision.status = "dispatched";
        return null;
      }
      if (name.endsWith(":settleDecision")) {
        await settleDecisionHandler(ctx, { exchangeId: "exchange" as never,
          decisionId: "decision" as never, execution });
        settledWaves += 1;
        return { terminal: settledWaves === completionTimes.length };
      }
      throw new Error(`Unexpected mutation: ${name}`);
    },
    runQuery: async () => true,
    runAction: async () => ({}),
    awaitEvent: async () => {
      wakeCount += 1;
      elapsed = Math.min(completionTimes[wave - 1], 15 * 60_000);
      if (elapsed >= completionTimes[wave - 1]) job.status = "completed";
    },
  } as unknown as WorkflowCtx;
  return { run: () => runCollaborationWorkflowHandler(step, { exchangeId: "exchange" as never, execution }),
    elapsed: () => elapsed, settledWaves: () => settledWaves, wakeCount: () => wakeCount,
    status: () => exchange.status };
}

test("native human wait completes after fourteen minutes with one event wait and no polling", async (context) => {
  const workflow = exchangeWorkflow([14 * 60_000], context);
  assert.equal(COLLABORATION_MAX_DURATION_MS, 15 * 60_000);
  assert.equal(await workflow.run(), null);
  assert.equal(workflow.elapsed(), 14 * 60_000);
  assert.equal(workflow.settledWaves(), 1);
  assert.equal(workflow.wakeCount(), 1);
});

test("a Never question ends at the selected duration and retains the limit outcome", async (context) => {
  const workflow = exchangeWorkflow([Infinity], context);
  assert.equal(await workflow.run(), null);
  assert.equal(workflow.elapsed(), 15 * 60_000);
  assert.equal(workflow.settledWaves(), 0);
  assert.equal(workflow.status(), "limit_reached");
});

test("later waves spend only the remaining duration and retain completed peer output", async (context) => {
  const workflow = exchangeWorkflow([14 * 60_000, 20 * 60_000], context);
  assert.equal(await workflow.run(), null);
  assert.equal(workflow.elapsed(), 15 * 60_000);
  assert.equal(workflow.settledWaves(), 1);
  assert.equal(workflow.wakeCount(), 2);
  assert.equal(workflow.status(), "limit_reached");
});
