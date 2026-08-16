import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "../_generated/server";
import { createStatefulMockCtx } from "../../test_helpers/convex_mock_ctx";
import { collaborationDecisionFailureMessage } from "../collaboration/lifecycle_mutations";
import { settleDecisionHandler } from "../collaboration/settle_mutation";

function fixture(jobStatus: "completed" | "failed") {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    chats: [{
      _id: "chat_1",
      userId: "user_1",
      activeBranchLeafId: "assistant_1",
      messageCount: 3,
      isDeleting: false,
    }],
    messages: [
      {
        _id: "root_1",
        chatId: "chat_1",
        role: "user",
        content: "Start",
        status: "completed",
        parentMessageIds: [],
      },
      {
        _id: "assistant_1",
        chatId: "chat_1",
        role: "assistant",
        content: jobStatus === "completed" ? "Done" : "",
        status: jobStatus,
        parentMessageIds: ["root_1"],
      },
      {
        _id: "human_2",
        chatId: "chat_1",
        role: "user",
        content: "Also check this",
        status: "completed",
        parentMessageIds: ["root_1"],
      },
    ],
    generationJobs: [{
      _id: "job_1",
      chatId: "chat_1",
      messageId: "assistant_1",
      chatParticipantId: "participant_1",
      status: jobStatus,
    }],
    collaborationExchanges: [{
      _id: "exchange_1",
      userId: "user_1",
      chatId: "chat_1",
      status: "waiting",
      currentWave: 1,
      participantSnapshot: [
        { participantId: "participant_1", modelId: "model_1", displayName: "One" },
        { participantId: "participant_2", modelId: "model_2", displayName: "Two" },
      ],
      failedParticipantIds: [],
      pendingHumanMessageIds: ["human_2"],
      frontierMessageIds: ["root_1"],
      publishedMessageCount: 0,
      executionRunId: "run_1",
      executionAttemptId: "attempt_1",
      executionFence: 4,
      executionClaimantId: "workflow_1",
    }],
    collaborationDecisions: [{
      _id: "decision_1",
      exchangeId: "exchange_1",
      status: "dispatched",
      generationJobIds: ["job_1"],
      assistantMessageIds: ["assistant_1"],
    }],
    executionRuns: [{
      _id: "run_1",
      userId: "user_1",
      chatId: "chat_1",
      state: "running",
      activeAttemptId: "attempt_1",
    }],
    executionAttempts: [{
      _id: "attempt_1",
      runId: "run_1",
      status: "running",
      fence: 4,
      leaseExpiresAt: Date.now() + 60_000,
    }],
    accountDeletionTombstones: [],
  };
  return {
    rows,
    ctx: createStatefulMockCtx(rows) as unknown as MutationCtx,
  };
}

const execution = {
  runId: "run_1",
  attemptId: "attempt_1",
  fence: 4,
  claimantId: "workflow_1",
};

test("scheduler and availability failures remain distinct from healthy silence", () => {
  assert.match(
    collaborationDecisionFailureMessage("scheduler_invalid_response") ?? "",
    /could not choose a participant/i,
  );
  assert.match(
    collaborationDecisionFailureMessage("no_eligible_participant") ?? "",
    /No Collaboration participant/i,
  );
  assert.equal(
    collaborationDecisionFailureMessage("nothing_substantive"),
    undefined,
  );
});

test("one failed speaker is excluded while another eligible participant may continue", async () => {
  const { rows, ctx } = fixture("failed");

  const result = await settleDecisionHandler(ctx, {
    exchangeId: "exchange_1" as never,
    decisionId: "decision_1" as never,
    execution: execution as never,
  });

  assert.deepEqual(result, { terminal: false, pending: false });
  assert.equal(rows.collaborationExchanges[0].status, "queued");
  assert.deepEqual(rows.collaborationExchanges[0].failedParticipantIds, ["participant_1"]);
  assert.deepEqual(rows.collaborationExchanges[0].frontierMessageIds, ["human_2"]);
  assert.equal(rows.chats[0].activeBranchLeafId, "human_2");
});

test("queued human input merges the successful wave before the next boundary", async () => {
  const { rows, ctx } = fixture("completed");

  await settleDecisionHandler(ctx, {
    exchangeId: "exchange_1" as never,
    decisionId: "decision_1" as never,
    execution: execution as never,
  });

  assert.deepEqual(rows.messages[2].parentMessageIds, ["root_1", "assistant_1"]);
  assert.deepEqual(
    rows.collaborationExchanges[0].frontierMessageIds,
    ["assistant_1", "human_2"],
  );
  assert.equal(rows.chats[0].activeBranchLeafId, "human_2");
});
