import { AsyncEventQueue } from "./async_event_queue.ts";
import type {
  AdapterCapabilities,
  AdapterModelDescriptor,
} from "./protocol.ts";

export type DeviceCredential = {
  deviceId: string;
  credentialId: string;
  controlPlaneUrl: string;
  credential: string;
};

export type HostRegistration = {
  deviceId: string;
  owner: "foreground_cli" | "tray";
  hostVersion: string;
  hostname: string;
  platform: NodeJS.Platform;
  architecture: string;
  adapters: readonly HostAdapterPresence[];
};

export type HostAdapterPresence = {
  adapterId: string;
  adapterVersion: string;
  authState: "ready" | "signed_out" | "unavailable";
  capabilities: AdapterCapabilities;
};

export type RuntimeCommand = {
  commandRecordId: string;
  commandId: string;
  runId: string;
  attemptId: string;
  fence: number;
  kind: string;
  receivedAtMs: number;
  payload: unknown;
};

export type RuntimeEvent = {
  eventId: string;
  commandRecordId: string;
  commandId: string;
  runId: string;
  attemptId: string;
  fence: number;
  kind: "worker_message" | "host_command_failed";
  emittedAtMs: number;
  payload: unknown;
};

export type HostHeartbeat = {
  emittedAtMs: number;
  activeAttempts: number;
  queuedEvents: number;
  rssBytes: number;
  heapUsedBytes: number;
};

export type PublishReceipt = { acceptedEventIds: readonly string[] };

export type RuntimeModelDiscoveryRequest = {
  requestId: string;
  adapterId: string;
  expiresAt: number;
};

export type RuntimeModelDiscoveryCompletion =
  | {
    requestId: string;
    status: "completed";
    models: readonly AdapterModelDescriptor[];
  }
  | {
    requestId: string;
    status: "failed";
    errorCode: string;
    errorMessage: string;
  };

export interface ControlPlaneConnection {
  stopReceiving(): void;
  commands(): AsyncIterable<RuntimeCommand>;
  modelDiscoveryRequests(): AsyncIterable<RuntimeModelDiscoveryRequest>;
  publish(events: readonly RuntimeEvent[]): Promise<PublishReceipt>;
  completeModelDiscovery(result: RuntimeModelDiscoveryCompletion): Promise<void>;
  heartbeat(summary: HostHeartbeat): Promise<void>;
  completeCommand(
    commandRecordId: string,
    status: "completed" | "rejected",
    rejectionReason?: string,
  ): Promise<void>;
  heartbeatAttempt(attemptId: string, fence: number): Promise<number>;
  settleAttempt(
    attemptId: string,
    fence: number,
    outcome: "completed" | "failed" | "cancelled" | "interrupted",
    summary?: string,
  ): Promise<void>;
  close(options?: { executionStopped: boolean }): Promise<void>;
}

export interface ControlPlaneTransport {
  connect(
    credential: DeviceCredential,
    registration: HostRegistration,
  ): Promise<ControlPlaneConnection>;
}

export type PairingRequest = {
  controlPlaneUrl?: string;
  oneTimeCode: string;
  hostname: string;
  platform: NodeJS.Platform;
  architecture: string;
} & ({ pairingId: string; shortCode?: never } | { pairingId?: never; shortCode: true });

export interface PairingClient {
  pair(request: PairingRequest): Promise<DeviceCredential>;
}

export class InMemoryControlPlane implements ControlPlaneTransport, ControlPlaneConnection {
  readonly published: RuntimeEvent[] = [];
  readonly heartbeats: HostHeartbeat[] = [];
  readonly registrations: HostRegistration[] = [];
  readonly operations: string[] = [];
  readonly completedCommands: Array<{
    commandRecordId: string;
    status: "completed" | "rejected";
    rejectionReason?: string;
  }> = [];
  readonly attemptHeartbeats: Array<{ attemptId: string; fence: number }> = [];
  readonly settledAttempts: Array<{
    attemptId: string;
    fence: number;
    outcome: "completed" | "failed" | "cancelled" | "interrupted";
    summary?: string;
  }> = [];
  readonly modelDiscoveryCompletions: RuntimeModelDiscoveryCompletion[] = [];
  private readonly incoming = new AsyncEventQueue<RuntimeCommand>({
    maxItems: 512,
    maxBytes: 4 * 1024 * 1024,
  });
  private readonly incomingModelDiscovery = new AsyncEventQueue<RuntimeModelDiscoveryRequest>({
    maxItems: 10,
    maxBytes: 4 * 1024 * 1024,
  });
  private connected = false;

  async connect(
    _credential: DeviceCredential,
    registration: HostRegistration,
  ): Promise<ControlPlaneConnection> {
    if (this.connected) throw new Error("Fake control plane already has a host connection");
    this.connected = true;
    this.registrations.push(registration);
    return this;
  }

  commands(): AsyncIterable<RuntimeCommand> {
    return this.incoming;
  }

  modelDiscoveryRequests(): AsyncIterable<RuntimeModelDiscoveryRequest> {
    return this.incomingModelDiscovery;
  }

  enqueue(command: RuntimeCommand): void {
    this.incoming.push(command);
  }

  endCommands(): void {
    this.incoming.end();
  }

  enqueueModelDiscovery(request: RuntimeModelDiscoveryRequest): void {
    this.incomingModelDiscovery.push(request);
  }

  endModelDiscoveryRequests(): void {
    this.incomingModelDiscovery.end();
  }

  async publish(events: readonly RuntimeEvent[]): Promise<PublishReceipt> {
    this.published.push(...events);
    this.operations.push(...events.map((event) => `publish:${event.eventId}`));
    return { acceptedEventIds: events.map((event) => event.eventId) };
  }

  async completeModelDiscovery(result: RuntimeModelDiscoveryCompletion): Promise<void> {
    this.modelDiscoveryCompletions.push(result);
  }

  async heartbeat(summary: HostHeartbeat): Promise<void> {
    this.heartbeats.push(summary);
  }

  async completeCommand(
    commandRecordId: string,
    status: "completed" | "rejected",
    rejectionReason?: string,
  ): Promise<void> {
    this.operations.push(`complete:${commandRecordId}:${status}`);
    this.completedCommands.push({
      commandRecordId,
      status,
      ...(rejectionReason === undefined ? {} : { rejectionReason }),
    });
  }

  async heartbeatAttempt(attemptId: string, fence: number): Promise<number> {
    this.attemptHeartbeats.push({ attemptId, fence });
    return Date.now() + 60_000;
  }

  async settleAttempt(
    attemptId: string,
    fence: number,
    outcome: "completed" | "failed" | "cancelled" | "interrupted",
    summary?: string,
  ): Promise<void> {
    this.operations.push(`settle:${attemptId}:${outcome}`);
    this.settledAttempts.push({
      attemptId,
      fence,
      outcome,
      ...(summary === undefined ? {} : { summary }),
    });
  }

  async close(): Promise<void> {
    this.connected = false;
    this.stopReceiving();
  }

  stopReceiving(): void {
    this.incoming.end();
    this.incomingModelDiscovery.end();
  }
}
