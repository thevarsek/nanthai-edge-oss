import type { OwnedProcessSpec, ProcessExit } from "./process_tree.ts";
import type { ResourceSummary } from "./resource_sampler.ts";
import { SessionSupervisor } from "./session_supervisor.ts";

export type AttemptSessionDescriptor = {
  attemptId: string;
  personaParticipantId: string;
  adapter: "codex_app_server" | "pi_rpc";
  workingDirectory: string | null;
  startedAtMs: number;
};

export type ActiveAttemptSummary = AttemptSessionDescriptor & {
  state: "running";
  pid: number;
  resources: ResourceSummary | null;
};

export type CompletedAttemptSummary = AttemptSessionDescriptor & {
  state: "completed" | "failed" | "cancelled";
  pid: number;
  endedAtMs: number;
  exit: ProcessExit;
};

export type AttemptSummary = ActiveAttemptSummary | CompletedAttemptSummary;

type ActiveAttempt = {
  descriptor: AttemptSessionDescriptor;
  pid: number;
  requestedOutcome: CompletedAttemptSummary["state"] | null;
};

export class AttemptSessionManager {
  private readonly supervisor = new SessionSupervisor();
  private readonly active = new Map<string, ActiveAttempt>();
  private readonly completed: CompletedAttemptSummary[] = [];

  constructor(
    private readonly maxCompleted = 200,
    private readonly now: () => number = Date.now,
  ) {
    if (maxCompleted < 0) throw new RangeError("Completed session bound cannot be negative");
  }

  start(descriptor: AttemptSessionDescriptor, spec: OwnedProcessSpec): number {
    if (this.active.has(descriptor.attemptId)) {
      throw new Error(`Attempt is already active: ${descriptor.attemptId}`);
    }
    const session = this.supervisor.spawn(descriptor.attemptId, spec);
    const active: ActiveAttempt = {
      descriptor: { ...descriptor },
      pid: session.worker.pid,
      requestedOutcome: null,
    };
    this.active.set(descriptor.attemptId, active);
    void session.worker.exit.then(
      (exit) => this.finish(active, exit),
      () => this.finish(active, { code: null, signal: null }),
    );
    return active.pid;
  }

  activeCount(): number {
    return this.active.size;
  }

  getWorker(attemptId: string) {
    return this.supervisor.get(attemptId)?.worker ?? null;
  }

  async cancel(attemptId: string, graceMs = 500): Promise<ProcessExit | null> {
    return this.close(attemptId, "cancelled", graceMs);
  }

  async close(
    attemptId: string,
    outcome: CompletedAttemptSummary["state"],
    graceMs = 500,
  ): Promise<ProcessExit | null> {
    const active = this.active.get(attemptId);
    if (active === undefined) return null;
    active.requestedOutcome = outcome;
    const exit = await this.supervisor.close(attemptId, graceMs);
    if (exit !== null) this.finish(active, exit);
    return exit;
  }

  async closeAll(graceMs = 500): Promise<void> {
    const attemptIds = [...this.active.keys()];
    await Promise.all(attemptIds.map((attemptId) => this.cancel(attemptId, graceMs)));
  }

  async summaries(): Promise<readonly AttemptSummary[]> {
    const running = await Promise.all([...this.active.values()].map(async (active) => ({
      ...active.descriptor,
      state: "running" as const,
      pid: active.pid,
      resources: await this.sample(active.descriptor.attemptId),
    })));
    return [...running, ...this.completed];
  }

  private async sample(attemptId: string): Promise<ResourceSummary | null> {
    const worker = this.supervisor.get(attemptId)?.worker;
    if (worker === undefined) return null;
    try {
      return await worker.sampleResources();
    } catch {
      return null;
    }
  }

  private finish(active: ActiveAttempt, exit: ProcessExit): void {
    if (this.active.get(active.descriptor.attemptId) !== active) return;
    this.active.delete(active.descriptor.attemptId);
    const state = active.requestedOutcome ?? (exit.code === 0 ? "completed" : "failed");
    this.completed.unshift({
      ...active.descriptor,
      state,
      pid: active.pid,
      endedAtMs: this.now(),
      exit,
    });
    if (this.completed.length > this.maxCompleted) this.completed.length = this.maxCompleted;
  }
}
