import { stripSourceEvidence, validateSourceEvidence } from "./source_evidence.ts";
import { SavedTaskControls } from "./saved_task_controls.ts";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BridgeRequestSchema, PublishResultSchema, WorkerToHostMessageSchema } from "./protocol.ts";
import type { LocalRuntimeTurnPacket } from "./protocol.ts";
import type { RuntimeCommand, RuntimeEvent } from "./control_plane.ts";
import { RuntimeWorkerExecutor, type CodexCommandExecutorOptions } from "./codex_command_executor.ts";
import { computePacketHash } from "./packet_integrity.ts";
import { HostLock } from "./host_lock.ts";
import { eventOutcome } from "./runtime_event_outcome.ts";
import { SavedTaskStore, digest, textDelta, type SavedTask, type LocalResult } from "./saved_task_store.ts";

export function continuationCommand(task: SavedTask, result: LocalResult, history: LocalResult[]): RuntimeCommand {
  const packet = structuredClone(task.packet) as LocalRuntimeTurnPacket;
  const runId = `local-${result.id}`, attemptId = `local-attempt-${result.id}`;
  packet.runId = runId; packet.attemptId = attemptId; packet.fence = 1;
  Object.assign(packet.placement, { runId, attemptId, fence: 1 });
  const append = (role: "user" | "assistant", text: string, messageId: string) => {
    if (text) packet.messages.push({ ordinal: packet.messages.length, messageId, role, name: null,
      participantId: role === "assistant" ? packet.participantId : null,
      content: [{ type: "text", partId: `${messageId}-text`, text }] });
  };
  append("assistant", task.output, `saved-answer-${digest(task.id).slice(0, 16)}`);
  for (const prior of history) {
    append("user", prior.prompt, `local-user-${prior.id}`);
    append("assistant", prior.output, `local-answer-${prior.id}`);
  }
  const messageId = `local-user-${result.id}`;
  append("user", result.prompt, messageId);
  packet.sourceMessageId = messageId;
  packet.context.canonicalHeadMessageId = messageId;
  packet.causality.visibleThroughMessageId = messageId;
  packet.causality.replyToMessageIds = [messageId];
  packet.causality.liveDiscussion = null;
  const note = "Continue this saved NanthAI task in a separate local branch. The context is a saved snapshot, not current shared state. NanthAI publication saves local files for later synchronization. Do not replay earlier actions; carry out only this new follow-up.";
  packet.instructions.system.push({ instructionId: `local-note-${result.id}`, name: "Saved task continuation", text: note, sourceHash: digest(note) });
  packet.command = { commandId: result.id, idempotencyKey: result.id,
    commandInputHash: digest(result.prompt).slice(0, 8), packetHash: "0".repeat(64), cancellationId: `cancel-${result.id}` };
  packet.command.packetHash = computePacketHash(packet);
  return { commandRecordId: result.id, commandId: result.id, runId, attemptId, fence: 1,
    kind: "start", receivedAtMs: Date.now(), payload: { type: "start", authorizationSource: "explicit_user_turn",
      inputHash: digest(result.prompt), rawPayload: JSON.stringify({ threadName: task.title }), turnPacketId: `local-packet-${result.id}`,
      packet, packetSha256: packet.command.packetHash, packetError: null } };
}

export async function continueSavedTask(
  store: SavedTaskStore, taskId: string, prompt: string, options: CodexCommandExecutorOptions,
  signal: AbortSignal, createExecutor = (configuration: CodexCommandExecutorOptions) => new RuntimeWorkerExecutor(configuration),
): Promise<LocalResult> {
  if (!prompt.trim()) throw new Error("Enter a follow-up for the saved task.");
  const lock = await HostLock.acquire(join(store.taskDirectory(taskId), "continuation.lock"), "tray");
  let executor: ReturnType<typeof createExecutor> | undefined;
  let controls: SavedTaskControls | undefined;
  const result: LocalResult = { version: 1, id: randomUUID(), taskId, prompt, output: "", outcome: null,
    baseOutputHash: "", previousResultId: null, ownerPid: process.pid, files: [], usage: [], createdAt: Date.now(), synced: false, disposition: null };
  try {
    const task = await store.task(taskId);
    const history = (await store.results()).filter(item => item.taskId === taskId).sort((a, b) => a.createdAt - b.createdAt);
    result.baseOutputHash = digest(task.output);
    result.previousResultId = history.at(-1)?.id ?? null;
    const command = continuationCommand(task, result, history);
    await store.saveResult(result); // Commit identity before any native/model/tool side effect.
    const localOptions = { ...options };
    delete localOptions.partFetcher;
    executor = createExecutor({ ...localOptions, cachedPartDirectory: join(store.taskDirectory(taskId), "parts"),
      bridgeCall: async (value, packet, bridgeSignal) => {
        bridgeSignal.throwIfAborted();
        const request = BridgeRequestSchema.parse(value);
        if (!packet.capabilities.nanthaiTools.some(tool => tool.id === request.tool)) throw new Error("Tool is not bound to this saved task");
        if (request.tool === "nanthai_read_context") {
          return JSON.stringify({ ...packet.context, messageIds: packet.messages.map(message => message.messageId), savedSnapshot: true });
        }
        const file = PublishResultSchema.parse(request.arguments);
        const existing = result.files.find(item => item.callId === request.callId);
        if (existing && JSON.stringify({ ...existing, callId: undefined }) !== JSON.stringify(file)) throw new Error("Local publication identity changed");
        if (!existing) { result.files.push({ ...file, callId: request.callId }); await store.saveResult(result); }
        return JSON.stringify({ savedLocally: true, filename: file.filename, pendingSync: true });
      },
    });
    controls = new SavedTaskControls(command, result.id, followup => executor!.execute(followup, async () => {}, signal));
    await controls.open(store.root, taskId);
    await executor.execute(command, async (event: RuntimeEvent) => {
      controls!.observe(event);
      result.output += textDelta(event) ?? "";
      const outcome = eventOutcome(event);
      result.outcome = outcome ?? result.outcome;
      if (outcome) {
        result.sourceCitations = validateSourceEvidence(result.output, task.packet.context.evidenceSources ?? []);
        result.output = stripSourceEvidence(result.output);
      }
      const message = WorkerToHostMessageSchema.safeParse(event.payload);
      if (message.success && message.data.kind === "adapter_event" && message.data.payload.event.type === "usage_reported") {
        result.usage.push(message.data.payload.event);
      }
      await store.saveResult(result);
    }, signal);
    if (!result.outcome) throw new Error("Local continuation ended without a terminal result");
    return result;
  } catch (error) {
    result.output = stripSourceEvidence(result.output);
    result.outcome ??= signal.aborted ? "interrupted" : "failed";
    await store.saveResult(result);
    throw error;
  } finally { await controls?.close(); await executor?.shutdown(); await lock.release(); }
}
