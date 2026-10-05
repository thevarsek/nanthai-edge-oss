import {
  LocalRuntimeTurnPacketSchema,
  type LocalRuntimeTurnPacket,
  type RuntimeContentPart,
} from "../../src/protocol.ts";
import { computePacketHash } from "../../src/packet_integrity.ts";

const HASH = "a".repeat(64);

export function runtimePacket(
  content: RuntimeContentPart[] = [
    { type: "text", partId: "part-1", text: "Hello from NanthAI" },
  ],
): LocalRuntimeTurnPacket {
  const packet = LocalRuntimeTurnPacketSchema.parse({
    protocolVersion: "nanthai.runtime.v1",
    runId: "run-1",
    attemptId: "attempt-1",
    fence: 1,
    chatId: "chat-1",
    sourceMessageId: "message-1",
    participantId: "participant-1",
    personaId: "persona-1",
    messages: [{
      ordinal: 0,
      messageId: "message-1",
      role: "user",
      name: "Dino",
      participantId: null,
      content,
    }],
    instructions: {
      system: [{
        instructionId: "system-1",
        name: "System",
        text: "Be useful",
        sourceHash: HASH,
      }],
      persona: [],
    },
    context: {
      assemblerVersion: "context-v1",
      canonicalHeadMessageId: "message-1",
      references: [],
      omissions: [],
      omittedPartCount: 0,
    },
    capabilities: {
      nanthaiTools: [],
      skills: [],
      integrations: [],
      adapterNativePolicy: "preserve",
    },
    placement: {
      protocolVersion: "nanthai.runtime.v1",
      runId: "run-1",
      attemptId: "attempt-1",
      fence: 1,
      placement: "local",
      executorKind: "local_runtime",
      orchestrationEngine: "runtime_adapter",
      device: { deviceId: "device-1", displayName: "Dino Mac" },
      adapter: { adapterId: "codex", adapterVersion: "0.147.0" },
      selectedModel: { mode: "adapter_default", provider: null, modelId: null },
      workingDirectory: { mode: "discover_at_session_start" },
    },
    causality: {
      replyToMessageIds: [],
      visibleThroughMessageId: "message-1",
      liveDiscussion: null,
    },
    command: {
      commandId: "command-1",
      idempotencyKey: "idempotency-1",
      commandInputHash: "1234abcd",
      packetHash: HASH,
      cancellationId: "cancel-1",
    },
  });
  packet.command.packetHash = computePacketHash(packet as LocalRuntimeTurnPacket);
  return LocalRuntimeTurnPacketSchema.parse(packet) as LocalRuntimeTurnPacket;
}

export function fetchedPartBase() {
  return {
    partId: "part-1",
    name: "attachment",
    fetch: {
      handle: "opaque-fetch-handle",
      expiresAt: Date.now() + 60_000,
      byteLength: 10,
      maxChunkBytes: 10,
      sha256: HASH,
    },
  };
}
