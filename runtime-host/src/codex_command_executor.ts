import { AttemptSessionManager } from "./attempt_session_manager.ts";
import {
  CodexAttemptPump,
  commandReference,
  runtimeEvent,
  sendAndWait,
} from "./codex_attempt_pump.ts";
import { codexAppServerWorkerSpec } from "./codex_worker_spec.ts";
import { APP_SERVER_CAPABILITIES } from "./codex_capabilities.ts";
import type { RuntimeCommand, RuntimeEvent } from "./control_plane.ts";
import type { WorkerToHostMessage } from "./protocol.ts";
import { atomicTurnPlan, followupPlan } from "./runtime_command_translation.ts";
import type { RuntimeCommandExecutor } from "./runtime_host.ts";
import type { RuntimePartFetcher } from "./runtime_part_fetcher.ts";
import { materializeRuntimeParts } from "./runtime_part_materializer.ts";
import { PI_PART_CAPABILITIES, type PiWorkerConfig } from "./pi_worker_backend.ts";
import { piWorkerSpec } from "./pi_worker_spec.ts";
import type { UsageRecorder } from "./usage_history.ts";

export type CodexCommandExecutorOptions = {
  bridgeCall?: (request: Extract<WorkerToHostMessage, { kind: "bridge_call" }>["payload"], packet: import("./protocol.ts").LocalRuntimeTurnPacket, signal: AbortSignal) => Promise<string>;
  codexCommand?: string;
  pi?: Omit<PiWorkerConfig, "environment" | "attachmentDirectory" | "threadName">;
  codexArgs?: readonly string[];
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  workingDirectory?: string;
  partFetcher?: RuntimePartFetcher;
  partTemporaryRoot?: string;
  cachedPartDirectory?: string;
  onPreparedTurn?: (command: RuntimeCommand, directory: string | null) => Promise<void>;
  now?: () => number;
  onLocalDiagnostic?: (message: string) => void;
};

export class RuntimeWorkerExecutor implements RuntimeCommandExecutor {
  private readonly sessions = new AttemptSessionManager();
  private readonly pumps = new Map<string, CodexAttemptPump>();
  private readonly usageTasks = new Set<Promise<void>>();
  private readonly now: () => number;

  constructor(
    private readonly options: CodexCommandExecutorOptions,
    private readonly usage: UsageRecorder | null = null,
    private readonly onUsageFailure: (error: Error) => void = writeUsageFailure,
  ) {
    this.now = options.now ?? Date.now;
  }

  activeCount(): number {
    return this.sessions.activeCount();
  }

  async execute(
    command: RuntimeCommand,
    emit: (event: RuntimeEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    if (command.kind === "start" || command.kind === "resume") {
      await this.executeAtomicTurn(command, emit, signal);
      return;
    }
    const worker = this.sessions.getWorker(command.attemptId);
    const pump = this.pumps.get(command.attemptId);
    if (worker === null || pump === undefined) {
      throw new Error(`No active runtime worker owns attempt ${command.attemptId}`);
    }
    const message = pump.sequencer.next(command.commandRecordId, followupPlan(command));
    await sendAndWait(worker, pump, message, commandReference(command));
  }

  async shutdown(): Promise<void> {
    await this.sessions.closeAll();
    await Promise.allSettled([...this.pumps.values()].map((pump) => pump.task));
    await Promise.allSettled([...this.usageTasks]);
    this.pumps.clear();
  }

  private async executeAtomicTurn(
    command: RuntimeCommand,
    emit: (event: RuntimeEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void> {
    const plan = atomicTurnPlan(command);
    const adapter = plan.packet.placement.adapter.adapterId;
    if (adapter !== "codex" && adapter !== "pi") throw new Error(`Unsupported adapter ${adapter}`);
    if (adapter === "pi" && !this.options.pi || adapter === "codex" && !this.options.codexCommand) {
      throw new Error(`The selected ${adapter} executable is unavailable`);
    }
    const materialized = await materializeRuntimeParts(
      plan.packet,
      adapter === "pi" ? PI_PART_CAPABILITIES : APP_SERVER_CAPABILITIES,
      this.options.partFetcher,
      signal,
      { ...(this.options.partTemporaryRoot ? { temporaryRoot: this.options.partTemporaryRoot } : {}),
        ...(this.options.cachedPartDirectory ? { cachedDirectory: this.options.cachedPartDirectory } : {}) },
    );
    try {
      await this.options.onPreparedTurn?.(command, materialized.directory);
      const worker = this.startWorker(
        command,
        plan.packet.participantId,
        plan.threadName,
        materialized.directory,
        adapter,
      );
      const pump = new CodexAttemptPump(command, this.now);
      pump.task = this.pump(command.attemptId, worker, pump, emit, plan.packet, signal);
      void pump.task.catch(() => undefined);
      this.pumps.set(command.attemptId, pump);
      const opening = pump.sequencer.next(command.commandRecordId, plan.opening);
      await sendAndWait(worker, pump, opening, commandReference(command));
      const turn = pump.sequencer.next(command.commandRecordId, plan.sendTurn);
      await sendAndWait(worker, pump, turn, commandReference(command));
      await pump.drained;
    } catch (error) {
      await this.sessions.close(command.attemptId, "failed");
      throw error;
    } finally {
      await materialized.dispose();
    }
  }

  private startWorker(
    command: RuntimeCommand,
    participantId: string,
    threadName: string,
    attachmentDirectory: string | null,
    adapter: "codex" | "pi",
  ) {
    const spec = adapter === "pi" ? piWorkerSpec({
      ...this.options.pi!, threadName,
      ...(attachmentDirectory === null ? {} : { attachmentDirectory }),
    }) : codexAppServerWorkerSpec({
      codexCommand: this.options.codexCommand!, threadName,
      ...(attachmentDirectory === null ? {} : { attachmentDirectory }),
      ...(this.options.codexArgs === undefined ? {} : { codexArgs: this.options.codexArgs }),
      sandboxMode: this.options.sandboxMode ?? "danger-full-access",
      ...(this.options.workingDirectory === undefined ? {} : { workingDirectory: this.options.workingDirectory }),
    });
    this.sessions.start({
      attemptId: command.attemptId,
      personaParticipantId: participantId,
      adapter: adapter === "pi" ? "pi_rpc" : "codex_app_server",
      workingDirectory: (adapter === "pi" ? this.options.pi?.workingDirectory : this.options.workingDirectory) ?? null,
      startedAtMs: this.now(),
    }, spec);
    const worker = this.sessions.getWorker(command.attemptId);
    if (worker === null) throw new Error("Runtime worker exited during startup");
    return worker;
  }

  private async pump(
    attemptId: string,
    worker: AsyncIterable<WorkerToHostMessage>,
    pump: CodexAttemptPump,
    emit: (event: RuntimeEvent) => Promise<void>,
    packet: import("./protocol.ts").LocalRuntimeTurnPacket,
    signal: AbortSignal,
  ): Promise<void> {
    let drained = false;
    let publishedSequence = 0;
    try {
      for await (const message of worker) {
        if (message.kind === "bridge_call") {
          let success = true;
          let text: string;
          try {
            if (!this.options.bridgeCall) throw new Error("NanthAI result bridge is unavailable");
            text = await this.options.bridgeCall(message.payload, packet, signal);
          } catch (error) { success = false; text = error instanceof Error ? error.message : "NanthAI tool failed"; }
          this.sessions.getWorker(attemptId)?.send(pump.sequencer.next(packet.command.commandId, {
            kind: "bridge_response", payload: { callId: message.payload.callId, success, text: text.slice(0, 32_000) },
          }));
          continue;
        }
        this.recordUsage(message);
        if (message.kind === "protocol_error"
          && message.payload.code === "thread_name_update_failed") {
          this.reportLocalDiagnostic(message.payload.message);
        }
        const reference = pump.referenceFor(message);
        // Private bridge calls use the result endpoint, so the published stream owns its contiguous sequence.
        await emit(runtimeEvent(reference, attemptId, { ...message, sequence: publishedSequence++ }));
        pump.markTerminal(message);
        const settlement = pump.response(message);
        if (pump.shouldDrain() || settlement?.fatal === true) {
          await this.sessions.close(attemptId, pump.completionState());
          drained = true;
          pump.completeDrain();
        }
        settlement?.complete();
        if (drained) return;
      }
    } catch (error) {
      const failure = asError(error);
      pump.rejectPending(failure);
      pump.failDrain(failure);
      throw failure;
    } finally {
      if (!drained) {
        const failure = new Error("Runtime worker ended before its canonical turn drained");
        pump.rejectPending(failure);
        pump.failDrain(failure);
      }
      if (this.pumps.get(attemptId) === pump) this.pumps.delete(attemptId);
    }
  }

  private recordUsage(message: WorkerToHostMessage): void {
    if (this.usage === null || message.kind !== "adapter_event"
      || message.payload.event.type !== "usage_reported") return;
    const event = message.payload.event;
    const task = this.usage.record({
      occurredAtMs: event.occurredAt,
      provider: event.actualModel?.provider ?? null,
      modelId: event.actualModel?.modelId ?? null,
      tokens: event.tokens,
      cost: event.cost,
    }).catch((error: unknown) => this.onUsageFailure(asError(error)));
    this.usageTasks.add(task);
    void task.finally(() => this.usageTasks.delete(task));
  }

  private reportLocalDiagnostic(message: string): void {
    try {
      (this.options.onLocalDiagnostic ?? writeLocalDiagnostic)(message);
    } catch {
      // Diagnostic sinks cannot turn a recoverable native naming failure into a failed turn.
    }
  }
}

export { RuntimeWorkerExecutor as CodexCommandExecutor };

function writeUsageFailure(error: Error): void {
  process.stderr.write(`[NanthAI local usage warning] ${JSON.stringify(error.message)}\n`);
}

function writeLocalDiagnostic(message: string): void {
  process.stderr.write(`[NanthAI runtime warning] ${JSON.stringify(message)}\n`);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
