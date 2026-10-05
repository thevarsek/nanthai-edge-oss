import { createHash } from "node:crypto";

import {
  LocalRuntimeTurnPacketSchema,
  type LocalRuntimeTurnPacket,
} from "./protocol.ts";

export class PacketIntegrityError extends Error {
  constructor(readonly expected: string, readonly received: string) {
    super("Canonical runtime packet failed its SHA-256 integrity check");
    this.name = "PacketIntegrityError";
  }
}

export function packetCanonicalJson(packet: LocalRuntimeTurnPacket): string {
  const withoutDigest = {
    ...packet,
    command: omitPacketHash(packet.command),
  };
  return JSON.stringify(sortJson(withoutDigest));
}

export function computePacketHash(packet: LocalRuntimeTurnPacket): string {
  return createHash("sha256").update(packetCanonicalJson(packet)).digest("hex");
}

export function verifyPacketIntegrity(value: unknown): LocalRuntimeTurnPacket {
  const packet = LocalRuntimeTurnPacketSchema.parse(value) as LocalRuntimeTurnPacket;
  const expected = computePacketHash(packet);
  if (packet.command.packetHash !== expected) {
    throw new PacketIntegrityError(expected, packet.command.packetHash);
  }
  return packet;
}

function omitPacketHash(command: LocalRuntimeTurnPacket["command"]) {
  const { packetHash, ...rest } = command;
  void packetHash;
  return rest;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
