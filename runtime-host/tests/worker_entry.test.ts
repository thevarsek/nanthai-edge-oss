import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  HostToWorkerMessageSchema,
  PROCESS_WIRE_VERSION,
  type HostToWorkerMessage,
  type WorkerToHostMessage,
} from "../src/protocol.ts";
import { WireWorker } from "../src/wire_worker.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

const workerEntry = fileURLToPath(new URL("../src/worker_entry.ts", import.meta.url));
const fakeAppServer = fileURLToPath(
  new URL("./fixtures/fake_json_rpc_child.mjs", import.meta.url),
);

test("App Server worker enforces seed reference, approval, replay, and clean close", async () => {
  const probeDirectory = await mkdtemp(join(tmpdir(), "nanthai-warning-approval-"));
  const target = join(probeDirectory, "must-not-exist.txt");
  const packet = runtimePacket([{
    type: "text", partId: "part-1", text: `WARNING APPROVAL TARGET=${target}`,
  }]);
  const worker = spawnWorker("app-server");
  const iterator = worker[Symbol.asyncIterator]();
  await nextKind(iterator, "worker_ready");
  worker.send(message(0, "start_session_request", {
    placement: packet.placement, packetSeed: packet,
  }));
  const session = await nextKind(iterator, "session_result");
  assert.equal(session.payload.nativeSessionId, "thread-1");

  worker.send(message(1, "send_turn_request", {
    sessionId: packet.attemptId,
    commandId: packet.command.commandId,
    packetHash: "9".repeat(64),
  }));
  assert.equal((await nextKind(iterator, "command_result")).payload.code,
    "packet_reference_mismatch");

  worker.send(message(2, "send_turn_request", {
    sessionId: packet.attemptId,
    commandId: packet.command.commandId,
    packetHash: packet.command.packetHash,
  }));
  assert.equal((await nextKind(iterator, "command_result")).payload.status, "accepted");
  const permission = await nextEvent(iterator, "permission_requested");
  assert.equal(permission.permissionRequestId, "0");
  worker.send(message(3, "permission_response_request", {
    sessionId: packet.attemptId,
    permissionRequestId: permission.permissionRequestId,
    decision: "deny",
  }));
  assert.equal((await nextEvent(iterator, "permission_resolved")).decision, "deny");
  const terminal = await nextKind(iterator, "terminal_event");
  assert.equal(terminal.payload.event.outcome, "completed");
  assert.equal(await exists(target), false);
  await commandStatus(iterator, "wire-2", "completed");

  worker.send(message(4, "send_turn_request", {
    sessionId: packet.attemptId,
    commandId: packet.command.commandId,
    packetHash: packet.command.packetHash,
  }));
  assert.equal((await nextKind(iterator, "command_result")).payload.code,
    "turn_already_dispatched");
  await closeWorker(worker, iterator, packet.attemptId, 5);
  await rm(probeDirectory, { recursive: true, force: true });
});

test("worker rejects a tampered packet before starting a Codex session", async () => {
  const packet = runtimePacket();
  const worker = spawnWorker("app-server");
  const iterator = worker[Symbol.asyncIterator]();
  await nextKind(iterator, "worker_ready");
  worker.send(message(0, "start_session_request", {
    placement: packet.placement,
    packetSeed: { ...packet, chatId: "tampered-chat" },
  }));
  const failure = await nextKind(iterator, "protocol_error");
  assert.equal(failure.payload.code, "packet_integrity_failed");
  await worker.close();
});

test("App Server worker resumes and settles cancellation after terminal evidence", async () => {
  const packet = runtimePacket([{
    type: "text", partId: "part-1", text: "SLOW_START WAIT",
  }]);
  const worker = spawnWorker("app-server");
  const iterator = worker[Symbol.asyncIterator]();
  await nextKind(iterator, "worker_ready");
  worker.send(message(0, "resume_request", {
    placement: packet.placement,
    packetSeed: packet,
    nativeSessionId: "thread-resumed",
    expectedNativeTurnId: "turn-owned",
    deliveredMessageIds: [],
    checkpointRef: "checkpoint-1",
  }));
  const session = await nextKind(iterator, "session_result");
  assert.equal(session.payload.resumed, true);
  assert.equal(session.payload.nativeSessionId, "thread-resumed");
  worker.send(message(1, "send_turn_request", {
    sessionId: packet.attemptId,
    commandId: packet.command.commandId,
    packetHash: packet.command.packetHash,
  }));
  await commandStatus(iterator, "wire-1", "accepted");
  worker.send(message(2, "cancel_request", {
    sessionId: packet.attemptId,
    cancellationId: packet.command.cancellationId,
    reason: "Deterministic test cancellation",
  }));
  await commandStatus(iterator, "wire-2", "accepted");
  const terminal = await nextKind(iterator, "terminal_event");
  assert.equal(terminal.payload.event.outcome, "cancelled");
  await commandStatus(iterator, "wire-2", "completed");
  await closeWorker(worker, iterator, packet.attemptId, 3);
});

function spawnWorker(transport: "app-server"): WireWorker {
  const executable = process.execPath;
  const args = ["--import", "tsx", workerEntry, `--transport=${transport}`,
    `--codex-command=${executable}`];
  if (transport === "app-server") args.push(`--codex-arg=${fakeAppServer}`);
  return WireWorker.spawn({ command: process.execPath, args });
}

function message<K extends HostToWorkerMessage["kind"]>(
  sequence: number,
  kind: K,
  payload: Extract<HostToWorkerMessage, { kind: K }>["payload"],
): HostToWorkerMessage {
  return HostToWorkerMessageSchema.parse({
    wireVersion: PROCESS_WIRE_VERSION,
    messageId: `wire-${sequence}`,
    sequence,
    sentAt: 1_786_752_000_000 + sequence,
    kind,
    payload,
  });
}

async function nextKind<K extends WorkerToHostMessage["kind"]>(
  iterator: AsyncIterator<WorkerToHostMessage>,
  kind: K,
): Promise<Extract<WorkerToHostMessage, { kind: K }>> {
  for (;;) {
    const next = await iterator.next();
    if (next.done) throw new Error(`Worker ended before ${kind}`);
    if (next.value.kind === kind) {
      return next.value as Extract<WorkerToHostMessage, { kind: K }>;
    }
  }
}

async function nextEvent<T extends string>(
  iterator: AsyncIterator<WorkerToHostMessage>,
  type: T,
): Promise<Extract<NonTerminalEvent, { type: T }>> {
  for (;;) {
    const message = await nextKind(iterator, "adapter_event");
    if (message.payload.event.type === type) {
      return message.payload.event as Extract<NonTerminalEvent, { type: T }>;
    }
  }
}

type NonTerminalEvent = Extract<WorkerToHostMessage, { kind: "adapter_event" }>["payload"]["event"];

async function commandStatus(
  iterator: AsyncIterator<WorkerToHostMessage>,
  requestId: string,
  status: "accepted" | "completed" | "rejected",
): Promise<void> {
  for (;;) {
    const result = await nextKind(iterator, "command_result");
    if (result.payload.requestMessageId === requestId && result.payload.status === status) return;
  }
}

async function closeWorker(
  worker: WireWorker,
  iterator: AsyncIterator<WorkerToHostMessage>,
  sessionId: string,
  sequence: number,
): Promise<void> {
  worker.send(message(sequence, "close_request", { sessionId, reason: "Test complete" }));
  await commandStatus(iterator, `wire-${sequence}`, "completed");
  assert.deepEqual(await worker.exit, { code: 0, signal: null });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
