import type { RuntimeCommand, RuntimeEvent } from "./control_plane.ts";
import { HostWireSequencer } from "./host_wire_sequencer.ts";
import type { HostToWorkerMessage, WorkerToHostMessage } from "./protocol.ts";

export type CommandReference = Pick<RuntimeCommand,
  "commandRecordId" | "commandId" | "runId" | "attemptId" | "fence">;
type RequestWaiter = { resolve: () => void; reject: (error: Error) => void };
export type PumpSettlement = {
  fatal: boolean;
  complete(): void;
};

export class CodexAttemptPump {
  readonly sequencer: HostWireSequencer;
  readonly drained: Promise<void>;
  task: Promise<void> = Promise.resolve();
  terminalOutcome: "completed" | "failed" | "cancelled" | "interrupted" | null = null;
  private readonly seedCommand: CommandReference;
  private readonly requestCommands = new Map<string, CommandReference>();
  private readonly requestKinds = new Map<string, HostToWorkerMessage["kind"]>();
  private readonly requestCorrelations = new Map<string, string>();
  private readonly waiters = new Map<string, RequestWaiter>();
  private readonly pendingRequestIds = new Set<string>();
  private resolveDrain: () => void = () => undefined;
  private rejectDrain: (error: Error) => void = () => undefined;

  constructor(command: RuntimeCommand, now: () => number) {
    this.seedCommand = commandReference(command);
    this.sequencer = new HostWireSequencer(now);
    this.drained = new Promise<void>((resolve, reject) => {
      this.resolveDrain = resolve;
      this.rejectDrain = reject;
    });
    void this.drained.catch(() => undefined);
  }

  register(message: HostToWorkerMessage, reference: CommandReference): Promise<void> {
    if (this.waiters.has(message.messageId)) throw new Error("Duplicate worker request");
    this.requestCommands.set(message.messageId, reference);
    this.requestKinds.set(message.messageId, message.kind);
    const correlation = responseCorrelationForRequest(message);
    if (correlation !== null) this.requestCorrelations.set(message.messageId, correlation);
    this.pendingRequestIds.add(message.messageId);
    return new Promise((resolve, reject) => {
      this.waiters.set(message.messageId, { resolve, reject });
    });
  }

  rejectRequest(requestId: string, error: Error): void {
    const waiter = this.waiters.get(requestId);
    if (waiter === undefined) return;
    this.waiters.delete(requestId);
    this.pendingRequestIds.delete(requestId);
    this.requestCommands.delete(requestId);
    this.requestKinds.delete(requestId);
    this.requestCorrelations.delete(requestId);
    waiter.reject(error);
  }

  rejectPending(error: Error): void {
    for (const requestId of [...this.pendingRequestIds]) this.rejectRequest(requestId, error);
  }

  response(message: WorkerToHostMessage): PumpSettlement | null {
    if (!("requestMessageId" in message.payload) || message.payload.requestMessageId === null) {
      return null;
    }
    const requestId = message.payload.requestMessageId;
    if (message.kind === "command_result" && message.payload.status === "accepted") return null;
    const waiter = this.waiters.get(requestId);
    if (waiter === undefined) return null;
    const kind = this.requestKinds.get(requestId);
    this.waiters.delete(requestId);
    this.pendingRequestIds.delete(requestId);
    this.requestCommands.delete(requestId);
    this.requestKinds.delete(requestId);
    this.requestCorrelations.delete(requestId);
    const fatal = kind === "start_session_request" || kind === "resume_request"
      || kind === "send_turn_request";
    const error = responseError(message);
    return {
      fatal: fatal && error !== null
        || message.kind === "protocol_error" && !message.payload.recoverable,
      complete: () => {
        if (error === null) waiter.resolve();
        else waiter.reject(error);
      },
    };
  }

  referenceFor(message: WorkerToHostMessage): CommandReference {
    if ("requestMessageId" in message.payload && message.payload.requestMessageId !== null) {
      return this.requestCommands.get(message.payload.requestMessageId) ?? this.seedCommand;
    }
    const correlation = responseCorrelationForEvent(message);
    if (correlation !== null) {
      for (const requestId of this.pendingRequestIds) {
        if (this.requestCorrelations.get(requestId) !== correlation) continue;
        return this.requestCommands.get(requestId) ?? this.seedCommand;
      }
    }
    return this.seedCommand;
  }

  markTerminal(message: WorkerToHostMessage): void {
    if (message.kind === "terminal_event") this.terminalOutcome = message.payload.event.outcome;
  }

  shouldDrain(): boolean {
    return this.terminalOutcome !== null && this.pendingRequestIds.size === 0;
  }

  completeDrain(): void {
    this.resolveDrain();
  }

  failDrain(error: Error): void {
    this.rejectDrain(error);
  }

  completionState(): "completed" | "failed" | "cancelled" {
    if (this.terminalOutcome === "completed") return "completed";
    if (this.terminalOutcome === "cancelled") return "cancelled";
    return "failed";
  }
}

export async function sendAndWait(
  worker: { send(message: HostToWorkerMessage): void },
  pump: CodexAttemptPump,
  message: HostToWorkerMessage,
  reference: CommandReference,
): Promise<void> {
  const settled = pump.register(message, reference);
  try {
    worker.send(message);
  } catch (error) {
    pump.rejectRequest(message.messageId, asError(error));
    throw error;
  }
  await settled;
}

export function runtimeEvent(
  reference: CommandReference,
  attemptId: string,
  message: WorkerToHostMessage,
): RuntimeEvent {
  return {
    eventId: `${reference.commandId}:worker:${message.sequence}`,
    ...reference,
    attemptId,
    kind: "worker_message",
    emittedAtMs: message.sentAt,
    payload: message,
  };
}

export function commandReference(command: RuntimeCommand): CommandReference {
  return {
    commandRecordId: command.commandRecordId,
    commandId: command.commandId,
    runId: command.runId,
    attemptId: command.attemptId,
    fence: command.fence,
  };
}

function responseError(message: WorkerToHostMessage): Error | null {
  if (message.kind === "command_result" && message.payload.status === "rejected") {
    return new Error(message.payload.summary);
  }
  if (message.kind === "protocol_error") return new Error(message.payload.message);
  return null;
}

function responseCorrelationForRequest(message: HostToWorkerMessage): string | null {
  if (message.kind === "input_response_request") return `input:${message.payload.inputRequestId}`;
  if (message.kind === "permission_response_request") {
    return `permission:${message.payload.permissionRequestId}`;
  }
  return null;
}

function responseCorrelationForEvent(message: WorkerToHostMessage): string | null {
  if (message.kind !== "adapter_event") return null;
  const event = message.payload.event;
  if (event.type === "input_resolved") return `input:${event.inputRequestId}`;
  if (event.type === "permission_resolved") {
    return `permission:${event.permissionRequestId}`;
  }
  return null;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
