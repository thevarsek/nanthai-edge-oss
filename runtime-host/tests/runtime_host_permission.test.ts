import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CodexCommandExecutor } from "../src/codex_command_executor.ts";
import {
  InMemoryControlPlane,
  type RuntimeCommand,
  type RuntimeEvent,
} from "../src/control_plane.ts";
import { HostStatusStore } from "../src/host_status_store.ts";
import { InMemoryOutboundSpool } from "../src/outbound_spool.ts";
import { computePacketHash } from "../src/packet_integrity.ts";
import {
  LocalRuntimeTurnPacketSchema,
  type AdapterEvent,
  type LocalRuntimeTurnPacket,
  type WorkerToHostMessage,
} from "../src/protocol.ts";
import { ForegroundRuntimeHost } from "../src/runtime_host.ts";
import { runtimePacket } from "./fixtures/runtime_packet.ts";

const fakeServer = fileURLToPath(
  new URL("./fixtures/fake_json_rpc_child.mjs", import.meta.url),
);

test("permission response stays on its claimed attempt and preserves host health", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-runtime-permission-"));
  const target = join(directory, "must-not-exist.txt");
  const harness = createHarness(directory);
  const running = harness.host.run();
  try {
    await waitFor(() => harness.controlPlane.registrations.length === 1);
    const opening = turn("attempt-1", "start-1", `APPROVAL TARGET=${target}`);
    harness.controlPlane.enqueue(opening.command);
    await waitFor(() => adapterEvent(harness.controlPlane.published, "permission_requested")
      !== null);
    await waitFor(() => harness.controlPlane.attemptHeartbeats.some(
      (heartbeat) => heartbeat.attemptId === opening.packet.attemptId,
    ));
    assert.equal(harness.executor.activeCount(), 1);
    assert.equal(harness.controlPlane.settledAttempts.length, 0);

    harness.controlPlane.enqueue(followup(opening.packet, "stale-1", "permission_response", {
      permissionRequestId: "not-pending",
      decision: "deny",
    }));
    await waitFor(() => commandStatus(harness.controlPlane, "record-stale-1") === "rejected");
    assert.equal(harness.executor.activeCount(), 1);
    assert.equal(harness.controlPlane.settledAttempts.length, 0);

    harness.controlPlane.enqueue(followup(opening.packet, "response-1", "permission_response", {
      permissionRequestId: "0",
      decision: "deny",
    }));
    await waitFor(() => harness.controlPlane.settledAttempts.some(
      (settled) => settled.attemptId === opening.packet.attemptId,
    ));

    const resolved = adapterEvent(harness.controlPlane.published, "permission_resolved");
    assert.ok(resolved !== null);
    assert.equal(resolved.runtime.commandRecordId, "record-response-1");
    assert.equal(resolved.runtime.commandId, "response-1");
    assert.equal(resolved.event.type === "permission_resolved"
      ? resolved.event.decision : null, "deny");
    assert.equal(await exists(target), false);
    assertTerminalOrder(harness.controlPlane, opening.command, "completed");

    harness.controlPlane.enqueue(followup(opening.packet, "late-1", "permission_response", {
      permissionRequestId: "0",
      decision: "deny",
    }));
    await waitFor(() => commandStatus(harness.controlPlane, "record-late-1") === "rejected");
    assert.equal(harness.controlPlane.settledAttempts.filter(
      (settled) => settled.attemptId === opening.packet.attemptId,
    ).length, 1);

    const probe = turn("attempt-2", "start-2", "HOST_HEALTH_PROBE");
    harness.controlPlane.enqueue(probe.command);
    await waitFor(() => harness.controlPlane.settledAttempts.some(
      (settled) => settled.attemptId === probe.packet.attemptId,
    ));
    assert.equal(commandStatus(harness.controlPlane, probe.command.commandRecordId), "completed");
    assert.equal(harness.controlPlane.settledAttempts.find(
      (settled) => settled.attemptId === probe.packet.attemptId,
    )?.outcome, "completed");

    harness.controlPlane.endCommands();
    await running;
  } finally {
    harness.host.requestStop();
    await running.catch(() => undefined);
    await harness.executor.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Stop cancels a production Codex turn while native permission is pending", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-runtime-permission-stop-"));
  const target = join(directory, "must-not-exist.txt");
  const harness = createHarness(directory);
  const running = harness.host.run();
  try {
    await waitFor(() => harness.controlPlane.registrations.length === 1);
    const opening = turn("attempt-stop", "start-stop", `APPROVAL TARGET=${target}`);
    harness.controlPlane.enqueue(opening.command);
    await waitFor(() => adapterEvent(harness.controlPlane.published, "permission_requested")
      !== null);
    await waitFor(() => harness.controlPlane.attemptHeartbeats.some(
      (heartbeat) => heartbeat.attemptId === opening.packet.attemptId,
    ));

    harness.controlPlane.enqueue(followup(opening.packet, "stop-1", "cancel", {
      cancellationId: opening.packet.command.cancellationId,
      reason: "User pressed Stop while approval was pending",
    }));
    await waitFor(() => harness.controlPlane.settledAttempts.some(
      (settled) => settled.attemptId === opening.packet.attemptId,
    ));

    assert.equal(commandStatus(harness.controlPlane, "record-stop-1"), "completed");
    assert.equal(await exists(target), false);
    assertTerminalOrder(harness.controlPlane, opening.command, "cancelled");
    harness.controlPlane.endCommands();
    await running;
  } finally {
    harness.host.requestStop();
    await running.catch(() => undefined);
    await harness.executor.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

function createHarness(directory: string) {
  const controlPlane = new InMemoryControlPlane();
  const executor = new CodexCommandExecutor({
    codexCommand: process.execPath,
    codexArgs: [fakeServer],
    sandboxMode: "read-only",
  });
  const host = new ForegroundRuntimeHost(
    {
      deviceId: "device-1", credentialId: "credential-1",
      controlPlaneUrl: "https://example.test", credential: "secret",
    },
    controlPlane,
    new InMemoryOutboundSpool(),
    new HostStatusStore(join(directory, "status.json")),
    executor,
    {
      lockPath: join(directory, "host.lock"), hostVersion: "test",
      heartbeatIntervalMs: 2, adapters: [],
    },
  );
  return { controlPlane, executor, host };
}

function turn(attemptId: string, commandId: string, text: string) {
  const base = structuredClone(runtimePacket([{ type: "text", partId: "part-1", text }]));
  const packet = {
    ...base,
    runId: `run-${attemptId}`,
    attemptId,
    placement: { ...base.placement, runId: `run-${attemptId}`, attemptId },
    command: {
      ...base.command,
      commandId,
      idempotencyKey: `idempotency-${attemptId}`,
      cancellationId: `cancel-${attemptId}`,
    },
  } as LocalRuntimeTurnPacket;
  packet.command.packetHash = computePacketHash(packet);
  const parsed = LocalRuntimeTurnPacketSchema.parse(packet) as LocalRuntimeTurnPacket;
  return { packet: parsed, command: openingCommand(parsed) };
}

function openingCommand(packet: LocalRuntimeTurnPacket): RuntimeCommand {
  return command(packet, packet.command.commandId, "start", JSON.stringify({
    threadName: "Test Persona · Permission test",
  }), packet);
}

function followup(
  packet: LocalRuntimeTurnPacket,
  commandId: string,
  kind: "cancel" | "permission_response",
  rawPayload: Record<string, unknown>,
): RuntimeCommand {
  return command(packet, commandId, kind, JSON.stringify(rawPayload), null);
}

function command(
  packet: LocalRuntimeTurnPacket,
  commandId: string,
  kind: "start" | "cancel" | "permission_response",
  rawPayload: string,
  includedPacket: LocalRuntimeTurnPacket | null,
): RuntimeCommand {
  return {
    commandRecordId: `record-${commandId}`,
    commandId,
    runId: packet.runId,
    attemptId: packet.attemptId,
    fence: packet.fence,
    kind,
    receivedAtMs: Date.now(),
    payload: {
      type: kind,
      authorizationSource: "paired_device",
      inputHash: `input-${commandId}`,
      rawPayload,
      turnPacketId: includedPacket === null ? null : `packet-${packet.attemptId}`,
      packet: includedPacket,
      packetSha256: includedPacket?.command.packetHash ?? null,
      packetError: null,
    },
  };
}

function adapterEvent(events: RuntimeEvent[], type: AdapterEvent["type"]): {
  runtime: RuntimeEvent;
  event: AdapterEvent;
} | null {
  for (const runtime of events) {
    if (runtime.kind !== "worker_message") continue;
    const message = runtime.payload as WorkerToHostMessage;
    if (message.kind === "adapter_event" && message.payload.event.type === type) {
      return { runtime, event: message.payload.event };
    }
  }
  return null;
}

function assertTerminalOrder(
  controlPlane: InMemoryControlPlane,
  opening: RuntimeCommand,
  outcome: "completed" | "cancelled",
): void {
  const terminal = controlPlane.published.find((event) => {
    if (event.attemptId !== opening.attemptId || event.kind !== "worker_message") return false;
    return (event.payload as WorkerToHostMessage).kind === "terminal_event";
  });
  assert.ok(terminal !== undefined);
  const published = controlPlane.operations.indexOf(`publish:${terminal.eventId}`);
  const completed = controlPlane.operations.indexOf(
    `complete:${opening.commandRecordId}:completed`,
  );
  const settled = controlPlane.operations.indexOf(`settle:${opening.attemptId}:${outcome}`);
  assert.ok(published >= 0 && published < completed && completed < settled);
  assert.equal(controlPlane.settledAttempts.find(
    (value) => value.attemptId === opening.attemptId,
  )?.outcome, outcome);
}

function commandStatus(
  controlPlane: InMemoryControlPlane,
  commandRecordId: string,
): "completed" | "rejected" | null {
  return controlPlane.completedCommands.find(
    (commandValue) => commandValue.commandRecordId === commandRecordId,
  )?.status ?? null;
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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Permission integration condition was not met");
}
