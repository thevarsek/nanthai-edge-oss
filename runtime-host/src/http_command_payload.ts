import type { HttpJsonClient } from "./http_json_client.ts";
import {
  decodeRuntimePacket,
  type ClaimedCommandPayload,
  type RemoteCommand,
} from "./http_runtime_contract.ts";

export async function fetchClaimedPayload(
  client: HttpJsonClient,
  command: RemoteCommand,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
): Promise<ClaimedCommandPayload> {
  const base = {
    type: command.type,
    authorizationSource: command.authorizationSource,
    inputHash: command.inputHash,
    rawPayload: command.payload ?? null,
    turnPacketId: command.turnPacketId ?? null,
  };
  if (command.turnPacketId === undefined) {
    return { ...base, packet: null, packetSha256: null, packetError: null };
  }
  try {
    const response = await client.getBytes(
      `/runtime-host/v1/packets/fetch?packetId=${encodeURIComponent(command.turnPacketId)}`,
      headers,
      signal,
    );
    const hash = response.headers.get("X-NanthAI-Packet-SHA256")
      ?? response.headers.get("ETag");
    if (hash === null) throw new Error("Runtime packet response omitted its SHA-256");
    const packet = decodeRuntimePacket(response.bytes, hash);
    return { ...base, packet, packetSha256: packet.command.packetHash, packetError: null };
  } catch (error) {
    return { ...base, packet: null, packetSha256: null, packetError: publicError(error) };
  }
}

function publicError(error: unknown): string {
  return error instanceof Error ? error.message : "Runtime packet could not be fetched";
}
