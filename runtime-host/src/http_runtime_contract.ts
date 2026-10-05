import { z } from "zod";

import {
  LocalRuntimeTurnPacketSchema,
  RUNTIME_LIMITS,
  RUNTIME_PROTOCOL_VERSION,
  WorkerToHostMessageSchema,
  type LocalRuntimeTurnPacket,
} from "./protocol.ts";
import { verifyPacketIntegrity } from "./packet_integrity.ts";

export const PAIRING_PROTOCOL_VERSION = "nanthai.runtime.pairing.v1" as const;

export const PairingGrantSchema = z.strictObject({
  protocolVersion: z.literal(PAIRING_PROTOCOL_VERSION),
  pairingId: z.string().min(1),
  deviceId: z.string().min(1),
  credentialId: z.string().min(1),
  credential: z.string().min(1),
  issuedAt: z.number().int().nonnegative(),
});

export const PresenceResponseSchema = z.strictObject({
  presenceId: z.string().min(1),
  serverTime: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});

const CommandSchema = z.strictObject({
  commandRecordId: z.string().min(1),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  fence: z.number().int().positive(),
  commandId: z.string().min(1),
  type: z.enum([
    "start", "prompt", "steer", "cancel", "resume", "interrupt",
    "permission_response", "shutdown",
  ]),
  authorizationSource: z.string().min(1),
  inputHash: z.string().min(1),
  payload: z.string().optional(),
  turnPacketId: z.string().min(1).optional(),
  expiresAt: z.number().int().nonnegative().optional(),
  createdAt: z.number().int().nonnegative(),
});

export const PollResponseSchema = z.strictObject({
  commands: z.array(CommandSchema).max(100),
  serverTime: z.number().int().nonnegative(),
});

export const ClaimResponseSchema = z.strictObject({
  claimed: z.boolean(),
  leaseExpiresAt: z.number().int().nonnegative().optional(),
  claimantId: z.string().min(1).optional(),
});

export const CompleteResponseSchema = z.strictObject({ changed: z.boolean() });
export const EventsResponseSchema = z.strictObject({
  acceptedEventIds: z.array(z.string().min(1)).max(100),
});
export const AttemptHeartbeatResponseSchema = z.strictObject({
  leaseExpiresAt: z.number().int().nonnegative(),
});
export const AttemptSettleResponseSchema = z.strictObject({ settled: z.literal(true) });

export const ClaimedCommandPayloadSchema = z.strictObject({
  type: CommandSchema.shape.type,
  authorizationSource: z.string().min(1),
  inputHash: z.string().min(1),
  rawPayload: z.string().nullable(),
  turnPacketId: z.string().min(1).nullable(),
  packet: LocalRuntimeTurnPacketSchema.nullable(),
  packetSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  packetError: z.string().min(1).max(2_000).nullable(),
});

export type RemoteCommand = z.infer<typeof CommandSchema>;
export type ClaimedCommandPayload = z.infer<typeof ClaimedCommandPayloadSchema>;

const HostFailureSchema = z.strictObject({ message: z.string().min(1).max(2_000) });
const IdentifierSchema = z.string().min(1).max(256);
const ModelDiscoveryRequestSchema = z.strictObject({
  requestId: IdentifierSchema,
  adapterId: IdentifierSchema,
  expiresAt: z.number().int().nonnegative(),
});
const ModelDescriptorSchema = z.strictObject({
  provider: IdentifierSchema.nullable(),
  modelId: IdentifierSchema,
  displayName: z.string().min(1).max(512),
  availability: z.enum(["available", "unavailable"]),
  unavailableReason: z.string().min(1).max(2_000).nullable(),
  inputModalities: z.array(z.enum([
    "text", "image", "audio", "video", "document", "file", "tool_evidence",
  ])).min(1).max(7),
  supportsTools: z.boolean(),
  supportsReasoning: z.boolean(),
});

export const ModelDiscoveryPollResponseSchema = z.strictObject({
  requests: z.array(ModelDiscoveryRequestSchema).max(10),
  serverTime: z.number().int().nonnegative(),
});

export const ModelDiscoveryCompletionSchema = z.discriminatedUnion("status", [
  z.strictObject({
    requestId: IdentifierSchema,
    status: z.literal("completed"),
    models: z.array(ModelDescriptorSchema).max(RUNTIME_LIMITS.maxModels),
  }),
  z.strictObject({
    requestId: IdentifierSchema,
    status: z.literal("failed"),
    errorCode: IdentifierSchema,
    errorMessage: z.string().min(1).max(2_000),
  }),
]);

export type RemoteModelDiscoveryRequest = z.infer<typeof ModelDiscoveryRequestSchema>;

export const RawRuntimeEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    eventId: IdentifierSchema,
    commandRecordId: IdentifierSchema,
    commandId: IdentifierSchema,
    runId: IdentifierSchema,
    attemptId: IdentifierSchema,
    fence: z.number().int().positive(),
    kind: z.literal("worker_message"),
    emittedAtMs: z.number().int().nonnegative(),
    payload: WorkerToHostMessageSchema,
  }),
  z.strictObject({
    eventId: IdentifierSchema,
    commandRecordId: IdentifierSchema,
    commandId: IdentifierSchema,
    runId: IdentifierSchema,
    attemptId: IdentifierSchema,
    fence: z.number().int().positive(),
    kind: z.literal("host_command_failed"),
    emittedAtMs: z.number().int().nonnegative(),
    payload: HostFailureSchema,
  }),
]);

export function decodeRuntimePacket(bytes: Uint8Array, headerHash: string): LocalRuntimeTurnPacket {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("Runtime packet endpoint returned invalid JSON bytes");
  }
  const packet = verifyPacketIntegrity(raw);
  if (packet.protocolVersion !== RUNTIME_PROTOCOL_VERSION
    || packet.command.packetHash !== normalizeEtag(headerHash)) {
    throw new Error("Runtime packet response hash does not match its canonical envelope");
  }
  return packet;
}

function normalizeEtag(value: string): string {
  return value.trim().replace(/^W\//, "").replace(/^"|"$/g, "");
}
