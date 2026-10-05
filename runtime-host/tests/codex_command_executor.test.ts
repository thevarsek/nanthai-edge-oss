import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CodexCommandExecutor } from "../src/codex_command_executor.ts";
import type { RuntimeCommand, RuntimeEvent } from "../src/control_plane.ts";
import { HostWireSequencer } from "../src/host_wire_sequencer.ts";
import { computePacketHash } from "../src/packet_integrity.ts";
import {
  BRIDGE_TOOLS,
  LocalRuntimeTurnPacketSchema,
  type LocalRuntimeTurnPacket,
} from "../src/protocol.ts";
import { atomicTurnPlan } from "../src/runtime_command_translation.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

const fakeServer = fileURLToPath(
  new URL("./fixtures/fake_json_rpc_child.mjs", import.meta.url),
);

test("one durable start command opens, runs, streams, and drains its isolated worker", async () => {
  const executor = new CodexCommandExecutor({
    codexCommand: process.execPath,
    codexArgs: [fakeServer],
    sandboxMode: "read-only",
    now: monotonicNow(),
  });
  const events: RuntimeEvent[] = [];
  const value = packet("attempt-1", "participant-1", "command-1", "REPORT_THREAD_NAME");
  try {
    await executor.execute(command(value, { threadName: "Architect · Runtime host" }), async (event) => {
      events.push(event);
    }, new AbortController().signal);
    assert.equal(executor.activeCount(), 0);
    const messages = events.map((event) => event.payload as { kind?: string; payload?: unknown });
    assert.equal(messages.some((message) => message.kind === "session_result"), true);
    assert.equal(messages.some((message) => message.kind === "terminal_event"), true);
    assert.equal(messages.some((message) => message.kind === "command_result"), true);
    const session = messages.find((message) => message.kind === "session_result")?.payload as {
      nativeSessionId?: string;
    };
    assert.equal(session.nativeSessionId, "thread-1");
    assert.equal(textDeltas(events).includes("Architect · Runtime host"), true);
    assert.equal(events.every((event) => event.commandRecordId === "record-command-1"), true);
  } finally {
    await executor.shutdown();
  }
});

test("a resumed turn applies the backend-authored changed thread name before inference", async () => {
  const executor = new CodexCommandExecutor({
    codexCommand: process.execPath,
    codexArgs: [fakeServer],
    sandboxMode: "read-only",
  });
  const events: RuntimeEvent[] = [];
  const value = packet("attempt-resume", "participant-1", "command-resume", "REPORT_THREAD_NAME");
  try {
    await executor.execute(command(value, {
      kind: "resume",
      nativeSessionId: "thread-existing",
      threadName: "Architect · Renamed chat",
    }), async (event) => { events.push(event); }, new AbortController().signal);
    assert.equal(textDeltas(events).includes("Architect · Renamed chat"), true);
    const session = workerMessages(events).find((message) => message.kind === "session_result")
      ?.payload as { nativeSessionId?: string };
    assert.equal(session.nativeSessionId, "thread-existing");
  } finally {
    await executor.shutdown();
  }
});

test("thread naming failure is a visible recoverable diagnostic and does not abort the turn", async () => {
  const diagnostics: string[] = [];
  const executor = new CodexCommandExecutor({
    codexCommand: process.execPath,
    codexArgs: [fakeServer],
    sandboxMode: "read-only",
    onLocalDiagnostic: (message) => {
      diagnostics.push(message);
      throw new Error("diagnostic sink unavailable");
    },
  });
  const events: RuntimeEvent[] = [];
  const value = packet("attempt-warning", "participant-1", "command-warning");
  try {
    await executor.execute(command(value, { threadName: "FAIL_RENAME" }),
      async (event) => { events.push(event); }, new AbortController().signal);
    assert.equal(executor.activeCount(), 0);
    assert.match(diagnostics[0] ?? "", /thread name could not be updated/i);
    const warning = workerMessages(events).find((message) => message.kind === "protocol_error")
      ?.payload as { code?: string; recoverable?: boolean };
    assert.equal(warning.code, "thread_name_update_failed");
    assert.equal(warning.recoverable, true);
    assert.equal(workerMessages(events).some((message) => message.kind === "terminal_event"), true);
  } finally {
    await executor.shutdown();
  }
});

test("atomic turn payload strictly requires only the backend-authored thread name", () => {
  const value = packet("attempt-strict", "participant-1", "command-strict");
  const missing = command(value);
  missing.payload = { ...asRecord(missing.payload), rawPayload: "{}" };
  assert.throws(() => atomicTurnPlan(missing));
  const extra = command(value);
  extra.payload = {
    ...asRecord(extra.payload),
    rawPayload: JSON.stringify({ threadName: "Persona · Chat", localGuess: "do not trust" }),
  };
  assert.throws(() => atomicTurnPlan(extra));
});

test("two durable Persona turns infer and stream concurrently in separate workers", async () => {
  const executor = new CodexCommandExecutor({
    codexCommand: process.execPath,
    codexArgs: [fakeServer],
    sandboxMode: "read-only",
  });
  const events: RuntimeEvent[] = [];
  const first = packet("attempt-1", "participant-1", "command-1");
  const second = packet("attempt-2", "participant-2", "command-2");
  try {
    const executions = [first, second].map((value) => executor.execute(
      command(value),
      async (event) => { events.push(event); },
      new AbortController().signal,
    ));
    await waitFor(() => executor.activeCount() === 2);
    await Promise.all(executions);
    assert.equal(executor.activeCount(), 0);
    const terminals = events.filter((event) => {
      const payload = event.payload as { kind?: string };
      return payload.kind === "terminal_event";
    });
    assert.deepEqual([...new Set(terminals.map((event) => event.attemptId))].sort(), [
      "attempt-1", "attempt-2",
    ]);
  } finally {
    await executor.shutdown();
  }
});

test("host wire sequence is owned locally and monotonically increases per attempt", () => {
  const sequencer = new HostWireSequencer(monotonicNow());
  const value = runtimePacket();
  const opening = sequencer.next("record-1", {
    kind: "start_session_request",
    payload: { placement: value.placement, packetSeed: value },
  });
  const turn = sequencer.next("record-1", {
    kind: "send_turn_request",
    payload: {
      sessionId: value.attemptId,
      commandId: value.command.commandId,
      packetHash: value.command.packetHash,
    },
  });
  assert.deepEqual([opening.sequence, turn.sequence], [0, 1]);
  assert.notEqual(opening.messageId, turn.messageId);
});

test("private publication calls leave a contiguous canonical stream through terminal settlement", async () => {
  let publications = 0;
  const events: RuntimeEvent[] = [];
  const executor = new CodexCommandExecutor({
    codexCommand: process.execPath,
    codexArgs: [fileURLToPath(new URL("./fixtures/fake_bridge_app_server.mjs", import.meta.url))],
    sandboxMode: "read-only",
    bridgeCall: async (request) => {
      assert.equal(request.tool, "nanthai_publish_result");
      publications++;
      return "Published";
    },
  });
  const value = packet("attempt-bridge", "participant-1", "command-bridge");
  value.capabilities.nanthaiTools = [{ id: "nanthai_publish_result", name: "Publish", version: "1", effect: "write", inputSchemaHash: createHash("sha256").update(JSON.stringify(BRIDGE_TOOLS[1]!.inputSchema)).digest("hex") }];
  value.command.packetHash = computePacketHash(value);
  try {
    await executor.execute(command(value), async (event) => {
      const message = event.payload as { kind: string; sequence: number };
      assert.equal(message.sequence, events.length, "canonical ingestion requires no sequence gaps");
      assert.notEqual(message.kind, "bridge_call", "publication arguments stay on the result endpoint");
      events.push(event);
    }, new AbortController().signal);
    assert.equal(publications, 1);
    assert.deepEqual(textDeltas(events), ["PUBLISHED"]);
    assert.equal(workerMessages(events).some((message) => message.kind === "terminal_event"), true);
    assert.equal(executor.activeCount(), 0);
  } finally {
    await executor.shutdown();
  }
});

function packet(
  attemptId: string,
  participantId: string,
  commandId: string,
  text = "Hello from NanthAI",
): LocalRuntimeTurnPacket {
  const base = structuredClone(runtimePacket([{ type: "text", partId: "part-1", text }]));
  const value = {
    ...base,
    runId: `run-${attemptId}`,
    attemptId,
    participantId,
    placement: { ...base.placement, runId: `run-${attemptId}`, attemptId },
    command: {
      ...base.command,
      commandId,
      idempotencyKey: `idempotency-${attemptId}`,
      cancellationId: `cancel-${attemptId}`,
    },
  } as LocalRuntimeTurnPacket;
  value.command.packetHash = computePacketHash(value);
  return LocalRuntimeTurnPacketSchema.parse(value) as LocalRuntimeTurnPacket;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected command payload record");
  }
  return value as Record<string, unknown>;
}

function command(
  value: LocalRuntimeTurnPacket,
  options: {
    kind?: "start" | "resume";
    nativeSessionId?: string;
    threadName?: string;
  } = {},
): RuntimeCommand {
  const kind = options.kind ?? "start";
  const threadName = options.threadName ?? "Persona · Chat";
  return {
    commandRecordId: `record-${value.command.commandId}`,
    commandId: value.command.commandId,
    runId: value.runId,
    attemptId: value.attemptId,
    fence: value.fence,
    kind,
    receivedAtMs: 1_786_752_000_000,
    payload: {
      type: kind,
      authorizationSource: "paired_device",
      inputHash: "transport-envelope-hash",
      rawPayload: JSON.stringify(kind === "resume" ? {
        nativeSessionId: options.nativeSessionId ?? "thread-existing",
        expectedNativeTurnId: "turn-owned",
        deliveredMessageIds: [],
        checkpointRef: null,
        threadName,
      } : { threadName }),
      turnPacketId: `packet-${value.attemptId}`,
      packet: value,
      packetSha256: value.command.packetHash,
      packetError: null,
    },
  };
}

function workerMessages(events: RuntimeEvent[]) {
  return events.map((event) => event.payload as { kind?: string; payload?: unknown });
}

function textDeltas(events: RuntimeEvent[]): string[] {
  return workerMessages(events).flatMap((message) => {
    if (message.kind !== "adapter_event") return [];
    const payload = message.payload as { event?: { type?: string; delta?: string } };
    return payload.event?.type === "text_delta" && payload.event.delta !== undefined
      ? [payload.event.delta] : [];
  });
}

function monotonicNow(): () => number {
  let value = 1_786_752_000_000;
  return () => value++;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Concurrent workers did not become active");
}
