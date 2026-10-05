import { z } from "zod";

import type { RuntimeCommand } from "./control_plane.ts";
import type { HostMessageBody } from "./host_wire_sequencer.ts";
import {
  ClaimedCommandPayloadSchema,
  type ClaimedCommandPayload,
} from "./http_runtime_contract.ts";
import { verifyPacketIntegrity } from "./packet_integrity.ts";
import {
  PermissionDecisionSchema,
  StructuredInputSchema,
  type LocalRuntimeTurnPacket,
} from "./protocol.ts";

const ThreadNameSchema = z.string().min(1).max(512);
const StartPayloadSchema = z.strictObject({
  threadName: ThreadNameSchema,
});
const ResumePayloadSchema = z.strictObject({
  nativeSessionId: z.string().min(1).max(256),
  checkpointRef: z.string().min(1).max(256).nullable().optional(),
  expectedNativeTurnId: z.string().min(1).max(256).optional(),
  deliveredMessageIds: z.array(z.string().min(1).max(256)).max(512).optional(),
  threadName: ThreadNameSchema,
});
const CancellationPayloadSchema = z.strictObject({
  cancellationId: z.string().min(1).max(256),
  reason: z.string().min(1).max(2_000),
});
const PermissionPayloadSchema = z.strictObject({
  permissionRequestId: z.string().min(1).max(256),
  decision: PermissionDecisionSchema,
});
const InputPayloadSchema = z.strictObject({
  inputRequestId: z.string().min(1).max(256),
  response: z.discriminatedUnion("outcome", [
    z.strictObject({ outcome: z.literal("submitted"), content: StructuredInputSchema }),
    z.strictObject({ outcome: z.literal("cancelled"), content: z.null() }),
  ]),
});
const ShutdownPayloadSchema = z.strictObject({
  reason: z.string().min(1).max(2_000),
});

export type AtomicTurnPlan = {
  packet: LocalRuntimeTurnPacket;
  threadName: string;
  opening: HostMessageBody;
  sendTurn: HostMessageBody;
};

export function atomicTurnPlan(command: RuntimeCommand): AtomicTurnPlan {
  const payload = claimedPayload(command);
  if (payload.type !== "start" && payload.type !== "resume") {
    throw new Error(`Command ${payload.type} cannot open a Codex turn`);
  }
  if (payload.packetError !== null) throw new Error(payload.packetError);
  if (payload.turnPacketId === null || payload.packet === null) {
    throw new Error("Runtime turn command is missing its canonical packet");
  }
  const packet = verifyPacketIntegrity(payload.packet);
  requirePacketMatchesCommand(packet, command);
  const start = payload.type === "start"
    ? parseOpaque(payload.rawPayload, StartPayloadSchema, "start command")
    : null;
  const resume = payload.type === "resume"
    ? parseOpaque(payload.rawPayload, ResumePayloadSchema, "resume command")
    : null;
  const opening: HostMessageBody = resume !== null
    ? {
      kind: "resume_request",
      payload: {
        placement: packet.placement,
        packetSeed: packet,
        nativeSessionId: resume.nativeSessionId,
        checkpointRef: resume.checkpointRef ?? null,
        ...(resume.expectedNativeTurnId ? { expectedNativeTurnId: resume.expectedNativeTurnId } : {}),
        ...(resume.deliveredMessageIds ? { deliveredMessageIds: resume.deliveredMessageIds } : {}),
      },
    }
    : {
      kind: "start_session_request",
      payload: { placement: packet.placement, packetSeed: packet },
    };
  return {
    packet,
    threadName: resume?.threadName ?? requireStart(start).threadName,
    opening,
    sendTurn: {
      kind: "send_turn_request",
      payload: {
        sessionId: packet.attemptId,
        commandId: packet.command.commandId,
        packetHash: packet.command.packetHash,
      },
    },
  };
}

function requireStart(value: z.infer<typeof StartPayloadSchema> | null) {
  if (value === null) throw new Error("start command is missing its command payload");
  return value;
}

export function followupPlan(
  command: RuntimeCommand,
): HostMessageBody {
  const payload = claimedPayload(command);
  switch (payload.type) {
    case "cancel":
    case "interrupt": {
      const parsed = parseOpaque(payload.rawPayload, CancellationPayloadSchema, payload.type);
      return { kind: "cancel_request", payload: { sessionId: command.attemptId, ...parsed } };
    }
    case "permission_response": {
      const parsed = parseOpaque(payload.rawPayload, PermissionPayloadSchema, payload.type);
      return {
        kind: "permission_response_request",
        payload: { sessionId: command.attemptId, ...parsed },
      };
    }
    case "prompt": {
      const parsed = parseOpaque(payload.rawPayload, InputPayloadSchema, payload.type);
      return {
        kind: "input_response_request",
        payload: { sessionId: command.attemptId, ...parsed },
      };
    }
    case "shutdown": {
      const parsed = parseOpaque(payload.rawPayload, ShutdownPayloadSchema, payload.type);
      return { kind: "close_request", payload: { sessionId: command.attemptId, ...parsed } };
    }
    case "start":
    case "resume": throw new Error(`${payload.type} must open a new attempt worker`);
    case "steer": throw new Error("Codex App Server steering is not mapped in runtime protocol v1");
  }
}

function claimedPayload(command: RuntimeCommand): ClaimedCommandPayload {
  const payload = ClaimedCommandPayloadSchema.parse(command.payload);
  if (payload.type !== command.kind) {
    throw new Error("Runtime command kind does not match its claimed transport payload");
  }
  return payload;
}

function requirePacketMatchesCommand(
  packet: LocalRuntimeTurnPacket,
  command: RuntimeCommand,
): void {
  if (packet.runId !== command.runId || packet.attemptId !== command.attemptId
    || packet.fence !== command.fence || packet.command.commandId !== command.commandId) {
    throw new Error("Canonical packet identity does not match its claimed runtime command");
  }
}

function parseOpaque<T>(
  rawPayload: string | null,
  schema: z.ZodType<T>,
  label: string,
): T {
  if (rawPayload === null) throw new Error(`${label} is missing its command payload`);
  try {
    return schema.parse(JSON.parse(rawPayload) as unknown);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} payload is not valid JSON`);
    throw error;
  }
}
