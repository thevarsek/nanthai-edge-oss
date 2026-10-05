import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  AdapterCapabilitiesSchema,
  AdapterEventSchema,
} from "../runtime_host/protocol_adapter";
import {
  PairingClaimSchema,
  PairingGrantSchema,
  PairingInitiationSchema,
  PairingRevocationSchema,
  RuntimePresenceSchema,
} from "../runtime_host/protocol_pairing";
import {
  HostToWorkerMessageSchema,
  ProcessWireMessageSchema,
  WorkerToHostMessageSchema,
} from "../runtime_host/protocol_process";
import { sendTurnReferencesPacketSeed } from "../runtime_host/protocol_process_seed";
import { RuntimeTurnPacketSchema } from "../runtime_host/protocol_packet";

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(
    new URL(`../../fixtures/m45/${name}`, import.meta.url),
    "utf8",
  ));
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected fixture object");
  }
  return value as Record<string, unknown>;
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected fixture array");
  return value;
}

function envelope(kind: string, payload: unknown, sequence = 0) {
  return {
    wireVersion: "nanthai.runtime.process.v1",
    messageId: `wire-${kind}-${sequence}`,
    sequence,
    sentAt: 1786752000000 + sequence,
    kind,
    payload,
  };
}

const localPacket = RuntimeTurnPacketSchema.parse(fixture("runtime-turn-local-v1.json"));
const cloudPacket = RuntimeTurnPacketSchema.parse(fixture("runtime-turn-cloud-bare-model-v1.json"));
const capabilities = AdapterCapabilitiesSchema.parse(fixture("adapter-capabilities-v1.json"));
const events = list(fixture("adapter-events-v1.json"))
  .map((event) => AdapterEventSchema.parse(event));

test("host-to-worker wire covers every adapter control operation", () => {
  const messages = [
    envelope("probe_request", {}, 0),
    envelope("list_models_request", {}, 1),
    envelope("start_session_request", {
      placement: localPacket.placement,
      packetSeed: localPacket,
    }, 2),
    envelope("send_turn_request", {
      sessionId: "session-1",
      commandId: localPacket.command.commandId,
      packetHash: localPacket.command.packetHash,
    }, 3),
    envelope("cancel_request", {
      sessionId: "session-1",
      cancellationId: "cancel-run-local-1",
      reason: "User cancelled",
    }, 4),
    envelope("permission_response_request", {
      sessionId: "session-1",
      permissionRequestId: "permission-1",
      decision: "allow_once",
    }, 5),
    envelope("input_response_request", {
      sessionId: "session-1",
      inputRequestId: "input-1",
      response: { outcome: "submitted", content: { region: "eu-west", note: "" } },
    }, 6),
    envelope("resume_request", {
      placement: localPacket.placement,
      packetSeed: localPacket,
      nativeSessionId: "codex-thread-1",
      checkpointRef: "checkpoint-1",
    }, 7),
    envelope("close_request", { sessionId: "session-1", reason: "Turn complete" }, 8),
  ];
  for (const message of messages) HostToWorkerMessageSchema.parse(message);
});

test("first turn can reference only the immutable session packet seed", () => {
  const start = HostToWorkerMessageSchema.parse(envelope("start_session_request", {
    placement: localPacket.placement,
    packetSeed: localPacket,
  }));
  const send = HostToWorkerMessageSchema.parse(envelope("send_turn_request", {
    sessionId: "session-1",
    commandId: localPacket.command.commandId,
    packetHash: localPacket.command.packetHash,
  }, 1));
  assert.ok(start.kind === "start_session_request");
  assert.ok(send.kind === "send_turn_request");
  assert.equal(sendTurnReferencesPacketSeed(start, send), true);

  const mismatch = HostToWorkerMessageSchema.parse(envelope("send_turn_request", {
    sessionId: "session-1",
    commandId: localPacket.command.commandId,
    packetHash: "9999999999999999999999999999999999999999999999999999999999999999",
  }, 2));
  assert.ok(mismatch.kind === "send_turn_request");
  assert.equal(sendTurnReferencesPacketSeed(start, mismatch), false);
});

test("worker-to-host wire covers readiness, results, events, terminal, and errors", () => {
  const model = {
    provider: "openai",
    modelId: "gpt-5.6-codex",
    displayName: "GPT-5.6 Codex",
    availability: "available",
    unavailableReason: null,
    inputModalities: capabilities.inputModalities,
    supportsTools: true,
    supportsReasoning: true,
  };
  const nonTerminal = events.find((event) => event.type === "session_started");
  const terminal = events.find((event) => event.type === "terminal");
  assert.ok(nonTerminal && terminal);
  const messages = [
    envelope("worker_ready", { workerId: "worker-1", processId: 1234, capabilities }, 0),
    envelope("probe_result", {
      requestMessageId: "wire-probe_request-0",
      healthy: true,
      authState: "ready",
      summary: "Adapter is ready",
    }, 1),
    envelope("models_result", { requestMessageId: "wire-models", models: [model] }, 2),
    envelope("session_result", {
      requestMessageId: "wire-start",
      sessionId: "session-1",
      nativeSessionId: "codex-thread-1",
      resumed: false,
    }, 3),
    envelope("command_result", {
      requestMessageId: "wire-command",
      status: "accepted",
      code: null,
      summary: "Command accepted",
    }, 4),
    envelope("adapter_event", { sessionId: "session-1", event: nonTerminal }, 5),
    envelope("terminal_event", { sessionId: "session-1", event: terminal }, 6),
    envelope("protocol_error", {
      requestMessageId: null,
      code: "INVALID_MESSAGE",
      message: "Malformed worker message",
      recoverable: false,
    }, 7),
  ];
  for (const message of messages) {
    const parsed = WorkerToHostMessageSchema.parse(message);
    ProcessWireMessageSchema.parse(JSON.parse(JSON.stringify(parsed)));
  }
});

test("SDK session result stays truthful until thread.started supplies native ID", () => {
  const sessionResults = list(fixture("session-results-v1.json"))
    .map((message) => WorkerToHostMessageSchema.parse(message));
  assert.equal(sessionResults[0].kind, "session_result");
  assert.equal(sessionResults[1].kind, "session_result");
  if (sessionResults[0].kind !== "session_result"
    || sessionResults[1].kind !== "session_result") return;
  assert.equal(sessionResults[0].payload.nativeSessionId, null);
  assert.equal(sessionResults[1].payload.nativeSessionId, "codex-thread-1");

  const started = events.find((event) => event.type === "session_started");
  assert.ok(started && started.type === "session_started");
  assert.equal(started.nativeSessionId, "codex-thread-1");
});

test("Runtime Host process messages reject cloud placement and unknown keys", () => {
  const cloudStart = envelope("start_session_request", {
    placement: cloudPacket.placement,
    packetSeed: cloudPacket,
  });
  assert.equal(HostToWorkerMessageSchema.safeParse(cloudStart).success, false);

  const divergentTurn = envelope("send_turn_request", {
    sessionId: "session-1",
    packet: cloudPacket,
  });
  assert.equal(HostToWorkerMessageSchema.safeParse(divergentTurn).success, false);

  const extra = envelope("probe_request", {});
  assert.equal(ProcessWireMessageSchema.safeParse({
    ...extra,
    unversioned: true,
  }).success, false);
});

test("process control fixture remains strict JSON wire data", () => {
  const messages = list(fixture("process-wire-control-v1.json"));
  for (const message of messages) {
    const parsed = ProcessWireMessageSchema.parse(message);
    assert.deepEqual(JSON.parse(JSON.stringify(parsed)), parsed);
  }
});

test("pairing separates one-time and durable secrets from ephemeral presence", () => {
  const pairing = record(fixture("pairing-v1.json"));
  const initiation = PairingInitiationSchema.parse(pairing.initiation);
  PairingClaimSchema.parse(pairing.claim);
  const grant = PairingGrantSchema.parse(pairing.grant);
  const presence = RuntimePresenceSchema.parse({
    ...record(pairing.presence),
    adapters: [{
      adapterId: capabilities.adapterId,
      adapterVersion: capabilities.adapterVersion,
      authState: "ready",
      capabilities,
    }],
  });
  PairingRevocationSchema.parse(pairing.revocation);

  const presenceJson = JSON.stringify(presence);
  assert.equal(presenceJson.includes(grant.credential), false);
  assert.equal(presenceJson.includes(initiation.oneTimeCode), false);
});

test("pairing schemas reject unversioned extensions", () => {
  const pairing = record(fixture("pairing-v1.json"));
  const claim = record(pairing.claim);
  assert.equal(PairingClaimSchema.safeParse({
    ...claim,
    cloudFallback: true,
  }).success, false);
});
