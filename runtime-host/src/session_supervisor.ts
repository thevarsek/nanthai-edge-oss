import type { OwnedProcessSpec, ProcessExit } from "./process_tree.ts";
import { WireWorker, type WireWorkerOptions } from "./wire_worker.ts";

export type SupervisedSession = {
  attemptId: string;
  worker: WireWorker;
};

export class SessionSupervisor {
  private readonly sessions = new Map<string, SupervisedSession>();

  spawn(
    attemptId: string,
    spec: OwnedProcessSpec,
    options: WireWorkerOptions = {},
  ): SupervisedSession {
    if (this.sessions.has(attemptId)) {
      throw new Error(`Attempt already owns a worker: ${attemptId}`);
    }
    const session = { attemptId, worker: WireWorker.spawn(spec, options) };
    this.sessions.set(attemptId, session);
    const remove = () => {
      if (this.sessions.get(attemptId) === session) this.sessions.delete(attemptId);
    };
    void session.worker.exit.then(remove, remove);
    return session;
  }

  get(attemptId: string): SupervisedSession | null {
    return this.sessions.get(attemptId) ?? null;
  }

  async close(attemptId: string, graceMs = 500): Promise<ProcessExit | null> {
    const session = this.sessions.get(attemptId);
    if (session === undefined) return null;
    this.sessions.delete(attemptId);
    return session.worker.close(graceMs);
  }

  async closeAll(graceMs = 500): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map((session) => session.worker.close(graceMs)));
  }
}
