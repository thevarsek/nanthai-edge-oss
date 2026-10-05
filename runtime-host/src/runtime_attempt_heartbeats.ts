import type {
  ControlPlaneConnection,
  RuntimeCommand,
} from "./control_plane.ts";

type ActiveAttempt = {
  fence: number;
  commands: number;
  terminal: boolean;
  heartbeatTask: Promise<void> | null;
};

export class RuntimeAttemptHeartbeats {
  private readonly attempts = new Map<string, ActiveAttempt>();

  retain(command: RuntimeCommand): void {
    const current = this.attempts.get(command.attemptId);
    if (current !== undefined) {
      if (current.fence !== command.fence) {
        throw new Error("Concurrent commands for one attempt must share its active fence");
      }
      current.commands += 1;
      return;
    }
    this.attempts.set(command.attemptId, {
      fence: command.fence,
      commands: 1,
      terminal: false,
      heartbeatTask: null,
    });
  }

  release(command: RuntimeCommand): void {
    const current = this.attempts.get(command.attemptId);
    if (current === undefined) return;
    current.commands -= 1;
    if (current.commands === 0) this.attempts.delete(command.attemptId);
  }

  retire(command: RuntimeCommand): Promise<void> {
    const current = this.attempts.get(command.attemptId);
    if (current === undefined || current.fence !== command.fence) {
      throw new Error("Terminal event does not match its active attempt");
    }
    current.terminal = true;
    return current.heartbeatTask ?? Promise.resolve();
  }

  async heartbeat(connection: ControlPlaneConnection): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [attemptId, active] of this.attempts) {
      if (active.terminal) continue;
      const task = connection.heartbeatAttempt(attemptId, active.fence).then(() => undefined);
      active.heartbeatTask = task;
      tasks.push(task.finally(() => {
        if (active.heartbeatTask === task) active.heartbeatTask = null;
      }));
    }
    await Promise.all(tasks);
  }
}
