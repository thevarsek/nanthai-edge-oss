import type { LocalRuntimeTurnPacket } from "./protocol_packet";
import type { HostToWorkerMessage } from "./protocol_process";

type SessionSeedMessage = Extract<
  HostToWorkerMessage,
  { kind: "start_session_request" | "resume_request" }
>;
type SendTurnMessage = Extract<HostToWorkerMessage, { kind: "send_turn_request" }>;

export function packetSeedReference(packet: LocalRuntimeTurnPacket): {
  commandId: string;
  packetHash: string;
} {
  return {
    commandId: packet.command.commandId,
    packetHash: packet.command.packetHash,
  };
}

export function sendTurnReferencesPacketSeed(
  sessionSeed: SessionSeedMessage,
  sendTurn: SendTurnMessage,
): boolean {
  const reference = packetSeedReference(
    sessionSeed.payload.packetSeed as LocalRuntimeTurnPacket,
  );
  return sendTurn.payload.commandId === reference.commandId
    && sendTurn.payload.packetHash === reference.packetHash;
}
