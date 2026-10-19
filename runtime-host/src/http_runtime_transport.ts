import { randomUUID } from "node:crypto";
import { release } from "node:os";
import { abortableDelay } from "./abortable_delay.ts";

import type {
  ControlPlaneConnection,
  ControlPlaneTransport,
  DeviceCredential,
  HostHeartbeat,
  HostRegistration,
  PublishReceipt,
  RuntimeCommand,
  RuntimeEvent,
  RuntimeModelDiscoveryCompletion,
  RuntimeModelDiscoveryRequest,
} from "./control_plane.ts";
import {
  openPendingWorkWatch,
  type CreatePendingWorkSource,
} from "./convex_pending_work_source.ts";
import { fetchClaimedPayload } from "./http_command_payload.ts";
import { completeModelDiscovery, pollModelDiscovery } from "./http_model_discovery.ts";
import { runtimeArchitecture, runtimeOperatingSystem } from "./host_platform.ts";
import {
  HttpJsonClient,
  type FetchImplementation,
} from "./http_json_client.ts";
import {
  AttemptHeartbeatResponseSchema,
  AttemptSettleResponseSchema,
  ClaimResponseSchema,
  CompleteResponseSchema,
  EventsResponseSchema,
  PAIRING_PROTOCOL_VERSION,
  PollResponseSchema,
  PresenceResponseSchema,
  RawRuntimeEventSchema,
  type RemoteCommand,
} from "./http_runtime_contract.ts";
import {
  fixedIntervalWaiter,
  type PendingWorkWatch,
  type PollWaiter,
} from "./pending_work_watch.ts";

export type HttpRuntimeTransportOptions = {
  fetch?: FetchImplementation;
  now?: () => number;
  pollIntervalMs?: number;
  operatingSystemRelease?: () => string;
  createPresenceSessionId?: () => string;
  delay?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  /** Push wake-ups over the Convex WebSocket; omitted means timed polling only. */
  pendingWorkSource?: CreatePendingWorkSource;
};

export class HttpRuntimeControlPlane implements ControlPlaneTransport {
  constructor(private readonly options: HttpRuntimeTransportOptions = {}) {}

  async connect(
    credential: DeviceCredential,
    registration: HostRegistration,
  ): Promise<ControlPlaneConnection> {
    if (credential.deviceId !== registration.deviceId) {
      throw new Error("Runtime Host registration does not match its device credential");
    }
    const connection = new HttpRuntimeConnection(credential, registration, this.options);
    await connection.initialize();
    return connection;
  }
}

class HttpRuntimeConnection implements ControlPlaneConnection {
  private readonly client: HttpJsonClient;
  private readonly abort = new AbortController();
  private readonly receiving = new AbortController();
  private readonly now: () => number;
  private readonly pollIntervalMs: number;
  private readonly presenceSessionId: string;
  private readonly connectedAt: number;
  private readonly platform: {
    operatingSystem: "macos" | "windows" | "linux";
    architecture: "arm64" | "x64";
    release: string;
  };
  private readonly delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly pendingWorkSource: CreatePendingWorkSource | undefined;
  private closeTask: Promise<void> | null = null;
  private watch: PendingWorkWatch | null = null;
  private commandWaiter: PollWaiter;
  private discoveryWaiter: PollWaiter;

  constructor(
    private readonly credential: DeviceCredential,
    private readonly registration: HostRegistration,
    options: HttpRuntimeTransportOptions,
  ) {
    this.client = new HttpJsonClient(credential.controlPlaneUrl, {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
    this.now = options.now ?? Date.now;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.presenceSessionId = (options.createPresenceSessionId ?? randomUUID)();
    this.connectedAt = this.now();
    this.delay = options.delay ?? abortableDelay;
    this.pendingWorkSource = options.pendingWorkSource;
    this.commandWaiter = fixedIntervalWaiter(this.pollIntervalMs, this.delay);
    this.discoveryWaiter = this.commandWaiter;
    this.platform = {
      operatingSystem: runtimeOperatingSystem(registration.platform),
      architecture: runtimeArchitecture(registration.architecture),
      release: (options.operatingSystemRelease ?? release)(),
    };
  }

  async initialize(): Promise<void> {
    await this.postPresence();
    const createSource = this.pendingWorkSource;
    if (createSource === undefined) return;
    this.watch = await openPendingWorkWatch(this.client, this.credential.controlPlaneUrl, {
      deviceId: this.credential.deviceId,
      credentialId: this.credential.credentialId,
      credential: this.credential.credential,
      presenceSessionId: this.presenceSessionId,
    }, createSource, this.abort.signal);
    if (this.watch === null) return;
    const fallback = fixedIntervalWaiter(this.pollIntervalMs, this.delay);
    this.commandWaiter = this.watch.waiter("commands", fallback, this.pollIntervalMs);
    this.discoveryWaiter = this.watch.waiter("modelDiscovery", fallback, this.pollIntervalMs);
  }

  async *commands(): AsyncIterable<RuntimeCommand> {
    while (!this.receiving.signal.aborted) {
      const ticket = this.commandWaiter.begin();
      try {
        const response = await this.client.post(
          "/runtime-host/v1/commands/poll",
          {},
          PollResponseSchema,
          this.authHeaders(),
          this.receiving.signal,
        );
        for (const command of response.commands) {
          if (this.receiving.signal.aborted) return;
          const claim = await this.client.post(
            "/runtime-host/v1/commands/claim",
            { commandRecordId: command.commandRecordId },
            ClaimResponseSchema,
            this.authHeaders(),
            this.receiving.signal,
          );
          if (!claim.claimed) continue;
          yield await this.claimedCommand(command);
        }
        await this.commandWaiter.wait(ticket, this.receiving.signal);
      } catch (error) {
        if (this.receiving.signal.aborted) return;
        throw error;
      }
    }
  }

  async publish(events: readonly RuntimeEvent[]): Promise<PublishReceipt> {
    if (events.length === 0) return { acceptedEventIds: [] };
    if (events.length > 100) throw new Error("Runtime event batch exceeds the v1 bound");
    const validated = events.map((event) => RawRuntimeEventSchema.parse(event));
    return await this.client.post(
      "/runtime-host/v1/events",
      { events: validated },
      EventsResponseSchema,
      this.authHeaders(),
      this.abort.signal,
    );
  }

  modelDiscoveryRequests(): AsyncIterable<RuntimeModelDiscoveryRequest> {
    return pollModelDiscovery(
      this.client, this.authHeaders(), this.receiving.signal, this.discoveryWaiter,
    );
  }

  async completeModelDiscovery(result: RuntimeModelDiscoveryCompletion): Promise<void> {
    await completeModelDiscovery(this.client, this.authHeaders(), this.abort.signal, result);
  }

  async heartbeat(_summary: HostHeartbeat): Promise<void> {
    await this.postPresence();
  }

  async completeCommand(
    commandRecordId: string,
    status: "completed" | "rejected",
    rejectionReason?: string,
  ): Promise<void> {
    await this.client.post(
      "/runtime-host/v1/commands/complete",
      {
        commandRecordId,
        status,
        ...(rejectionReason === undefined ? {} : { rejectionReason }),
      },
      CompleteResponseSchema,
      this.authHeaders(),
      this.abort.signal,
    );
  }

  async heartbeatAttempt(attemptId: string, fence: number): Promise<number> {
    const response = await this.client.post(
      "/runtime-host/v1/attempts/heartbeat",
      { attemptId, fence },
      AttemptHeartbeatResponseSchema,
      this.authHeaders(),
      this.abort.signal,
    );
    return response.leaseExpiresAt;
  }

  async settleAttempt(
    attemptId: string,
    fence: number,
    outcome: "completed" | "failed" | "cancelled" | "interrupted",
    summary?: string,
  ): Promise<void> {
    await this.client.post(
      "/runtime-host/v1/attempts/settle",
      { attemptId, fence, outcome, ...(summary === undefined ? {} : { summary }) },
      AttemptSettleResponseSchema,
      this.authHeaders(),
      this.abort.signal,
    );
  }

  close(options?: { executionStopped: boolean }): Promise<void> {
    if (options?.executionStopped) return this.disconnect(true);
    this.closeTask ??= this.disconnect();
    return this.closeTask;
  }

  stopReceiving(): void {
    this.receiving.abort();
    void this.watch?.close();
  }

  private async disconnect(executionStopped = false): Promise<void> {
    this.stopReceiving();
    this.abort.abort();
    await this.client.post(
      "/runtime-host/v1/presence/disconnect",
      { reason: "host_closed", ...(executionStopped ? { executionStopped: true } : {}) },
      CompleteResponseSchema,
      this.authHeaders(),
    );
  }

  private async postPresence(): Promise<void> {
    await this.client.post(
      "/runtime-host/v1/presence/heartbeat",
      {
        protocolVersion: PAIRING_PROTOCOL_VERSION,
        presenceSessionId: this.presenceSessionId,
        owner: this.registration.owner,
        connectedAt: this.connectedAt,
        heartbeatAt: this.now(),
        hostVersion: this.registration.hostVersion,
        platform: this.platform,
        adapters: this.registration.adapters,
      },
      PresenceResponseSchema,
      this.authHeaders(),
      this.abort.signal,
    );
  }

  private async claimedCommand(command: RemoteCommand): Promise<RuntimeCommand> {
    const payload = await fetchClaimedPayload(
      this.client, command, this.authHeaders(), this.abort.signal,
    );
    return {
      commandRecordId: command.commandRecordId,
      commandId: command.commandId,
      runId: command.runId,
      attemptId: command.attemptId,
      fence: command.fence,
      kind: command.type,
      receivedAtMs: this.now(),
      payload,
    };
  }

  private authHeaders(): Readonly<Record<string, string>> {
    return {
      Authorization: `Bearer ${this.credential.credential}`,
      "X-NanthAI-Device-ID": this.credential.deviceId,
      "X-NanthAI-Credential-ID": this.credential.credentialId,
      "X-NanthAI-Presence-Session-ID": this.presenceSessionId,
    };
  }
}
