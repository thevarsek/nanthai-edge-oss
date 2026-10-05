import { z } from "zod";
import type { DeviceCredential } from "./control_plane.ts";
import { HttpJsonClient } from "./http_json_client.ts";
import { isProcessPresent } from "./host_lock.ts";
import { SavedTaskStore } from "./saved_task_store.ts";
const receiptSchema = z.object({ disposition: z.enum(["synced", "review"]), assistantMessageId: z.string() });

export async function syncSavedResults(store: SavedTaskStore, credential: DeviceCredential, signal?: AbortSignal,
  client = new HttpJsonClient(credential.controlPlaneUrl)): Promise<number> {
  await reconcileInterruptedResults(store);
  const pending = (await store.results()).filter(result => !result.synced && result.outcome !== null)
    .sort((left, right) => left.createdAt - right.createdAt);
  let count = 0;
  const blockedTasks = new Set<string>();
  const failures: unknown[] = [];
  for (const result of pending) {
    if (blockedTasks.has(result.taskId)) continue;
    try {
    const task = await store.task(result.taskId);
    if (task.deviceId !== credential.deviceId || task.server !== credential.controlPlaneUrl) continue;
    const receipt = await client.post("/runtime-host/results/import-offline", {
      id: result.id, originRunId: result.taskId, previousResultId: result.previousResultId,
      baseOutputHash: result.baseOutputHash, prompt: result.prompt, output: result.output,
      sourceCitations: result.sourceCitations ?? [],
      outcome: result.outcome, createdAt: result.createdAt,
      files: result.files.map(({ callId: _id, ...file }) => file), usage: result.usage,
    }, receiptSchema, { Authorization: `Bearer ${credential.credential}`,
      "X-NanthAI-Device-ID": credential.deviceId, "X-NanthAI-Credential-ID": credential.credentialId,
      "X-NanthAI-Presence-Session-ID": "saved-result-sync" }, signal);
    result.synced = true; result.disposition = receipt.disposition;
    await store.saveResult(result); // Lost acknowledgement retries the same identity; never inference.
    count++;
    } catch (error) { blockedTasks.add(result.taskId); failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, `Saved work remains on this Mac: ${failures.map(String).join("; ")}`);
  return count;
}

export async function reconcileInterruptedResults(store: SavedTaskStore): Promise<void> {
  for (const result of await store.results()) {
    if (result.outcome === null && !isProcessPresent(result.ownerPid)) {
      result.outcome = "interrupted";
      await store.saveResult(result);
    }
  }
}
