import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { assertModelDiscoveryAdapter } from "./model_discovery_common";
import {
  runtimeModelDescriptorResult,
  runtimeModelDiscoveryStatus,
} from "./model_discovery_contract";
import {
  MODEL_DISCOVERY_REQUEST_TTL_MS,
  scheduleModelDiscoveryExpiry,
} from "./model_discovery_expiry";
import { RUNTIME_LIMITS } from "./protocol_common";
import { runtimeHostError } from "./security";

const requestResult = v.object({
  requestId: v.id("runtimeModelDiscoveryRequests"),
  expiresAt: v.number(),
});

const discoveryResult = v.object({
  requestId: v.id("runtimeModelDiscoveryRequests"),
  deviceId: v.string(),
  adapterId: v.string(),
  status: runtimeModelDiscoveryStatus,
  models: v.array(runtimeModelDescriptorResult),
  error: v.union(v.object({ code: v.string(), message: v.string() }), v.null()),
  expiresAt: v.number(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export async function requestModelsHandler(
  ctx: MutationCtx,
  args: { userId: string; deviceId: string; adapterId: string; now?: number },
): Promise<{ requestId: Id<"runtimeModelDiscoveryRequests">; expiresAt: number }> {
  const now = args.now ?? Date.now();
  const device = await ctx.db.query("runtimeDevices")
    .withIndex("by_device_id", (queryBuilder) =>
      queryBuilder.eq("deviceId", args.deviceId)
    )
    .unique();
  if (!device || device.userId !== args.userId || device.status !== "active") {
    throw runtimeHostError("RUNTIME_UNAVAILABLE", "Selected paired machine is unavailable");
  }
  const presence = device.currentPresenceId
    ? await ctx.db.get(device.currentPresenceId)
    : null;
  if (
    !presence
    || presence.runtimeDeviceId !== device._id
    || presence.status !== "online"
    || presence.expiresAt <= now
  ) {
    throw runtimeHostError(
      "RUNTIME_RECONNECT_REQUIRED",
      "Reconnect the Runtime Host before choosing an explicit local model",
    );
  }
  const adapter = assertModelDiscoveryAdapter(presence, args.adapterId);
  const expiresAt = now + MODEL_DISCOVERY_REQUEST_TTL_MS;
  const requestId = await ctx.db.insert("runtimeModelDiscoveryRequests", {
    userId: args.userId,
    runtimeDeviceId: device._id,
    deviceId: device.deviceId,
    presenceId: presence._id,
    presenceSessionId: presence.presenceSessionId,
    credentialId: presence.credentialId,
    adapterId: adapter.adapterId,
    adapterVersion: adapter.adapterVersion,
    status: "pending",
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  await scheduleModelDiscoveryExpiry(ctx, requestId, expiresAt);
  return { requestId, expiresAt };
}

export const requestModels = mutation({
  args: { deviceId: v.string(), adapterId: v.string() },
  returns: requestResult,
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    return await requestModelsHandler(ctx, { userId, ...args });
  },
});

export async function getMyRequestHandler(
  ctx: QueryCtx,
  args: { userId: string; requestId: Id<"runtimeModelDiscoveryRequests"> },
) {
  const request = await ctx.db.get(args.requestId);
  if (!request || request.userId !== args.userId) return null;
  const models = request.status === "completed"
    ? await ctx.db.query("runtimeModelDiscoveryModels")
      .withIndex("by_request_ordinal", (queryBuilder) =>
        queryBuilder.eq("requestId", request._id)
      )
      .take(RUNTIME_LIMITS.maxModels)
    : [];
  return {
    requestId: request._id,
    deviceId: request.deviceId,
    adapterId: request.adapterId,
    status: request.status,
    models: models.map((model) => ({
      provider: model.provider ?? null,
      modelId: model.modelId,
      displayName: model.displayName,
      availability: model.availability,
      unavailableReason: model.unavailableReason ?? null,
      inputModalities: model.inputModalities,
      supportsTools: model.supportsTools,
      supportsReasoning: model.supportsReasoning,
    })),
    error: request.errorCode && request.errorMessage
      ? { code: request.errorCode, message: request.errorMessage }
      : null,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

export const getMyRequest = query({
  args: { requestId: v.id("runtimeModelDiscoveryRequests") },
  returns: v.union(discoveryResult, v.null()),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    return await getMyRequestHandler(ctx, { userId, ...args });
  },
});

