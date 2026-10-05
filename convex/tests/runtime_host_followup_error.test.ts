import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkerCommandCorrelation } from "../runtime_host/chat_event_context";
import type { RuntimeChatEventContext } from "../runtime_host/chat_terminal_ingestion";
import type { WorkerToHostMessage } from "../runtime_host/protocol_process";

test("a correlated cancellation error can reach fenced ingestion without admitting unrelated deltas", () => {
  const context = { job: { runtimeCommandRecordId: "primary" }, command: { _id: "cancel-command", type: "cancel" } } as RuntimeChatEventContext;
  assert.doesNotThrow(() => assertWorkerCommandCorrelation(context, { kind: "protocol_error", payload: { recoverable: false } } as WorkerToHostMessage));
  assert.throws(() => assertWorkerCommandCorrelation(context, { kind: "adapter_event", payload: { event: { type: "text_delta" } } } as WorkerToHostMessage), /supported follow-up/);
});
