import { WorkerBridge } from "./worker_bridge.ts";
import type { WorkerBackend } from "./worker_backend.ts";
import { verifyPacketIntegrity } from "./packet_integrity.ts";
import type {
  AdapterEvent,
  HostToWorkerMessage,
  LocalRuntimeTurnPacket,
} from "./protocol.ts";
import { WorkerWireOutput } from "./worker_wire_output.ts";

type ActiveSession<Session> = {
  sessionId: string;
  packet: LocalRuntimeTurnPacket;
  canonical: Session;
  turnDispatched: boolean;
  terminal: boolean;
};

export class WorkerController<Session> {
  private session: ActiveSession<Session> | null = null;
  private readonly bridge: WorkerBridge;
  private turnTask: Promise<void> | null = null;
  private cancelRequestId: string | null = null;

  constructor(
    private readonly backend: WorkerBackend<Session>,
    private readonly output: WorkerWireOutput,
    private readonly workerId: string,
  ) {
    this.bridge = new WorkerBridge(output);
    backend.bindTools((request) => this.bridge.call(request));
  }

  ready(): void {
    this.output.emit({
      kind: "worker_ready",
      payload: { workerId: this.workerId, processId: process.pid, capabilities: this.backend.capabilities },
    });
  }

  async handle(message: HostToWorkerMessage): Promise<boolean> {
    try {
      return await this.dispatch(message);
    } catch (error) {
      this.output.emit({
        kind: "protocol_error",
        payload: {
          requestMessageId: message.messageId,
          code: errorCode(error),
          message: publicError(error),
          recoverable: isRecoverableFollowup(message),
        },
      });
      return false;
    }
  }

  async shutdown(): Promise<void> {
    await this.turnTask?.catch(() => undefined);
    await this.backend.shutdown();
  }

  private async dispatch(message: HostToWorkerMessage): Promise<boolean> {
    switch (message.kind) {
      case "bridge_response": this.bridge.reply(message.payload); return false;
      case "probe_request": await this.probe(message); return false;
      case "list_models_request": await this.listModels(message); return false;
      case "start_session_request": await this.open(message, false); return false;
      case "resume_request": await this.open(message, true); return false;
      case "send_turn_request": this.sendTurn(message); return false;
      case "cancel_request": await this.cancel(message); return false;
      case "permission_response_request": await this.permission(message); return false;
      case "input_response_request": await this.input(message); return false;
      case "close_request": await this.close(message); return true;
    }
  }

  private async probe(message: Extract<HostToWorkerMessage, { kind: "probe_request" }>) {
    const result = await this.backend.probe();
    this.output.emit({ kind: "probe_result", payload: {
      requestMessageId: message.messageId,
      healthy: result.healthy,
      authState: "unavailable",
      summary: result.summary,
    } });
  }

  private async listModels(
    message: Extract<HostToWorkerMessage, { kind: "list_models_request" }>,
  ) {
    const models = await this.backend.canonicalModels();
    this.output.emit({ kind: "models_result", payload: {
      requestMessageId: message.messageId, models,
    } });
  }

  private async open(
    message: Extract<HostToWorkerMessage, { kind: "start_session_request" | "resume_request" }>,
    _resumed: boolean,
  ) {
    if (this.session !== null) throw new Error("worker_session_already_claimed");
    const packet = verifyPacketIntegrity(message.payload.packetSeed);
    const sessionId = packet.attemptId;
    const nativeId = message.kind === "resume_request" ? message.payload.nativeSessionId : null;
    const opened = await this.backend.open(packet, sessionId, nativeId, message.kind === "resume_request" ? message.payload : undefined);
    const canonical = opened.session;
    this.session = { sessionId, packet, canonical, turnDispatched: false, terminal: false };
    this.output.emit({ kind: "session_result", payload: {
      requestMessageId: message.messageId,
      sessionId,
      nativeSessionId: this.backend.nativeSessionId(canonical),
      resumed: opened.resumed,
      ...(opened.replacementReason ? { replacementReason: opened.replacementReason } : {}),
    } });
    if (opened.threadNameDiagnostic !== null) {
      this.output.emit({ kind: "protocol_error", payload: {
        requestMessageId: message.messageId,
        code: "thread_name_update_failed",
        message: opened.threadNameDiagnostic,
        recoverable: true,
      } });
    }
  }

  private sendTurn(message: Extract<HostToWorkerMessage, { kind: "send_turn_request" }>) {
    const session = this.requireSession(message.payload.sessionId);
    if (session.turnDispatched) {
      this.reject(message.messageId, "turn_already_dispatched", "Worker accepts one turn");
      return;
    }
    if (message.payload.commandId !== session.packet.command.commandId
      || message.payload.packetHash !== session.packet.command.packetHash) {
      this.reject(message.messageId, "packet_reference_mismatch", "Turn does not match packet seed");
      return;
    }
    session.turnDispatched = true;
    this.accept(message.messageId, "Turn accepted");
    this.turnTask = this.streamTurn(session, message.messageId);
  }

  private async streamTurn(session: ActiveSession<Session>, requestId: string): Promise<void> {
    let terminal: AdapterEvent | null = null;
    for await (const event of this.backend.sendTurn(session.canonical)) {
      terminal = event.type === "terminal" ? event : terminal;
      if (event.type === "terminal") session.terminal = true;
      this.output.emit(event.type === "terminal"
        ? { kind: "terminal_event", payload: { sessionId: session.sessionId, event } }
        : { kind: "adapter_event", payload: { sessionId: session.sessionId, event } });
    }
    this.complete(requestId, terminal?.type === "terminal" ? terminal.outcome : "Turn ended");
    if (this.cancelRequestId !== null) this.complete(this.cancelRequestId, "Cancellation settled");
  }

  private async cancel(message: Extract<HostToWorkerMessage, { kind: "cancel_request" }>) {
    const session = this.requireSession(message.payload.sessionId);
    if (!session.turnDispatched) throw new Error("turn_not_started");
    if (session.terminal) throw new Error("turn_already_terminal");
    if (this.cancelRequestId !== null) throw new Error("cancellation_already_pending");
    this.cancelRequestId = message.messageId;
    try {
      await this.backend.cancel(session.canonical);
      if (!session.terminal) this.accept(message.messageId, "Cancellation accepted; awaiting terminal event");
    } catch (error) {
      this.cancelRequestId = null;
      throw error;
    }
  }

  private async permission(
    message: Extract<HostToWorkerMessage, { kind: "permission_response_request" }>,
  ) {
    const session = this.requireSession(message.payload.sessionId);
    const event = await this.backend.respondToPermission(
      session.canonical, message.payload.permissionRequestId, message.payload.decision,
    );
    if (event.type === "terminal") throw new Error("invalid_permission_response_event");
    this.output.emit({ kind: "adapter_event", payload: { sessionId: session.sessionId, event } });
    this.complete(message.messageId, "Permission response delivered");
  }

  private async input(message: Extract<HostToWorkerMessage, { kind: "input_response_request" }>) {
    const session = this.requireSession(message.payload.sessionId);
    const event = await this.backend.respondToInput(
      session.canonical, message.payload.inputRequestId, message.payload.response,
    );
    if (event.type === "terminal") throw new Error("invalid_input_response_event");
    this.output.emit({ kind: "adapter_event", payload: { sessionId: session.sessionId, event } });
    this.complete(message.messageId, "Structured input response delivered");
  }

  private async close(message: Extract<HostToWorkerMessage, { kind: "close_request" }>) {
    const session = this.requireSession(message.payload.sessionId);
    await this.backend.close(session.canonical);
    this.complete(message.messageId, "Session closed");
  }

  private requireSession(sessionId: string): ActiveSession<Session> {
    if (this.session === null || this.session.sessionId !== sessionId) {
      throw new Error("unknown_session");
    }
    return this.session;
  }

  private accept(requestMessageId: string, summary: string) {
    this.output.emit({ kind: "command_result", payload: {
      requestMessageId, status: "accepted", code: null, summary,
    } });
  }

  private complete(requestMessageId: string, summary: string) {
    this.output.emit({ kind: "command_result", payload: {
      requestMessageId, status: "completed", code: null, summary,
    } });
  }

  private reject(requestMessageId: string, code: string, summary: string) {
    this.output.emit({ kind: "command_result", payload: {
      requestMessageId, status: "rejected", code, summary,
    } });
  }
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name === "PacketIntegrityError") return "packet_integrity_failed";
  return "worker_request_failed";
}

function publicError(error: unknown): string {
  if (error instanceof Error && error.name === "PacketIntegrityError") return error.message;
  return "Runtime worker could not process the request";
}

function isRecoverableFollowup(message: HostToWorkerMessage): boolean {
  return message.kind === "permission_response_request";
}
