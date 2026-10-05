import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  InMemoryControlPlane,
  type RuntimeCommand,
  type RuntimeEvent,
} from "../src/control_plane.ts";
import { HostStatusStore } from "../src/host_status_store.ts";
import { InMemoryOutboundSpool } from "../src/outbound_spool.ts";
import {
  ForegroundRuntimeHost,
  type RuntimeCommandExecutor,
} from "../src/runtime_host.ts";
import type { RuntimeModelDiscoveryExecutor } from "../src/runtime_model_discovery.ts";

test("foreground host executes independent attempts concurrently and drains its spool", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-runtime-host-"));
  const controlPlane = new InMemoryControlPlane();
  const spool = new InMemoryOutboundSpool();
  const executor = new ConcurrentFakeExecutor();
  const host = new ForegroundRuntimeHost(
    {
      deviceId: "device-1",
      credentialId: "credential-1",
      controlPlaneUrl: "https://example.test",
      credential: "secret",
    },
    controlPlane,
    spool,
    new HostStatusStore(join(directory, "status.json")),
    executor,
    {
      lockPath: join(directory, "host.lock"),
      hostVersion: "test",
      heartbeatIntervalMs: 5,
      adapters: [],
    },
  );
  try {
    const running = host.run();
    await waitFor(() => controlPlane.registrations.length === 1);
    controlPlane.enqueue(command("command-1", "attempt-1"));
    controlPlane.enqueue(command("command-2", "attempt-2"));
    controlPlane.endCommands();
    await running;

    assert.equal(executor.peakActive, 2);
    assert.deepEqual(controlPlane.published.map((event) => event.eventId).sort(), [
      "attempt-1:completed", "attempt-1:started",
      "attempt-2:completed", "attempt-2:started",
    ]);
    assert.deepEqual(controlPlane.completedCommands.map((item) => item.commandRecordId).sort(), [
      "record-command-1", "record-command-2",
    ]);
    assert.deepEqual(await spool.size(), { events: 0, bytes: 25 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("runtime host registers the explicit tray launch owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-runtime-owner-"));
  const controlPlane = new InMemoryControlPlane();
  const status = new HostStatusStore(join(directory, "status.json"));
  const host = new ForegroundRuntimeHost(
    {
      deviceId: "device-1", credentialId: "credential-1",
      controlPlaneUrl: "https://example.test", credential: "secret",
    },
    controlPlane,
    new InMemoryOutboundSpool(),
    status,
    new ConcurrentFakeExecutor(),
    {
      lockPath: join(directory, "host.lock"), owner: "tray",
      hostVersion: "test", heartbeatIntervalMs: 5, adapters: [],
    },
  );
  try {
    const running = host.run();
    await waitFor(() => controlPlane.registrations.length === 1);
    await waitFor(async () => (await status.read())?.rssBytes !== undefined);
    const snapshot = await status.read();
    assert.ok((snapshot?.rssBytes ?? 0) > 0);
    assert.ok((snapshot?.heapUsedBytes ?? 0) > 0);
    assert.equal(snapshot?.deviceId, "device-1");
    controlPlane.endCommands();
    await running;
    assert.equal(controlPlane.registrations[0]?.owner, "tray");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("foreground host settles a canonical turn after its terminal event is published", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-runtime-terminal-"));
  const controlPlane = new InMemoryControlPlane();
  const host = new ForegroundRuntimeHost(
    {
      deviceId: "device-1", credentialId: "credential-1",
      controlPlaneUrl: "https://example.test", credential: "secret",
    },
    controlPlane,
    new InMemoryOutboundSpool(),
    new HostStatusStore(join(directory, "status.json")),
    new TerminalFakeExecutor(),
    {
      lockPath: join(directory, "host.lock"), hostVersion: "test",
      heartbeatIntervalMs: 5, adapters: [],
    },
  );
  try {
    const running = host.run();
    await waitFor(() => controlPlane.registrations.length === 1);
    controlPlane.enqueue({ ...command("command-1", "attempt-1"), kind: "start" });
    controlPlane.endCommands();
    await running;
    assert.deepEqual(controlPlane.settledAttempts, [{
      attemptId: "attempt-1", fence: 1, outcome: "completed",
    }]);
    assert.deepEqual(controlPlane.completedCommands, [{
      commandRecordId: "record-command-1", status: "completed",
    }]);
    assert.deepEqual(controlPlane.operations, [
      "publish:terminal-1",
      "complete:record-command-1:completed",
      "settle:attempt-1:completed",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed model discovery stays isolated from a concurrent turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-runtime-discovery-"));
  const controlPlane = new InMemoryControlPlane();
  const executor = new GatedFakeExecutor();
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
      heartbeatIntervalMs: 5, adapters: [],
      modelDiscovery: new FailingModelDiscovery(),
    },
  );
  try {
    const running = host.run();
    await waitFor(() => controlPlane.registrations.length === 1);
    controlPlane.enqueue(command("command-1", "attempt-1"));
    await waitFor(() => executor.activeCount() === 1);
    controlPlane.enqueueModelDiscovery({
      requestId: "discovery-1", adapterId: "codex", expiresAt: Date.now() + 60_000,
    });
    await waitFor(() => controlPlane.modelDiscoveryCompletions.length === 1);

    assert.equal(executor.activeCount(), 1);
    assert.equal(controlPlane.modelDiscoveryCompletions[0]?.status, "failed");
    executor.release();
    await waitFor(() => executor.activeCount() === 0);
    controlPlane.endModelDiscoveryRequests();
    controlPlane.endCommands();
    await running;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

class ConcurrentFakeExecutor implements RuntimeCommandExecutor {
  active = 0;
  peakActive = 0;

  activeCount(): number {
    return this.active;
  }

  async execute(
    command: RuntimeCommand,
    emit: (event: RuntimeEvent) => Promise<void>,
  ): Promise<void> {
    this.active += 1;
    this.peakActive = Math.max(this.peakActive, this.active);
    await emit(runtimeEvent(command, "started"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await emit(runtimeEvent(command, "completed"));
    this.active -= 1;
  }

  async shutdown(): Promise<void> {}
}

class TerminalFakeExecutor implements RuntimeCommandExecutor {
  activeCount(): number { return 0; }

  async execute(
    commandValue: RuntimeCommand,
    emit: (event: RuntimeEvent) => Promise<void>,
  ): Promise<void> {
    await emit({
      eventId: "terminal-1",
      commandRecordId: commandValue.commandRecordId,
      commandId: commandValue.commandId,
      runId: commandValue.runId,
      attemptId: commandValue.attemptId,
      fence: commandValue.fence,
      kind: "worker_message",
      emittedAtMs: 1,
      payload: { kind: "terminal_event", payload: { event: { outcome: "completed" } } },
    });
  }

  async shutdown(): Promise<void> {}
}

class GatedFakeExecutor implements RuntimeCommandExecutor {
  private active = 0;
  private releaseTurn: () => void = () => undefined;
  private readonly released = new Promise<void>((resolve) => {
    this.releaseTurn = resolve;
  });

  activeCount(): number { return this.active; }

  async execute(
    commandValue: RuntimeCommand,
    emit: (event: RuntimeEvent) => Promise<void>,
  ): Promise<void> {
    this.active += 1;
    await emit(runtimeEvent(commandValue, "started"));
    await this.released;
    await emit(runtimeEvent(commandValue, "completed"));
    this.active -= 1;
  }

  release(): void { this.releaseTurn(); }

  async shutdown(): Promise<void> { this.release(); }
}

class FailingModelDiscovery implements RuntimeModelDiscoveryExecutor {
  async listModels(): Promise<never> {
    throw new Error("Codex account is signed out");
  }

  async shutdown(): Promise<void> {}
}

function command(commandId: string, attemptId: string): RuntimeCommand {
  return {
    commandRecordId: `record-${commandId}`,
    commandId,
    runId: `run-${attemptId}`,
    attemptId,
    fence: 1,
    kind: "test",
    receivedAtMs: 1,
    payload: null,
  };
}

function runtimeEvent(commandValue: RuntimeCommand, state: string): RuntimeEvent {
  return {
    eventId: `${commandValue.attemptId}:${state}`,
    commandRecordId: commandValue.commandRecordId,
    commandId: commandValue.commandId,
    runId: commandValue.runId,
    attemptId: commandValue.attemptId,
    fence: commandValue.fence,
    kind: "host_command_failed",
    emittedAtMs: 1,
    payload: null,
  };
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Condition was not met");
}
