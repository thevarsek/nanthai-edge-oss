import assert from "node:assert/strict";
import test from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import { start, bindWorkflow } from "../runtime_host/decision_helpers";
import { buildHelperPacket } from "../runtime_host/helper_packet";
import { decisionFixture, handler } from "./local_decision_helper_fixture";

const args = {
  parentAttemptId: "attempt-1" as Id<"executionAttempts">, parentFence: 7,
  chatId: "chat-1" as Id<"chats">, sourceMessageId: "message-1" as Id<"messages">,
  requestKey: "discussion:1", participantIds: ["participant-1" as Id<"chatParticipants">],
  messages: [{ role: "system", content: "Judge only the supplied evidence" }, { role: "user", content: "Discussion" }],
};
const startHandler = handler<typeof args, Id<"runtimeHelperTasks"> | null>(start);

for (const adapter of ["codex", "pi"] as const) test(`${adapter} judge is a fresh owned child with no Persona prompt and no public job`, async () => {
  const state = await decisionFixture(adapter);
  const taskId = await startHandler(state.ctx, args);
  assert.ok(taskId);
  assert.equal(await startHandler(state.ctx, args), taskId);
  const task = state.rows.runtimeHelperTasks.find(row => row._id === taskId) as unknown as Doc<"runtimeHelperTasks">;
  const attempt = state.rows.executionAttempts.find(row => row._id === task.attemptId) as unknown as Doc<"executionAttempts">;
  const run = state.rows.executionRuns.find(row => row._id === task.runId) as unknown as Doc<"executionRuns">;
  assert.equal(run.parentRunId, "run-1");
  assert.equal(task.sourceJobId, undefined);
  assert.equal(state.rows.messages.length, 1);
  assert.equal(state.rows.generationJobs.length, 1);
  assert.equal(attempt.modelId, adapter === "codex" ? "gpt-6-luna" : "qwen3:8b");
  assert.equal(attempt.provider, adapter === "codex" ? "openai" : "ollama");
  const packet = await buildHelperPacket({ task, attempt, run, personaId: "persona-1" as Id<"personas"> });
  assert.deepEqual(packet.instructions.persona, []);
  assert.equal(packet.messages.length, 1);
  assert.deepEqual(packet.capabilities.nanthaiTools, []);
  assert.doesNotMatch(JSON.stringify(packet), /Always endorse my plan/);
  await handler<{ taskId: Id<"runtimeHelperTasks">; workflowId: string }, null>(bindWorkflow)(state.ctx, { taskId, workflowId: "child-workflow" });
  assert.equal(state.rows.executionComponentRefs[0].runId, run._id);
});

test("offline routes and unrelated participants never select another account's runtime", async () => {
  const state = await decisionFixture();
  state.rows.runtimeDevicePresences[0].status = "offline";
  assert.equal(await startHandler(state.ctx, args), null);
  assert.equal(state.rows.runtimeHelperTasks?.length ?? 0, 0);
  state.rows.runtimeDevicePresences[0].status = "online";
  state.rows.chatParticipants[0].userId = "another-user";
  assert.equal(await startHandler(state.ctx, args), null);
});

test("parent cancellation and a stale fence stop helper creation before dispatch", async () => {
  const state = await decisionFixture();
  await assert.rejects(startHandler(state.ctx, { ...args, parentFence: 8 }), /FENCE/);
  state.rows.executionRuns[0].state = "cancelling";
  await assert.rejects(startHandler(state.ctx, args), /CANCELL/);
  assert.equal(state.rows.runtimeHelperTasks?.length ?? 0, 0);
});
