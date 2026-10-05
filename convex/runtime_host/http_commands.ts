import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { z } from "zod";
import {
  jsonResponse,
  parseJson,
  publicRef,
  runtimeHostHeaders,
  withRuntimeHttpErrors,
} from "./http_common";

type CredentialArgs = {
  deviceId: string;
  credentialId: string;
  credential: string;
  presenceSessionId: string;
};

type CommandProjection = {
  commandRecordId: Id<"runtimeCommands">;
  runId: Id<"executionRuns">;
  attemptId: Id<"executionAttempts">;
  fence: number;
  commandId: string;
  type: string;
  authorizationSource: string;
  inputHash: string;
  payload?: string;
  turnPacketId?: Id<"runtimeTurnPackets">;
  expiresAt?: number;
  createdAt: number;
};

const listPendingRef = publicRef<
  "query",
  CredentialArgs,
  CommandProjection[]
>("runtime_host/host_commands:listPending");
const claimRef = publicRef<"mutation", CredentialArgs & {
  commandRecordId: Id<"runtimeCommands">;
}, { claimed: boolean; leaseExpiresAt?: number; claimantId?: string }>(
  "runtime_host/host_commands:claim",
);
const completeRef = publicRef<"mutation", CredentialArgs & {
  commandRecordId: Id<"runtimeCommands">;
  status: "completed" | "rejected";
  rejectionReason?: string;
}, boolean>("runtime_host/host_commands:complete");
const packetRef = publicRef<"query", CredentialArgs & {
  turnPacketId: Id<"runtimeTurnPackets">;
}, {
  storageId: Id<"_storage">;
  packetHash: string;
  byteLength: number;
  expiresAt: number;
} | null>("runtime_host/turn_packets:getForHost");

const claimBodySchema = z.object({ commandRecordId: z.string().min(1) });
const completeBodySchema = z.object({
  commandRecordId: z.string().min(1),
  status: z.enum(["completed", "rejected"]),
  rejectionReason: z.string().min(1).max(2_000).optional(),
});

export async function pollCommandsHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const host = runtimeHostHeaders(request);
    const commands = await ctx.runQuery(listPendingRef, host);
    return jsonResponse({ commands, serverTime: Date.now() });
  });
}

export async function claimCommandHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const host = runtimeHostHeaders(request);
    const body = await parseJson(request, claimBodySchema);
    const result = await ctx.runMutation(claimRef, {
      ...host,
      commandRecordId: body.commandRecordId as Id<"runtimeCommands">,
    });
    return jsonResponse(result);
  });
}

export async function completeCommandHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const host = runtimeHostHeaders(request);
    const body = await parseJson(request, completeBodySchema);
    const changed = await ctx.runMutation(completeRef, {
      ...host,
      commandRecordId: body.commandRecordId as Id<"runtimeCommands">,
      status: body.status,
      ...(body.rejectionReason === undefined
        ? {}
        : { rejectionReason: body.rejectionReason }),
    });
    return jsonResponse({ changed });
  });
}

export async function fetchRuntimePacketHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const host = runtimeHostHeaders(request);
    const packetId = new URL(request.url).searchParams.get("packetId")?.trim();
    if (!packetId) {
      return jsonResponse({
        error: { code: "VALIDATION_ERROR", message: "packetId is required" },
      }, 400);
    }
    const packet = await ctx.runQuery(packetRef, {
      ...host,
      turnPacketId: packetId as Id<"runtimeTurnPackets">,
    });
    if (!packet) {
      return jsonResponse({
        error: { code: "NOT_FOUND", message: "Runtime turn packet is unavailable" },
      }, 404);
    }
    const blob = await ctx.storage.get(packet.storageId);
    if (!blob || blob.size !== packet.byteLength) {
      return jsonResponse({
        error: {
          code: "RUNTIME_PACKET_INVALID",
          message: "Runtime turn packet storage does not match its envelope",
        },
      }, 409);
    }
    return new Response(blob, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Length": String(packet.byteLength),
        "Content-Type": "application/json",
        ETag: `"${packet.packetHash}"`,
        "X-NanthAI-Packet-SHA256": packet.packetHash,
        "X-NanthAI-Packet-Expires-At": String(packet.expiresAt),
      },
    });
  });
}
