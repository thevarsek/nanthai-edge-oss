import type { Doc, Id } from "../_generated/dataModel";
import { contextDigest } from "./context_receipt";
import { computeRuntimePacketHash } from "./production_packet";
import { LocalRuntimeTurnPacketSchema, type LocalRuntimeTurnPacket } from "./protocol_packet";
import { RUNTIME_PROTOCOL_VERSION } from "./protocol_common";
import { stableInputHash } from "../execution/commands";

export async function buildHelperPacket(context: {
  task: Doc<"runtimeHelperTasks">; attempt: Doc<"executionAttempts">; run: Doc<"executionRuns">; personaId: Id<"personas">;
}): Promise<LocalRuntimeTurnPacket> {
  const { task, attempt, run, personaId } = context;
  const taskId = task._id;
  const commandId = `helper-${String(taskId)}-${attempt.fence}`;
  const inputMessages = task.messages.filter(message => message.role !== "system");
  const packet = LocalRuntimeTurnPacketSchema.parse({
      protocolVersion: RUNTIME_PROTOCOL_VERSION, runId: String(run._id), attemptId: String(attempt._id), fence: attempt.fence,
      chatId: String(task.chatId), sourceMessageId: String(task.sourceMessageId),
      participantId: String(attempt.chatParticipantId), personaId: String(personaId),
      messages: inputMessages.map((message, ordinal) => ({
        ordinal, messageId: ordinal === inputMessages.length - 1 ? String(task.sourceMessageId) : `${String(taskId)}-${ordinal}`, role: message.role, name: null, participantId: null,
        content: [{ type: "text", partId: `${String(taskId)}-text-${ordinal}`, text: message.content }],
      })),
      instructions: {
        system: await Promise.all(task.messages.filter(message => message.role === "system").map(async (message, index) => ({
          instructionId: `helper-${index}`, name: "NanthAI helper", text: message.content, sourceHash: await contextDigest(message.content),
        }))), persona: [],
      },
      context: { assemblerVersion: "m45-helper-v1", canonicalHeadMessageId: String(task.sourceMessageId), references: [], omissions: [], omittedPartCount: 0 },
      capabilities: { nanthaiTools: [], skills: [], integrations: [], adapterNativePolicy: "preserve" },
      placement: {
        protocolVersion: RUNTIME_PROTOCOL_VERSION, runId: String(run._id), attemptId: String(attempt._id), fence: attempt.fence,
        adapter: { adapterId: attempt.adapterId, adapterVersion: attempt.adapterVersion ?? null },
        selectedModel: { mode: attempt.modelSelectionMode ?? "adapter_default", provider: attempt.provider ?? null, modelId: attempt.modelId ?? null },
        placement: "local", executorKind: "local_runtime", orchestrationEngine: "runtime_adapter",
        device: { deviceId: attempt.deviceId, displayName: attempt.runtimeLabel ?? attempt.deviceId },
        workingDirectory: { mode: "discover_at_session_start" },
      },
      causality: { replyToMessageIds: [String(task.sourceMessageId)], visibleThroughMessageId: String(task.sourceMessageId), liveDiscussion: null },
      command: { commandId, idempotencyKey: commandId, commandInputHash: stableInputHash(commandId), packetHash: "0".repeat(64), cancellationId: `cancel-${String(taskId)}` },
    }) as LocalRuntimeTurnPacket;
    packet.command.packetHash = await computeRuntimePacketHash(packet);
  return packet;
}
