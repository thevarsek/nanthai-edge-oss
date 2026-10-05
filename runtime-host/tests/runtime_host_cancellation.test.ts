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
import { eventOutcome } from "../src/runtime_event_outcome.ts";
import {
  ForegroundRuntimeHost,
  type RuntimeCommandExecutor,
} from "../src/runtime_host.ts";

test("terminal cancellation cannot race its in-flight attempt heartbeat", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-runtime-cancel-heartbeat-"));
  const controlPlane = new CancellationHeartbeatControlPlane();
  const executor = new CancellationExecutor();
  const host = createHost(directory, controlPlane, executor);
  try {
    const running = host.run();
    await waitFor(() => controlPlane.registrations.length === 1);
    controlPlane.enqueue(command("start-1", "attempt-1", "start"));
    await boundedWait(executor.startReady.promise, "start command readiness");
    await boundedWait(controlPlane.heartbeatStarted.promise, "attempt heartbeat");

    controlPlane.enqueue(command("cancel-1", "attempt-1", "cancel"));
    await boundedWait(executor.cancelAttempted.promise, "cancellation dispatch");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(controlPlane.terminalPublished, false);

    controlPlane.releaseHeartbeat.resolve();
    await waitFor(() => controlPlane.completedCommands.length === 2);
    controlPlane.enqueue(command("probe-1", "attempt-2", "test"));
    await waitFor(() => controlPlane.completedCommands.length === 3);
    controlPlane.endCommands();
    await running;

    assert.equal(executor.executed.includes("probe-1"), true);
    assert.equal(controlPlane.terminalPublished, true);
    assert.equal(controlPlane.settledAttempts[0]?.outcome, "cancelled");
  } finally {
    await executor.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a nonterminal attempt heartbeat failure remains a host failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nanthai-runtime-heartbeat-failure-"));
  const controlPlane = new FailingHeartbeatControlPlane();
  const executor = new AbortAwareExecutor();
  const host = createHost(directory, controlPlane, executor);
  try {
    const running = host.run();
    await waitFor(() => controlPlane.registrations.length === 1);
    controlPlane.enqueue(command("work-1", "attempt-1", "test"));
    await executor.started.promise;
    const timeout = setTimeout(() => controlPlane.endCommands(), 1_000);
    try {
      await assert.rejects(running, /lease backend unavailable/);
    } finally {
      clearTimeout(timeout);
    }
  } finally {
    await executor.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

class CancellationHeartbeatControlPlane extends InMemoryControlPlane {
  readonly heartbeatStarted = deferred();
  readonly releaseHeartbeat = deferred();
  terminalPublished = false;
  private heartbeatPending = false;

  override async heartbeatAttempt(attemptId: string, fence: number): Promise<number> {
    if (attemptId !== "attempt-1" || this.heartbeatStarted.settled()) {
      return await super.heartbeatAttempt(attemptId, fence);
    }
    this.heartbeatPending = true;
    this.heartbeatStarted.resolve();
    await this.releaseHeartbeat.promise;
    this.heartbeatPending = false;
    if (this.terminalPublished) throw new Error("heartbeat raced terminal state");
    return await super.heartbeatAttempt(attemptId, fence);
  }

  override async publish(events: readonly RuntimeEvent[]) {
    if (events.some((event) => eventOutcome(event) !== null)) {
      this.terminalPublished = true;
      if (this.heartbeatPending) this.releaseHeartbeat.reject(
        new Error("heartbeat raced terminal state"),
      );
    }
    return await super.publish(events);
  }
}

class FailingHeartbeatControlPlane extends InMemoryControlPlane {
  override async heartbeatAttempt(): Promise<number> {
    throw new Error("lease backend unavailable");
  }
}

class CancellationExecutor implements RuntimeCommandExecutor {
  readonly startReady = deferred();
  readonly cancelAttempted = deferred();
  readonly executed: string[] = [];
  private readonly startFinished = deferred();
  private startCommand: RuntimeCommand | null = null;
  private startEmit: ((event: RuntimeEvent) => Promise<void>) | null = null;

  activeCount(): number { return this.startCommand === null ? 0 : 1; }

  async execute(commandValue: RuntimeCommand, emit: (event: RuntimeEvent) => Promise<void>) {
    this.executed.push(commandValue.commandId);
    if (commandValue.kind === "start") {
      this.startCommand = commandValue;
      this.startEmit = emit;
      this.startReady.resolve();
      await this.startFinished.promise;
      this.startCommand = null;
      this.startEmit = null;
      return;
    }
    if (commandValue.kind !== "cancel") return;
    await this.startReady.promise;
    this.cancelAttempted.resolve();
    try {
      await this.startEmit?.(cancelledTerminal(requireValue(this.startCommand)));
    } finally {
      this.startFinished.resolve();
    }
  }

  async shutdown(): Promise<void> { this.startFinished.resolve(); }
}

class AbortAwareExecutor implements RuntimeCommandExecutor {
  readonly started = deferred();
  activeCount(): number { return 1; }

  async execute(
    _command: RuntimeCommand,
    _emit: (event: RuntimeEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    this.started.resolve();
    if (signal.aborted) return;
    await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), {
      once: true,
    }));
  }

  async shutdown(): Promise<void> {}
}

function createHost(
  directory: string,
  controlPlane: InMemoryControlPlane,
  executor: RuntimeCommandExecutor,
): ForegroundRuntimeHost {
  return new ForegroundRuntimeHost(
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
      heartbeatIntervalMs: 1, adapters: [],
    },
  );
}

function command(commandId: string, attemptId: string, kind: string): RuntimeCommand {
  return {
    commandRecordId: `record-${commandId}`,
    commandId,
    runId: `run-${attemptId}`,
    attemptId,
    fence: 1,
    kind,
    receivedAtMs: 1,
    payload: null,
  };
}

function cancelledTerminal(commandValue: RuntimeCommand): RuntimeEvent {
  return {
    eventId: `${commandValue.commandId}:terminal`,
    commandRecordId: commandValue.commandRecordId,
    commandId: commandValue.commandId,
    runId: commandValue.runId,
    attemptId: commandValue.attemptId,
    fence: commandValue.fence,
    kind: "worker_message",
    emittedAtMs: 1,
    payload: { kind: "terminal_event", payload: { event: { outcome: "cancelled" } } },
  };
}

function deferred() {
  let resolve = () => undefined;
  let reject = (_error: Error) => undefined;
  let isSettled = false;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = () => { isSettled = true; resolvePromise(); };
    reject = (error) => { isSettled = true; rejectPromise(error); };
  });
  return { promise, resolve, reject, settled: () => isSettled };
}

function requireValue<T>(value: T | null): T {
  if (value === null) throw new Error("Expected a started cancellation attempt");
  return value;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Condition was not met");
}

async function boundedWait(promise: Promise<void>, label: string): Promise<void> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      promise,
      new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 2_000);
      }),
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}
