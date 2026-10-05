import test from "node:test";
import assert from "node:assert/strict";
import { checkpointExecutor } from "../src/checkpoint_executor.ts";
import { continuationCommand } from "../src/saved_task_continuation.ts";
import type { SavedTask, LocalResult } from "../src/saved_task_store.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

const task: SavedTask = { version: 1, id: "run-1", deviceId: "device-1", server: "https://example.test", title: "Draft",
  packet: runtimePacket(), output: "Answer", outcome: "completed", nativeSessionId: null, nativeTurnId: null, files: [], updatedAt: 1 };
const result: LocalResult = { version: 1, id: "result-1", taskId: task.id, prompt: "Next", output: "", outcome: null,
  baseOutputHash: "", previousResultId: null, ownerPid: 1, files: [], usage: [], createdAt: 1, synced: false, disposition: null };

test("drained completed and failed turns evict only their checkpoint; follow-up responses preserve it", async () => {
  const command = continuationCommand(task, result, []);
  const tasks = new Map([[command.attemptId, task], ["other-active-attempt", task]]);
  let fail = false;
  const owner = checkpointExecutor({ activeCount: () => 1, shutdown: async () => {}, execute: async () => { if (fail) throw new Error("worker failed"); } },
    { record: async () => {} }, tasks);
  await owner.execute({ ...command, kind: "permission_response" }, async () => {}, new AbortController().signal);
  assert.equal(tasks.has(command.attemptId), true);
  await owner.execute(command, async () => {}, new AbortController().signal);
  assert.equal(tasks.has(command.attemptId), false);
  assert.equal(tasks.has("other-active-attempt"), true);
  tasks.set(command.attemptId, task); fail = true;
  await assert.rejects(owner.execute(command, async () => {}, new AbortController().signal), /worker failed/);
  assert.equal(tasks.has(command.attemptId), false);
  assert.equal(tasks.size, 1);
  await owner.shutdown();
  assert.equal(tasks.size, 0);
});
