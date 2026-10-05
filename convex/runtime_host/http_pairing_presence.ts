import type { ActionCtx } from "../_generated/server";
import { z } from "zod";
import {
  PairingClaimSchema,
  PairingGrantSchema,
  RuntimePresenceSchema,
  ShortPairingClaimSchema,
} from "./protocol_pairing";
import {
  jsonResponse,
  parseJson,
  publicRef,
  runtimeHostHeaders,
  withRuntimeHttpErrors,
} from "./http_common";

type PairingClaim = z.infer<typeof PairingClaimSchema>;
type PairingGrant = z.infer<typeof PairingGrantSchema>;
type Presence = z.infer<typeof RuntimePresenceSchema>;
type PresenceResult = { presenceId: string; serverTime: number; expiresAt: number };

const claimPairingRef = publicRef<"mutation", PairingClaim, PairingGrant>(
  "runtime_host/pairing:claimPairing",
);
const heartbeatRef = publicRef<
  "mutation",
  Presence & { credential: string },
  PresenceResult
>("runtime_host/presence:heartbeat");
const disconnectRef = publicRef<"mutation", {
  deviceId: string;
  credentialId: string;
  credential: string;
  presenceSessionId: string;
  reason: string;
  executionStopped?: boolean;
}, boolean>("runtime_host/presence:disconnect");

const presenceBodySchema = z.object({
  presenceSessionId: z.string().min(1),
}).passthrough();
const disconnectBodySchema = z.object({
  reason: z.string().min(1).max(500).default("host_closed"),
  executionStopped: z.boolean().optional(),
});

export async function claimPairingHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const claim = await parseJson(request, PairingClaimSchema);
    const grant = await ctx.runMutation(claimPairingRef, claim);
    return jsonResponse(grant);
  });
}

export async function claimShortPairingHttp(ctx: ActionCtx, request: Request): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const claim = await parseJson(request, ShortPairingClaimSchema);
    const grant = await ctx.runMutation(publicRef<"mutation", z.infer<typeof ShortPairingClaimSchema>, PairingGrant>(
      "runtime_host/short_pairing:claimShortPairing"), claim);
    return jsonResponse(grant);
  });
}

export async function heartbeatPresenceHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const host = runtimeHostHeaders(request);
    const body = await parseJson(request, presenceBodySchema);
    if (body.presenceSessionId !== host.presenceSessionId) {
      return jsonResponse({
        error: {
          code: "UNAUTHORIZED",
          message: "Presence session header does not match the heartbeat payload",
        },
      }, 401);
    }
    const presence: Presence = RuntimePresenceSchema.parse({
      ...body,
      deviceId: host.deviceId,
      credentialId: host.credentialId,
    });
    const result = await ctx.runMutation(heartbeatRef, {
      ...presence,
      credential: host.credential,
    });
    return jsonResponse(result);
  });
}

export async function disconnectPresenceHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const host = runtimeHostHeaders(request);
    const body = await parseJson(request, disconnectBodySchema);
    const changed = await ctx.runMutation(disconnectRef, { ...host, ...body });
    return jsonResponse({ changed });
  });
}
