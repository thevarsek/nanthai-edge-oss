import assert from "node:assert/strict";
import test from "node:test";
import { CodexAttemptPump } from "../src/codex_attempt_pump.ts";
import type { RuntimeCommand } from "../src/control_plane.ts";
import type { WorkerToHostMessage } from "../src/protocol.ts";

test("structured response events retain the exact follow-up command rather than the opening turn", async () => {
  const primary = { commandId: "start", commandRecordId: "primary", runId: "run", attemptId: "attempt", fence: 1 } as RuntimeCommand;
  const followup = { ...primary, commandId: "input-response", commandRecordId: "response" };
  const pump = new CodexAttemptPump(primary, () => 1);
  const request = pump.sequencer.next("response", { kind: "input_response_request", payload: { sessionId: "attempt", inputRequestId: "native-input", response: { outcome: "submitted", content: { destination: "A" } } } });
  const waiter = pump.register(request, followup);
  const resolved = { kind: "adapter_event", payload: { event: { type: "input_resolved", inputRequestId: "native-input", outcome: "submitted" } } } as WorkerToHostMessage;
  assert.equal(pump.referenceFor(resolved).commandRecordId, "response");
  const unrelated = { kind: "adapter_event", payload: { event: { type: "input_resolved", inputRequestId: "other" } } } as WorkerToHostMessage;
  assert.equal(pump.referenceFor(unrelated).commandRecordId, "primary");
  pump.response({ kind: "command_result", payload: { requestMessageId: request.messageId, status: "completed", code: null, summary: "Delivered" } } as WorkerToHostMessage)?.complete();
  await waiter;
});
