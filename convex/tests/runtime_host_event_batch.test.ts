import assert from "node:assert/strict";
import test from "node:test";
import { ingestRuntimeEventsHandler } from "../runtime_host/chat_event_ingestion";
import { canonicalState, fixture, oldHost, workerEvent } from "./runtime_host_event_replay_fixture";

test("ordered batch settlement and replay preserve one canonical answer and terminal outcome", async () => {
  const { ctx, rows } = await fixture();
  const events = [workerEvent(5, "terminal_event"), workerEvent(6, "command_result")];
  const args = { ...oldHost, events };
  assert.deepEqual(await ingestRuntimeEventsHandler(ctx, args), events.map((event) => event.eventId));
  const settled = canonicalState(rows);
  assert.equal(settled.run.state, "completed");
  assert.equal(settled.message.content, "Canonical answer");
  assert.deepEqual(await ingestRuntimeEventsHandler(ctx, args), events.map((event) => event.eventId));
  assert.deepEqual(canonicalState(rows), settled);
  assert.equal(rows.executionAttempts[0].runtimeLastWorkerSequence, 6);
});
