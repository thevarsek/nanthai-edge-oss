import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import { z } from "zod";
import { AdapterModelDescriptorSchema } from "./protocol_adapter";
import {
  IdentifierSchema,
  RUNTIME_LIMITS,
  SummarySchema,
} from "./protocol_common";
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

type ClaimedRequest = {
  requestId: Id<"runtimeModelDiscoveryRequests">;
  adapterId: string;
  expiresAt: number;
};

type CompletionArgs = CredentialArgs & {
  requestId: Id<"runtimeModelDiscoveryRequests">;
  status: "completed" | "failed";
  models?: z.infer<typeof AdapterModelDescriptorSchema>[];
  errorCode?: string;
  errorMessage?: string;
};

const claimPendingRef = publicRef<
  "mutation",
  CredentialArgs,
  ClaimedRequest[]
>("runtime_host/model_discovery_host:claimPendingForHost");

const completeRef = publicRef<
  "mutation",
  CompletionArgs,
  boolean
>("runtime_host/model_discovery_host:completeForHost");

const emptyBodySchema = z.strictObject({});
const completionBodySchema = z.discriminatedUnion("status", [
  z.strictObject({
    requestId: IdentifierSchema,
    status: z.literal("completed"),
    models: z.array(AdapterModelDescriptorSchema).max(RUNTIME_LIMITS.maxModels),
  }),
  z.strictObject({
    requestId: IdentifierSchema,
    status: z.literal("failed"),
    errorCode: IdentifierSchema,
    errorMessage: SummarySchema,
  }),
]);

export async function pollModelDiscoveryHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const host = runtimeHostHeaders(request);
    await parseJson(request, emptyBodySchema);
    const requests = await ctx.runMutation(claimPendingRef, host);
    return jsonResponse({ requests, serverTime: Date.now() });
  });
}

export async function completeModelDiscoveryHttp(
  ctx: ActionCtx,
  request: Request,
): Promise<Response> {
  return await withRuntimeHttpErrors(async () => {
    const host = runtimeHostHeaders(request);
    const body = await parseJson(request, completionBodySchema);
    const changed = await ctx.runMutation(completeRef, {
      ...host,
      ...body,
      requestId: body.requestId as Id<"runtimeModelDiscoveryRequests">,
    });
    return jsonResponse({ changed });
  });
}

