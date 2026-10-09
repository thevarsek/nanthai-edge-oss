import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowCtx } from "@convex-dev/workflow";
import { getFunctionName } from "convex/server";
import { decideLocalSpeakers } from "../collaboration/local_scheduler";
import type { SchedulerPolicyInput } from "../collaboration/scheduler_policy";
import type { Id } from "../_generated/dataModel";

const participant = "writer" as Id<"chatParticipants">;
const goal = "goal" as Id<"collaborationWork">;
const message = "start" as Id<"messages">;
const input: SchedulerPolicyInput = {
  wave: 1, frontierMessageIds: [message], participants: [{ participantId: participant, modelId: "local", displayName: "Writer" }],
  mentionedParticipantIds: [], failedParticipantIds: [], previousSpeakerIds: [], recentMessages: [],
  remainingMessageBudget: 8, deadlineReached: false,
  work: [{ id: goal, objective: "Prepare proposal", criteria: ["Include costs"], status: "open", participantIds: [participant] }],
};
function stepFor(online: boolean, failed = false) {
  const mutations: string[] = [];
  const step = {
    runAction: async () => { throw new Error("No cloud model or Jev call is permitted in this test"); },
    runMutation: async (ref: unknown, payload: unknown) => {
      const name = getFunctionName(ref as never); mutations.push(name);
      assert.equal(name, "runtime_host/decision_helpers:start");
      assert.ok(JSON.stringify(payload).includes("Prepare proposal"));
      return online ? "helper" : null;
    },
    runWorkflow: async () => { assert.ok(online); return null; },
    runQuery: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name === "collaboration/scheduler_context:getSchedulerContext") return { ...input, chatId: "chat", messageId: message };
      assert.equal(name, "runtime_host/helper_tasks:get");
      return { task: { status: failed ? "failed" : "completed", content: JSON.stringify({ selections: [{ participantId: participant, workId: goal, replyToMessageIds: [message], reasonCode: "owned_work" }] }) } };
    },
  } as unknown as WorkflowCtx;
  return { step, mutations };
}
test("local-only goal assignment uses the existing runtime helper and the common validated selection", async () => {
  const { step, mutations } = stepFor(true);
  const result = await decideLocalSpeakers(step, { exchangeId: "exchange" as Id<"collaborationExchanges">, wave: 1, attemptId: "attempt" as Id<"executionAttempts">, fence: 1 });
  assert.equal(result.selections[0].workId, goal);
  assert.equal(result.selections[0].participantId, participant);
  assert.deepEqual(mutations, ["runtime_host/decision_helpers:start"]);
});
test("missing local runtime produces a wait reason rather than false completion or a cloud request", async () => {
  const { step } = stepFor(false);
  const result = await decideLocalSpeakers(step, { exchangeId: "exchange" as Id<"collaborationExchanges">, wave: 1, attemptId: "attempt" as Id<"executionAttempts">, fence: 1 });
  assert.deepEqual(result.selections, []);
  assert.equal(result.diagnosticCategory, "local_runtime_unavailable");
});

test("an online helper failure is visible for explicit retry, not an offline wait that could relaunch on heartbeat", async () => {
  const { step } = stepFor(true, true);
  const result = await decideLocalSpeakers(step, { exchangeId: "exchange" as Id<"collaborationExchanges">, wave: 1, attemptId: "attempt" as Id<"executionAttempts">, fence: 1 });
  assert.equal(result.diagnosticCategory, "scheduler_invalid_response");
  assert.deepEqual(result.selections, []);
});
