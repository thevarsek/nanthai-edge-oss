import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { WorkflowCtx } from "@convex-dev/workflow";
import { runLocalAutonomousTurn } from "../autonomous/local_turn_execution";
import type { RunCycleArgs } from "../autonomous/actions_run_cycle_types";
import type { Id } from "../_generated/dataModel";

const args: RunCycleArgs & { participantIndex: number } = {
  sessionId: "session-1" as Id<"autonomousSessions">, userId: "user_1", cycle: 1,
  participantIndex: 0, participantConfigs: [], webSearchEnabled: false, executionEpoch: 4,
};
function workflow(recovered: string) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const step = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0], input: Record<string, unknown>) => {
      const name = getFunctionName(ref); calls.push({ name, args: input });
      if (name.endsWith("getSession")) return { _id: "session-1", status: "running" };
      if (name.endsWith("outcome")) return "completed";
      throw new Error(`Unexpected query ${name}`);
    },
    runMutation: async (ref: Parameters<typeof getFunctionName>[0], input: Record<string, unknown>) => {
      const name = getFunctionName(ref); calls.push({ name, args: input });
      if (name.endsWith("recoverTurn")) return recovered;
      if (name.endsWith("createTurn")) return { participant: { jobId: "job-1", messageId: "message-1" }, executionAttemptId: "child-attempt", executionFence: 1 };
      if (name.endsWith("updateProgress") || name.endsWith("settle")) return null;
      throw new Error(`Unexpected mutation ${name}`);
    },
    runWorkflow: async (ref: Parameters<typeof getFunctionName>[0], input: Record<string, unknown>) => { calls.push({ name: getFunctionName(ref), args: input }); return null; },
  } as unknown as WorkflowCtx;
  return { step, calls };
}

test("Autonomous waits for the ordinary child dispatcher before committing its turn checkpoint", async () => {
  const { step, calls } = workflow("execute");
  assert.deepEqual(await runLocalAutonomousTurn(step, args), { kind: "completed" });
  const child = calls.findIndex(call => call.name === "autonomous/local_turn_workflow:run");
  const settled = calls.findIndex(call => call.name === "autonomous/turn_checkpoint:settle");
  assert.ok(child > 0 && settled > child);
  assert.equal(calls[child].args.executionAttemptId, "child-attempt");
  assert.equal(calls[settled].args.messageId, "message-1");
  assert.equal(calls[settled].args.executionEpoch, 4);
});

for (const recovered of ["completed", "failed", "terminal"]) test(`a ${recovered} checkpoint does not create a second local execution`, async () => {
  const { step, calls } = workflow(recovered);
  assert.deepEqual(await runLocalAutonomousTurn(step, args), { kind: recovered });
  assert.equal(calls.length, 1);
});
