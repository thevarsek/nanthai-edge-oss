import type { z } from "zod";
import {
  type AdapterCapabilities,
  AdapterCapabilitiesSchema,
} from "./protocol_adapter";
import {
  type RuntimeInputModality,
  type LocalRuntimeTurnPacket,
  LocalRuntimeTurnPacketSchema,
  type RuntimeTurnPacket,
  RuntimeTurnPacketSchema,
} from "./protocol_packet";

export class RuntimeContractValidationError extends Error {
  readonly code: string;
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(code: string, message: string, issues: readonly z.core.$ZodIssue[] = []) {
    super(message);
    this.name = "RuntimeContractValidationError";
    this.code = code;
    this.issues = issues;
  }
}

export function parseRuntimeTurnPacket(input: unknown): RuntimeTurnPacket {
  const result = RuntimeTurnPacketSchema.safeParse(input);
  if (!result.success) {
    throw new RuntimeContractValidationError(
      "INVALID_RUNTIME_TURN_PACKET",
      "Runtime turn packet does not match nanthai.runtime.v1",
      result.error.issues,
    );
  }
  return result.data;
}

export function packetRequiredModalities(
  packet: RuntimeTurnPacket,
): RuntimeInputModality[] {
  const modalities = new Set<RuntimeInputModality>();
  for (const message of packet.messages) {
    for (const part of message.content) modalities.add(part.type);
  }
  return [...modalities];
}

export function assertAdapterSupportsPacket(
  packet: LocalRuntimeTurnPacket,
  capabilitiesInput: AdapterCapabilities | unknown,
): AdapterCapabilities {
  const capabilities = AdapterCapabilitiesSchema.parse(capabilitiesInput);
  if (capabilities.adapterId !== packet.placement.adapter.adapterId) {
    throw new RuntimeContractValidationError(
      "ADAPTER_PLACEMENT_MISMATCH",
      `Packet selects ${packet.placement.adapter.adapterId}, not ${capabilities.adapterId}`,
    );
  }
  const selectedVersion = packet.placement.adapter.adapterVersion;
  if (selectedVersion !== null && selectedVersion !== capabilities.adapterVersion) {
    throw new RuntimeContractValidationError(
      "ADAPTER_VERSION_MISMATCH",
      `Packet selects adapter version ${selectedVersion}, not ${capabilities.adapterVersion}`,
    );
  }
  const supported = new Set(capabilities.inputModalities);
  const unsupported = packetRequiredModalities(packet)
    .filter((modality) => !supported.has(modality));
  if (unsupported.length > 0) {
    throw new RuntimeContractValidationError(
      "UNSUPPORTED_RUNTIME_MODALITY",
      `Adapter ${capabilities.adapterId} cannot accept: ${unsupported.join(", ")}`,
    );
  }
  return capabilities;
}

export function buildRuntimeTurnPacket(input: unknown): RuntimeTurnPacket {
  return parseRuntimeTurnPacket(input);
}

export function buildLocalRuntimeTurnPacket(
  input: unknown,
  capabilities: AdapterCapabilities | unknown,
): LocalRuntimeTurnPacket {
  const packet = LocalRuntimeTurnPacketSchema.parse(
    parseRuntimeTurnPacket(input),
  ) as LocalRuntimeTurnPacket;
  assertAdapterSupportsPacket(packet, capabilities);
  return packet;
}
