import { hostname } from "node:os";
import { abortableDelay } from "./abortable_delay.ts";
import type {
  ControlPlaneConnection,
  ControlPlaneTransport,
  DeviceCredential,
  HostHeartbeat,
  HostRegistration,
  RuntimeCommand,
  RuntimeEvent,
} from "./control_plane.ts";
import { HostLock } from "./host_lock.ts";
import { HostStatusStore, type HostStatus } from "./host_status_store.ts";
import type { OutboundSpool } from "./outbound_spool.ts";
import { RuntimeAttemptHeartbeats } from "./runtime_attempt_heartbeats.ts";
import {
  eventOutcome,
  isStreamingText,
  isTurnCommand,
  type AttemptOutcome,
} from "./runtime_event_outcome.ts";
import {
  runRuntimeModelDiscovery,
  type RuntimeModelDiscoveryExecutor,
} from "./runtime_model_discovery.ts";

export interface RuntimeCommandExecutor {
  execute(
    command: RuntimeCommand,
    emit: (event: RuntimeEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;
  activeCount(): number;
  shutdown(): Promise<void>;
}

export type RuntimeHostOptions = {
  lockPath: string;
  owner?: HostRegistration["owner"];
  hostVersion: string;
  heartbeatIntervalMs?: number;
  publishBatchSize?: number;
  now?: () => number;
  adapters: HostRegistration["adapters"];
  modelDiscovery?: RuntimeModelDiscoveryExecutor;
  onHeartbeat?: (signal: AbortSignal) => Promise<void>;
  onConnected?: (signal: AbortSignal) => Promise<void>;
};

export class ForegroundRuntimeHost {
  private readonly abort = new AbortController();
  private readonly activeCommands = new Set<Promise<void>>();
  private readonly activeAttempts = new RuntimeAttemptHeartbeats();
  private readonly now: () => number;
  private connection: ControlPlaneConnection | null = null;
  private flushTask: Promise<void> | null = null;
  private flushRequested = false;
  private lock: HostLock | null = null;
  private startedAtMs = 0;
  private commandFailure: unknown = null;

  constructor(
    private readonly credential: DeviceCredential,
    private readonly transport: ControlPlaneTransport,
    private readonly spool: OutboundSpool,
    private readonly statusStore: HostStatusStore,
    private readonly executor: RuntimeCommandExecutor,
    private readonly options: RuntimeHostOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  async run(signal?: AbortSignal): Promise<void> {
    this.startedAtMs = this.now();
    this.lock = await HostLock.acquire(
      this.options.lockPath,
      this.options.owner ?? "foreground_cli",
    );
    const onAbort = () => this.requestStop();
    signal?.addEventListener("abort", onAbort, { once: true });
    let heartbeat: Promise<void> | null = null;
    let discovery: Promise<void> | null = null;
    try {
      await this.writeStatus("starting", null);
      this.connection = await this.transport.connect(this.credential, this.registration());
      await this.writeStatus("online", null);
      heartbeat = this.heartbeatLoop();
      discovery = this.modelDiscoveryLoop();
      void heartbeat.catch((error: unknown) => this.failHost(error));
      void discovery.catch((error: unknown) => this.failHost(error));
      await this.flush();
      await this.options.onConnected?.(this.abort.signal);
      for await (const command of this.connection.commands()) {
        if (this.abort.signal.aborted) break;
        const task = this.execute(command);
        this.activeCommands.add(task);
        void task.then(
          () => this.activeCommands.delete(task),
          (error: unknown) => {
            this.activeCommands.delete(task);
            this.commandFailure ??= error;
            this.requestStop();
          },
        );
      }
      this.abort.abort();
      await heartbeat;
      await discovery;
      if (this.commandFailure !== null) throw this.commandFailure;
    } catch (error) {
      this.requestStop();
      await this.writeStatus("failed", publicError(error));
      throw error;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      await this.stop();
      await Promise.allSettled([heartbeat, discovery]);
    }
  }
  requestStop(): void {
    this.abort.abort();
    this.connection?.stopReceiving();
  }
  private modelDiscoveryLoop(): Promise<void> {
    if (this.connection === null || this.options.modelDiscovery === undefined) {
      return Promise.resolve();
    }
    return runRuntimeModelDiscovery(
      this.connection, this.options.modelDiscovery, this.abort.signal,
      (error) => this.failHost(error), this.now,
    );
  }
  private failHost(error: unknown): void {
    if (this.abort.signal.aborted) return;
    this.commandFailure ??= error;
    this.requestStop();
  }
  private async execute(command: RuntimeCommand): Promise<void> {
    let retained = false;
    let commandCompleted = false;
    let terminalOutcome: AttemptOutcome | null = null;
    try {
      this.activeAttempts.retain(command);
      retained = true;
      await this.executor.execute(
        command,
        async (event) => {
          const outcome = eventOutcome(event);
          terminalOutcome = outcome ?? terminalOutcome;
          if (outcome !== null) await this.activeAttempts.retire(command);
          await this.spool.enqueue(event);
          if (isStreamingText(event)) void this.flush().catch((error: unknown) => this.failHost(error));
          else await this.flush();
        },
        this.abort.signal,
      );
      if (isTurnCommand(command) && terminalOutcome === null) {
        throw new Error("Runtime turn ended without a canonical terminal event");
      }
      await this.connection?.completeCommand(command.commandRecordId, "completed");
      commandCompleted = true;
      if (terminalOutcome !== null) {
        await this.connection?.settleAttempt(command.attemptId, command.fence, terminalOutcome);
      }
    } catch (error) {
      if (commandCompleted) throw error;
      await this.spool.enqueue({
        eventId: `${command.commandId}:host-failure`,
        commandRecordId: command.commandRecordId,
        commandId: command.commandId,
        runId: command.runId,
        attemptId: command.attemptId,
        fence: command.fence,
        kind: "host_command_failed",
        emittedAtMs: this.now(),
        payload: { message: publicError(error) },
      });
      await this.flush();
      await this.connection?.completeCommand(
        command.commandRecordId,
        "rejected",
        publicError(error),
      );
      if (isTurnCommand(command)) {
        await this.connection?.settleAttempt(
          command.attemptId,
          command.fence,
          this.abort.signal.aborted ? "interrupted" : "failed",
          publicError(error),
        );
      }
    } finally {
      if (retained) this.activeAttempts.release(command);
      await this.writeStatus("online", null);
    }
  }
  private flush(): Promise<void> {
    this.flushRequested = true;
    if (this.flushTask !== null) return this.flushTask;
    this.flushTask = this.flushRequestedEvents().finally(() => { this.flushTask = null; });
    return this.flushTask;
  }

  private async flushRequestedEvents(): Promise<void> {
    while (this.flushRequested) {
      this.flushRequested = false;
      await this.flushAll();
    }
  }

  private async flushAll(): Promise<void> {
    const connection = this.connection;
    if (connection === null) return;
    for (;;) {
      const batch = await this.spool.peek(this.options.publishBatchSize ?? 50);
      if (batch.length === 0) return;
      const receipt = await connection.publish(batch);
      const batchIds = new Set(batch.map((event) => event.eventId));
      if (receipt.acceptedEventIds.some((eventId) => !batchIds.has(eventId))) {
        throw new Error("Control plane acknowledged an event outside the published batch");
      }
      if (receipt.acceptedEventIds.length === 0) {
        throw new Error("Control plane did not acknowledge any outbound events");
      }
      await this.spool.acknowledge(receipt.acceptedEventIds);
    }
  }

  private async heartbeatLoop(): Promise<void> {
    const intervalMs = this.options.heartbeatIntervalMs ?? 15_000;
    while (!this.abort.signal.aborted) {
      await this.connection?.heartbeat(await this.heartbeat());
      const connection = this.connection;
      if (connection !== null) await this.activeAttempts.heartbeat(connection);
      await this.writeStatus("online", null);
      await this.options.onHeartbeat?.(this.abort.signal);
      await abortableDelay(intervalMs, this.abort.signal, false);
    }
  }

  private async heartbeat(): Promise<HostHeartbeat> {
    const memory = process.memoryUsage();
    return {
      emittedAtMs: this.now(),
      activeAttempts: this.executor.activeCount(),
      queuedEvents: (await this.spool.size()).events,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    };
  }

  private async writeStatus(state: HostStatus["state"], lastError: string | null) {
    const queuedEvents = (await this.spool.size()).events;
    const memory = process.memoryUsage();
    await this.statusStore.write({
      pid: process.pid,
      owner: this.options.owner ?? "foreground_cli",
      state,
      deviceId: this.credential.deviceId,
      startedAtMs: this.startedAtMs,
      updatedAtMs: this.now(),
      activeAttempts: this.executor.activeCount(),
      queuedEvents,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      lastError,
    });
  }

  private registration(): HostRegistration {
    return {
      deviceId: this.credential.deviceId,
      owner: this.options.owner ?? "foreground_cli",
      hostVersion: this.options.hostVersion,
      hostname: hostname(),
      platform: process.platform,
      architecture: process.arch,
      adapters: this.options.adapters,
    };
  }

  private async stop(): Promise<void> {
    this.abort.abort();
    await this.writeStatus("stopping", null).catch(() => undefined);
    const failures: unknown[] = [];
    const executionStopped = await this.executor.shutdown().then(
      () => this.executor.activeCount() === 0,
      (error: unknown) => { failures.push(error); return false; },
    );
    await this.options.modelDiscovery?.shutdown()
      .catch((error: unknown) => failures.push(error));
    await Promise.allSettled([...this.activeCommands]);
    await this.flushTask?.catch((error: unknown) => failures.push(error));
    await this.connection?.close({ executionStopped }).catch((error: unknown) => failures.push(error));
    await this.statusStore.removeIfOwnedBy(process.pid)
      .catch((error: unknown) => failures.push(error));
    await this.lock?.release().catch((error: unknown) => failures.push(error));
    if (failures[0] !== undefined) throw failures[0];
  }
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : "Runtime Host command failed";
}
