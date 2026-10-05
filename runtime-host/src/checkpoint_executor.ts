import type { RuntimeEvent } from "./control_plane.ts";
import type { RuntimeCommandExecutor } from "./runtime_host.ts";
import type { SavedTask } from "./saved_task_store.ts";
import { isTurnCommand } from "./runtime_event_outcome.ts";

/** Active checkpoints live in memory only until their turn pump drains. */
export function checkpointExecutor(executor: RuntimeCommandExecutor,
  store: { record(task: SavedTask, event: RuntimeEvent): Promise<void> },
  tasks: Map<string, SavedTask>) : RuntimeCommandExecutor {
  return {
    activeCount: () => executor.activeCount(),
    shutdown: async () => { try { await executor.shutdown(); } finally { tasks.clear(); } },
    execute: async (command, emit, signal) => {
      try {
        await executor.execute(command, async event => {
          const task = tasks.get(command.attemptId);
          if (task) {
            try { await store.record(task, event); }
            catch (error) { process.stderr.write(`[NanthAI checkpoint] ${String(error)}\n`); }
          }
          await emit(event);
        }, signal);
      } finally {
        // A question/permission response shares the active turn; it must not evict its checkpoint.
        if (isTurnCommand(command)) tasks.delete(command.attemptId);
      }
    },
  };
}
