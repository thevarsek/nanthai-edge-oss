import assert from "node:assert/strict";
import test from "node:test";

import type { MutationCtx } from "../_generated/server";
import { reconcileAdvisorSynthesisWork } from "../advisors/workflow_steps";
import { reconcileAdvisorSynthesisWatchdogHandler } from
  "../advisors/workflow_watchdog";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";

type CompletionHandler = {
  _handler: (ctx: MutationCtx, args: {
    workId: string;
    result: { kind: "failed"; error: string };
    context: { batchId: string; assistantMessageId: string };
  }) => Promise<void>;
};

test("late failed synthesis callback preserves canonical completed message", async () => {
  const rows = {
    advisorBatches: [{
      _id: "batch_1",
      status: "synthesizing",
      assistantMessageIds: ["message_1", "message_2"],
      generationOperationIds: ["work_1", "work_2"],
      completedRunCount: 1,
    }],
    messages: [
      {
        _id: "message_1",
        advisorBatchId: "batch_1",
        status: "completed",
      },
      {
        _id: "message_2",
        advisorBatchId: "batch_1",
        status: "streaming",
      },
    ],
    executionComponentRefs: [{
      _id: "component_1",
      adapterId: "interactive-workpool",
      operationId: "work_1",
      status: "active",
    }],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;

  await (reconcileAdvisorSynthesisWork as unknown as CompletionHandler)._handler(
    ctx,
    {
      workId: "work_1",
      result: { kind: "failed", error: "late worker failure" },
      context: {
        batchId: "batch_1",
        assistantMessageId: "message_1",
      },
    },
  );

  assert.equal(rows.executionComponentRefs[0]?.status, "completed");
  assert.equal(rows.advisorBatches[0]?.status, "synthesizing");
  assert.equal(rows.messages[1]?.status, "streaming");
});

test("failed synthesis callback preserves a committed search generation handoff", async () => {
  const rows = {
    advisorBatches: [{
      _id: "batch_1",
      status: "synthesizing",
      assistantMessageIds: ["message_1"],
      generationOperationIds: ["search_work_1"],
      completedRunCount: 1,
    }],
    messages: [{
      _id: "message_1",
      advisorBatchId: "batch_1",
      status: "streaming",
    }],
    searchSessions: [{
      _id: "search_session_1",
      assistantMessageId: "message_1",
      status: "writing",
      generationHandoffOperationId: "generation_workflow_1",
    }],
    executionComponentRefs: [{
      _id: "component_1",
      adapterId: "interactive-workpool",
      operationId: "search_work_1",
      status: "active",
    }],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;

  await (reconcileAdvisorSynthesisWork as unknown as CompletionHandler)._handler(
    ctx,
    {
      workId: "search_work_1",
      result: { kind: "failed", error: "result lost after handoff" },
      context: {
        batchId: "batch_1",
        assistantMessageId: "message_1",
      },
    },
  );

  assert.equal(rows.executionComponentRefs[0]?.status, "completed");
  assert.equal(rows.advisorBatches[0]?.status, "synthesizing");
  assert.equal(rows.messages[0]?.status, "streaming");
});

test("advisor watchdog terminalizes lost Workpool callback from batch state", async () => {
  const rows = {
    advisorBatches: [{
      _id: "batch_1",
      status: "completed",
      assistantMessageIds: ["message_1"],
      generationOperationIds: ["work_1"],
    }],
    executionComponentRefs: [{
      _id: "component_1",
      adapterId: "interactive-workpool",
      operationId: "work_1",
      status: "active",
    }],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;

  const result = await reconcileAdvisorSynthesisWatchdogHandler(ctx, {
    workflowId: "work_1",
    batchId: "batch_1" as never,
    adapterId: "interactive-workpool",
    assistantMessageId: "message_1" as never,
  });

  assert.equal(result, "settled");
  assert.equal(rows.executionComponentRefs[0]?.status, "completed");
});

test("advisor watchdog accepts a committed search generation handoff", async () => {
  const rows = {
    advisorBatches: [{
      _id: "batch_1",
      status: "synthesizing",
      assistantMessageIds: ["message_1"],
      generationOperationIds: ["search_work_1"],
    }],
    messages: [{
      _id: "message_1",
      advisorBatchId: "batch_1",
      status: "streaming",
    }],
    searchSessions: [{
      _id: "search_session_1",
      assistantMessageId: "message_1",
      status: "writing",
      generationHandoffOperationId: "generation_workflow_1",
    }],
    executionComponentRefs: [{
      _id: "component_1",
      adapterId: "interactive-workpool",
      operationId: "search_work_1",
      status: "active",
    }],
  };
  const ctx = createStatefulMockCtx(rows) as unknown as MutationCtx;

  const result = await reconcileAdvisorSynthesisWatchdogHandler(ctx, {
    workflowId: "search_work_1",
    batchId: "batch_1" as never,
    adapterId: "interactive-workpool",
    assistantMessageId: "message_1" as never,
  });

  assert.equal(result, "settled");
  assert.equal(rows.executionComponentRefs[0]?.status, "completed");
  assert.equal(rows.advisorBatches[0]?.status, "synthesizing");
});
