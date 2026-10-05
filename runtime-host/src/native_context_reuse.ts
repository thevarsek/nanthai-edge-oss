import type { LocalRuntimeTurnPacket } from "./protocol.ts";
import { computePacketHash } from "./packet_integrity.ts";

export type NativeReuse = { expectedNativeTurnId?: string | undefined; deliveredMessageIds?: string[] | undefined };
export function undeliveredPacket(packet: LocalRuntimeTurnPacket, deliveredIds: readonly string[]): LocalRuntimeTurnPacket {
  const delivered = new Set(deliveredIds);
  const messages = packet.messages.filter((message) => !delivered.has(message.messageId));
  if (!messages.some((message) => message.messageId === packet.sourceMessageId)) {
    messages.push({
      ordinal: messages.length, messageId: packet.sourceMessageId, role: "user", name: null, participantId: null,
      content: [{ type: "text", partId: "continue-turn", text: "Continue the NanthAI task using the newly supplied context. Do not repeat prior contributions." }],
    });
  }
  const result = { ...packet, messages: messages.map((message, ordinal) => ({ ...message, ordinal })), command: { ...packet.command } };
  result.command.packetHash = computePacketHash(result);
  return result;
}
