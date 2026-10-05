import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { authenticateOnlineRuntimeHost } from "./host_session_auth";
import { eligibleModelDiscoveryAdapter } from "./model_discovery_common";
import {
  runtimeModelDescriptorInput,
  type RuntimeModelDescriptorInput,
} from "./model_discovery_contract";
import {
  expireModelDiscoveryRequestHandler,
  MODEL_DISCOVERY_RESULT_TTL_MS,
  scheduleModelDiscoveryExpiry,
} from "./model_discovery_expiry";
import {
  AdapterModelDescriptorSchema,
} from "./protocol_adapter";
import {
  IdentifierSchema,
  RUNTIME_LIMITS,
  SummarySchema,
} from "./protocol_common";
import { runtimeHostError, sha256Hex } from "./security";

const MAX_DISCOVERY_POLL_BATCH = 10;

const credentialArgs = {
  deviceId: v.string(),
  credentialId: v.string(),
  credential: v.string(),
  presenceSessionId: v.string(),
};

const claimedRequest = v.object({
  requestId: v.id("runtimeModelDiscoveryRequests"),
  adapterId: v.string(),
  expiresAt: v.number(),
});

type CredentialArgs = {
  deviceId: string;
  credentialId: string;
  credential: string;
  presenceSessionId: string;
};

export async function claimPendingForHostHandler(
  ctx: MutationCtx,
  args: CredentialArgs & { now?: number },
): Promise<Array<{
  requestId: Id<"runtimeModelDiscoveryRequests">;
  adapterId: string;
  expiresAt: number;
}>> {
  const now = args.now ?? Date.now();
  const host = await authenticateOnlineRuntimeHost(ctx, args, now);
  assertCurrentPresenceCredential(host);
  const pending = await ctx.db.query("runtimeModelDiscoveryRequests")
    .withIndex("by_device_presence_status", (queryBuilder) =>
      queryBuilder.eq("runtimeDeviceId", host.device._id)
        .eq("presenceSessionId", host.presence.presenceSessionId)
        .eq("status", "pending")
    )
    .order("asc")
    .take(MAX_DISCOVERY_POLL_BATCH);
  const claimed: Array<{
    requestId: Id<"runtimeModelDiscoveryRequests">;
    adapterId: string;
    expiresAt: number;
  }> = [];
  for (const request of pending) {
    if (!matchesCurrentHost(request, host)) continue;
    if (request.expiresAt <= now) {
      await expireModelDiscoveryRequestHandler(ctx, {
        requestId: request._id,
        expectedExpiresAt: request.expiresAt,
        now,
      });
      continue;
    }
    if (!eligibleModelDiscoveryAdapter(
      host.presence,
      request.adapterId,
      request.adapterVersion,
    )) {
      await failDiscoveryRequest(
        ctx,
        request,
        "RUNTIME_ADAPTER_UNAVAILABLE",
        "Selected adapter cannot currently list its available models",
        now,
      );
      continue;
    }
    await ctx.db.patch(request._id, {
      status: "claimed",
      claimedBy: host.claimantId,
      claimedAt: now,
      updatedAt: now,
    });
    claimed.push({
      requestId: request._id,
      adapterId: request.adapterId,
      expiresAt: request.expiresAt,
    });
  }
  if (claimed.length > 0) {
    await ctx.db.patch(host.credential._id, { lastUsedAt: now });
  }
  return claimed;
}

export const claimPendingForHost = mutation({
  args: credentialArgs,
  returns: v.array(claimedRequest),
  handler: async (ctx, args) => await claimPendingForHostHandler(ctx, args),
});

type CompletionArgs = CredentialArgs & {
  requestId: Id<"runtimeModelDiscoveryRequests">;
  status: "completed" | "failed";
  models?: RuntimeModelDescriptorInput[];
  errorCode?: string;
  errorMessage?: string;
  now?: number;
};

export async function completeForHostHandler(
  ctx: MutationCtx,
  args: CompletionArgs,
): Promise<boolean> {
  const now = args.now ?? Date.now();
  const host = await authenticateOnlineRuntimeHost(ctx, args, now);
  assertCurrentPresenceCredential(host);
  const request = await ctx.db.get(args.requestId);
  if (!request || !matchesCurrentHost(request, host)) {
    throw runtimeHostError("NOT_FOUND", "Live model request not found");
  }
  const result = validateCompletion(args);
  const resultHash = await sha256Hex(JSON.stringify(result));
  if (request.status === "completed" || request.status === "failed") {
    if (request.resultHash === resultHash) return false;
    throw runtimeHostError("CONFLICT", "Live model request already has another result");
  }
  if (
    request.status !== "claimed"
    || request.claimedBy !== host.claimantId
    || request.expiresAt <= now
  ) {
    throw runtimeHostError("REQUEST_EXPIRED", "Live model request is no longer claimable");
  }
  const adapter = eligibleModelDiscoveryAdapter(
    host.presence,
    request.adapterId,
    request.adapterVersion,
  );
  if (!adapter) {
    await finishDiscoveryRequest(ctx, request, {
      resultHash,
      errorCode: "RUNTIME_ADAPTER_UNAVAILABLE",
      errorMessage: "Selected adapter cannot currently list its available models",
      now,
    });
    return true;
  }
  if (result.status === "completed") {
    for (let ordinal = 0; ordinal < result.models.length; ordinal += 1) {
      const model = result.models[ordinal];
      await ctx.db.insert("runtimeModelDiscoveryModels", {
        userId: request.userId,
        requestId: request._id,
        ordinal,
        provider: model.provider ?? undefined,
        modelId: model.modelId,
        displayName: model.displayName,
        availability: model.availability,
        unavailableReason: model.unavailableReason ?? undefined,
        inputModalities: model.inputModalities,
        supportsTools: model.supportsTools,
        supportsReasoning: model.supportsReasoning,
        createdAt: now,
      });
    }
    await finishDiscoveryRequest(ctx, request, { resultHash, now });
  } else {
    await finishDiscoveryRequest(ctx, request, {
      resultHash,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      now,
    });
  }
  await ctx.db.patch(host.credential._id, { lastUsedAt: now });
  return true;
}

export const completeForHost = mutation({
  args: {
    ...credentialArgs,
    requestId: v.id("runtimeModelDiscoveryRequests"),
    status: v.union(v.literal("completed"), v.literal("failed")),
    models: v.optional(v.array(runtimeModelDescriptorInput)),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => await completeForHostHandler(ctx, args),
});

function validateCompletion(args: CompletionArgs):
  | { status: "completed"; models: RuntimeModelDescriptorInput[] }
  | { status: "failed"; errorCode: string; errorMessage: string } {
  if (args.status === "completed") {
    const parsed = AdapterModelDescriptorSchema.array()
      .max(RUNTIME_LIMITS.maxModels)
      .safeParse(args.models);
    if (!parsed.success || args.errorCode !== undefined || args.errorMessage !== undefined) {
      throw runtimeHostError("VALIDATION_ERROR", "Completed model discovery result is invalid");
    }
    return { status: "completed", models: parsed.data };
  }
  if (
    args.models !== undefined
    || !IdentifierSchema.safeParse(args.errorCode).success
    || !SummarySchema.safeParse(args.errorMessage).success
  ) {
    throw runtimeHostError("VALIDATION_ERROR", "Failed model discovery result is invalid");
  }
  return {
    status: "failed",
    errorCode: args.errorCode as string,
    errorMessage: args.errorMessage as string,
  };
}

async function finishDiscoveryRequest(
  ctx: MutationCtx,
  request: Doc<"runtimeModelDiscoveryRequests">,
  result: {
    resultHash: string;
    errorCode?: string;
    errorMessage?: string;
    now: number;
  },
): Promise<void> {
  const expiresAt = result.now + MODEL_DISCOVERY_RESULT_TTL_MS;
  await ctx.db.patch(request._id, {
    status: result.errorCode ? "failed" : "completed",
    resultHash: result.resultHash,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    expiresAt,
    completedAt: result.now,
    updatedAt: result.now,
  });
  await scheduleModelDiscoveryExpiry(ctx, request._id, expiresAt);
}

async function failDiscoveryRequest(
  ctx: MutationCtx,
  request: Doc<"runtimeModelDiscoveryRequests">,
  errorCode: string,
  errorMessage: string,
  now: number,
): Promise<void> {
  const resultHash = await sha256Hex(JSON.stringify({
    status: "failed",
    errorCode,
    errorMessage,
  }));
  await finishDiscoveryRequest(ctx, request, {
    resultHash,
    errorCode,
    errorMessage,
    now,
  });
}

function assertCurrentPresenceCredential(
  host: Awaited<ReturnType<typeof authenticateOnlineRuntimeHost>>,
): void {
  if (host.presence.credentialId !== host.credential.credentialId) {
    throw runtimeHostError("UNAUTHORIZED", "Runtime Host presence credential is stale");
  }
}

function matchesCurrentHost(
  request: Doc<"runtimeModelDiscoveryRequests">,
  host: Awaited<ReturnType<typeof authenticateOnlineRuntimeHost>>,
): boolean {
  return request.userId === host.device.userId
    && request.runtimeDeviceId === host.device._id
    && request.deviceId === host.device.deviceId
    && request.presenceId === host.presence._id
    && request.presenceSessionId === host.presence.presenceSessionId
    && request.credentialId === host.credential.credentialId;
}

