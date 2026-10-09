import { sourceEvidencePrompt } from "../chat/source_evidence";
import { BRIDGE_TOOLS } from "./bridge_contract";
import { contextDigest } from "./context_receipt";
import type { PreparedParticipantTurn } from "../chat/prepared_participant_turn";
import { stableInputHash } from "../execution/commands";
import { RUNTIME_PROTOCOL_VERSION } from "./protocol_common";
import type { LocalRuntimePlacement } from "./protocol_placement";
import {
  LocalRuntimeTurnPacketSchema,
  type LocalRuntimeTurnPacket,
} from "./protocol_packet";
import {
  materializeRuntimeMessages,
  runtimePacketInstruction,
  type RuntimeImageSource,
} from "./production_packet_content";

export { RuntimePacketMaterializationError } from "./production_packet_content";
export type { RuntimeImageSource } from "./production_packet_content";

export interface ProductionPacketInput {
  runId: string;
  attemptId: string;
  fence: number;
  chatId: string;
  sourceMessageId: string;
  sourceImages?: RuntimeImageSource[];
  participantId: string;
  participantName: string;
  personaId: string;
  personaPrompt?: string | null;
  preparedTurn: PreparedParticipantTurn;
  placement: LocalRuntimePlacement;
  commandId: string;
  idempotencyKey: string;
  cancellationId: string;
  includeSourceEvidence?: boolean;
  webSearchEnabled?: boolean;
  moderatorDirective?: string;
}

export async function buildProductionRuntimePacket(
  input: ProductionPacketInput,
): Promise<LocalRuntimeTurnPacket> {
  const { messages, systemInstructions } = await materializeRuntimeMessages(input);
  if (input.moderatorDirective?.trim()) systemInstructions.push(await runtimePacketInstruction("moderator", "Discussion coaching", input.moderatorDirective.trim()));
  const evidenceSources = input.includeSourceEvidence ? input.preparedTurn.evidenceSources ?? [] : [];
  const evidencePrompt = sourceEvidencePrompt(evidenceSources);
  if (evidencePrompt) systemInstructions.push(await runtimePacketInstruction("sources", "Supporting sources", evidencePrompt));
  const personaInstructions = input.personaPrompt?.trim()
    ? [await runtimePacketInstruction(
        "persona",
        input.participantName,
        input.personaPrompt.trim(),
      )]
    : [];
  const omissions = Object.entries(input.preparedTurn.context.omissionCounts)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => ({
      sourceId: null,
      kind: omissionKind(reason),
      omittedPartCount: count,
      reason,
    }));
  const withoutHash = {
    protocolVersion: RUNTIME_PROTOCOL_VERSION,
    runId: input.runId,
    attemptId: input.attemptId,
    fence: input.fence,
    chatId: input.chatId,
    sourceMessageId: input.sourceMessageId,
    participantId: input.participantId,
    personaId: input.personaId,
    messages,
    instructions: {
      system: systemInstructions,
      persona: personaInstructions,
    },
    context: {
      ...(input.includeSourceEvidence ? { evidenceSources } : {}),
      assemblerVersion: input.preparedTurn.context.assemblerVersion,
      canonicalHeadMessageId: input.sourceMessageId,
      references: [
        ...input.preparedTurn.context.artifactIds.map((id) => ({
          id: String(id), kind: "artifact" as const, version: null,
        })),
        ...input.preparedTurn.context.memoryIds.map((id) => ({
          id: String(id), kind: "memory" as const, version: null,
        })),
      ],
      omissions,
      omittedPartCount: omissions.reduce(
        (total, omission) => total + omission.omittedPartCount,
        0,
      ),
    },
    capabilities: {
      ...(input.webSearchEnabled ? { webSearch: "live" as const } : {}),
      nanthaiTools: await Promise.all(BRIDGE_TOOLS.filter(tool => tool.name !== "nanthai_update_collaboration_work"
        || input.preparedTurn.providerMessages.some(message => typeof message.content === "string" && message.content.startsWith("[Assigned Collaboration work]"))).map(async (tool) => ({
        id: tool.name, name: tool.name, version: "1", effect: tool.name === "nanthai_read_context" ? "read" : "write",
        inputSchemaHash: await contextDigest(tool.inputSchema),
      }))),
      skills: [],
      integrations: [],
      adapterNativePolicy: "preserve" as const,
    },
    placement: input.placement,
    causality: {
      replyToMessageIds: input.preparedTurn.causality?.replyToMessageIds.map(String)
        ?? [input.sourceMessageId],
      visibleThroughMessageId: input.sourceMessageId,
      liveDiscussion: input.preparedTurn.causality
        ? {
            discussionId: String(input.preparedTurn.causality.exchangeId),
            waveId: String(input.preparedTurn.causality.decisionId),
            waveNumber: input.preparedTurn.causality.wave,
            sameWaveParticipantIds: [],
          }
        : null,
    },
    command: {
      commandId: input.commandId,
      idempotencyKey: input.idempotencyKey,
      commandInputHash: stableInputHash(
        `${input.commandId}\n${input.idempotencyKey}\n${input.attemptId}\n${input.fence}`,
      ),
      packetHash: "0".repeat(64),
      cancellationId: input.cancellationId,
    },
  };
  const packet = withoutHash as LocalRuntimeTurnPacket;
  packet.command.packetHash = await computeRuntimePacketHash(packet);
  return LocalRuntimeTurnPacketSchema.parse(packet) as LocalRuntimeTurnPacket;
}

export async function computeRuntimePacketHash(
  packet: LocalRuntimeTurnPacket,
): Promise<string> {
  const { packetHash: _packetHash, ...command } = packet.command;
  return await sha256Hex(canonicalJson({ ...packet, command }));
}

function omissionKind(reason: string): "budget" | "policy" | "deduplicated" {
  if (/budget|cap/i.test(reason)) return "budget";
  if (/duplicate/i.test(reason)) return "deduplicated";
  return "policy";
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, sortJson(record[key])]),
    );
  }
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
