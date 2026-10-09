import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import type { WorkflowCtx } from "@convex-dev/workflow";
import { runDiscussionPolicy } from "../collaboration/discussion_workflow";
import type { RunCycleArgs } from "../autonomous/actions_run_cycle_types";

function fixture(failedFirst = false) {
  const calls: string[] = [];
  const turns: Array<{ cycle: number; participantIndex: number; participantConfigs: unknown }> = [];
  const session = { status: "running", executionEpoch: 1, turnOrder: ["writer", "reviewer"],
    pauseBetweenTurns: 1, autoStopOnConsensus: true, executionRunId: "run", executionClaimantId: "discussion" };
  const step = {
    runQuery: async (ref: Parameters<typeof getFunctionName>[0]) => {
      const name = getFunctionName(ref); calls.push(name);
      if (name.endsWith(":getSession")) return session;
      if (name.endsWith(":resolveCurrent")) return { participantConfigs: [{ participantId: "writer", modelId: "current-model" }] };
      if (name.endsWith(":route")) return "cloud";
      if (name.endsWith(":hasCloudConnection")) return true;
      throw new Error(name);
    },
    runMutation: async () => null,
    runAction: async (ref: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>, options: unknown) => {
      assert.deepEqual(options, { retry: false });
      const name = getFunctionName(ref); calls.push(name);
      if (name.endsWith(":runAutonomousTurn")) {
        turns.push(args as typeof turns[number]);
        return { kind: failedFirst && args.participantIndex === 0 ? "failed" : "completed" };
      }
      return args.cycle === 2 ? "terminal" : "continue";
    },
    sleep: async () => { calls.push("pause"); },
  } as unknown as WorkflowCtx;
  const args = { sessionId: "session", userId: "owner", cycle: 1, participantConfigs: [],
    webSearchEnabled: true, executionAttemptId: "attempt", executionFence: 1, executionEpoch: 1 } as unknown as RunCycleArgs;
  return { run: () => runDiscussionPolicy(step, args), turns, calls, session };
}

test("common discussion policy retains ordered cycles, pauses, current configuration and consensus control", async () => {
  const f = fixture();
  assert.equal(await f.run(), null);
  assert.deepEqual(f.turns.map(turn => [turn.cycle, turn.participantIndex]), [[1,0], [1,1], [2,0], [2,1]]);
  assert.deepEqual(f.turns[0].participantConfigs, [{ participantId: "writer", modelId: "current-model" }]);
  assert.equal(f.calls.filter(name => name === "pause").length, 2);
});
test("a failed member is not invoked again while independent discussion members can proceed", async () => {
  const f = fixture(true); await f.run();
  assert.deepEqual(f.turns.map(turn => [turn.cycle, turn.participantIndex]), [[1,0], [1,1], [2,1]]);
});
test("a paused session dispatches no Persona until explicitly resumed", async () => {
  const f = fixture(); f.session.status = "paused"; await f.run(); assert.equal(f.turns.length, 0);
});
