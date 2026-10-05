import assert from "node:assert/strict";
import test from "node:test";
import type { Id } from "../_generated/dataModel";
import { createTurn } from "../autonomous/local_turns";
import type { GenerationParticipantWorkflowArgs } from "../chat/workflow_contract";
import { decisionFixture, handler } from "./local_decision_helper_fixture";

const args = {
  sessionId: "autonomous-1" as Id<"autonomousSessions">, cycle: 1, participantIndex: 0,
  userId: "user_1", participantConfigs: [{ participantId: "participant-1", modelId: "openai/gpt-6.1-sol", personaId: "persona-1" as Id<"personas">, displayName: "Local reviewer" }],
  webSearchEnabled: false, executionAttemptId: "attempt-1" as Id<"executionAttempts">, executionFence: 7, executionEpoch: 1,
  moderatorDirective: "Focus the coaching note on the missing concrete evidence.",
};

async function fixture() {
  const state = await decisionFixture();
  Object.assign(state.rows.messages[0], { role: "user", status: "completed", content: "Review this plan", parentMessageIds: [] });
  state.rows.autonomousSessions = [{ _id: "autonomous-1", userId: "user_1", chatId: "chat-1", status: "running", turnOrder: ["participant-1", "participant-2"], parentMessageIds: ["message-1"],
    executionEpoch: 1, executionRunId: "run-1", executionAttemptId: "attempt-1", executionFence: 7,
    activeTurnCycle: 1, activeTurnParticipantIndex: 0, activeTurnExecutionEpoch: 1 }];
  return state;
}
const create = handler<typeof args, GenerationParticipantWorkflowArgs | null>(createTurn);

test("an Autonomous local turn creates the ordinary canonical generation route under its session run", async () => {
  const state = await fixture();
  const turn = await create(state.ctx, args);
  assert.ok(turn);
  const job = state.rows.generationJobs.find(item => item._id === turn.participant.jobId);
  const attempt = state.rows.executionAttempts.find(item => item._id === job?.executionAttemptId);
  const run = state.rows.executionRuns.find(item => item._id === job?.executionRunId);
  const message = state.rows.messages.find(item => item._id === turn.participant.messageId);
  assert.equal(attempt?.placement, "local");
  assert.equal(attempt?.adapterId, "codex");
  assert.equal(attempt?.modelId, "gpt-6.1-sol");
  assert.equal(attempt?.chatParticipantId, "participant-1");
  assert.equal(run?.parentRunId, "run-1");
  assert.equal(message?.autonomousParticipantId, "participant-1");
  assert.equal(message?.moderatorDirective, args.moderatorDirective);
  assert.deepEqual(message?.parentMessageIds, ["message-1"]);
  assert.equal(state.rows.autonomousSessions[0].activeTurnJobId, job?._id);
  assert.equal(turn.userMessageId, "message-1");
});

test("an old or stopped session cannot create or publish a local turn", async () => {
  const state = await fixture();
  assert.equal(await create(state.ctx, { ...args, executionEpoch: 2 }), null);
  state.rows.autonomousSessions[0].status = "stopped";
  assert.equal(await create(state.ctx, args), null);
  assert.equal(state.rows.messages.length, 1);
});
