import { callSavedControl, pendingSavedControls } from "./saved_task_controls.ts";
import { join } from "node:path";
import type { CredentialStore } from "./credential_store.ts";
import type { CodexCommandExecutorOptions } from "./codex_command_executor.ts";
import { reconcileInterruptedResults } from "./saved_task_sync.ts";
import { SavedTaskStore } from "./saved_task_store.ts";
import { continueSavedTask } from "./saved_task_continuation.ts";
import { syncSavedResults } from "./saved_task_sync.ts";

export class SavedWorkService {
  constructor(private readonly store: SavedTaskStore, private readonly credentials: CredentialStore,
    private readonly options: CodexCommandExecutorOptions) {}
  async list() {
    await reconcileInterruptedResults(this.store);
    const results = await this.store.results();
    const credential = await this.credentials.readDeviceCredential();
    const tasks = (await this.store.tasks()).filter(task => credential?.deviceId === task.deviceId && credential.controlPlaneUrl === task.server);
    return { tasks: await Promise.all(tasks.map(async task => ({ id: task.id, title: task.title,
      adapter: task.packet.placement.adapter.adapterId, modelId: task.packet.placement.selectedModel.modelId,
      artifacts: await this.store.artifactPaths(task.id, task.files),
      requests: await pendingSavedControls(this.store.root, task.id),
      output: task.output, updatedAt: task.updatedAt, outcome: task.outcome,
      results: await Promise.all(results.filter(result => result.taskId === task.id).map(async result => ({ id: result.id, prompt: result.prompt,
        output: result.output, outcome: result.outcome, synced: result.synced, disposition: result.disposition,
        filenames: result.files.map(file => file.filename), artifacts: await this.store.artifactPaths(result.id, result.files, true) }))),
    }))) };
  }
  async continue(taskId: string, prompt: string, signal: AbortSignal) {
    await this.list(); // Reconcile only exited local owners, never rerun their work.
    const task = await this.store.task(taskId);
    const credential = await this.credentials.readDeviceCredential();
    if (credential?.deviceId !== task.deviceId || credential.controlPlaneUrl !== task.server) {
      throw new Error("This saved task belongs to a different Mac pairing. Its local work is retained.");
    }
    return continueSavedTask(this.store, taskId, prompt, this.options, signal);
  }
  async control(taskId: string, input: unknown) {
    const credential = await this.credentials.readDeviceCredential();
    const task = await this.store.task(taskId);
    if (credential?.deviceId !== task.deviceId || credential.controlPlaneUrl !== task.server) throw new Error("This saved task belongs to a different Mac pairing.");
    return callSavedControl(this.store.root, taskId, input);
  }
  async sync(signal?: AbortSignal) {
    await this.list();
    const credential = await this.credentials.readDeviceCredential();
    if (!credential) throw new Error("Connect this Mac to NanthAI to synchronize saved work.");
    return syncSavedResults(this.store, credential, signal);
  }
}

export function savedWorkOptions(root: string): CodexCommandExecutorOptions {
  return {
    ...(process.env.NANTHAI_CODEX_COMMAND?.trim() ? { codexCommand: process.env.NANTHAI_CODEX_COMMAND.trim() } : {}),
    ...(process.env.NANTHAI_PI_COMMAND?.trim() ? { pi: { command: process.env.NANTHAI_PI_COMMAND.trim(),
      sessionDirectory: join(root, "pi-sessions"),
      ...(process.env.NANTHAI_PI_WORKING_DIRECTORY?.trim() ? { workingDirectory: process.env.NANTHAI_PI_WORKING_DIRECTORY.trim() } : {}),
    } } : {}),
  };
}
