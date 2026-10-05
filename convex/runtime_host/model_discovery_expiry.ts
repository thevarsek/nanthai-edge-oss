import {
  makeFunctionReference,
  type FunctionReference,
} from "convex/server";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";
import { RUNTIME_LIMITS } from "./protocol_common";

export const MODEL_DISCOVERY_REQUEST_TTL_MS = 120_000;
export const MODEL_DISCOVERY_RESULT_TTL_MS = 120_000;
export const MODEL_DISCOVERY_EXPIRED_VISIBILITY_MS = 60_000;

export type ExpireModelDiscoveryArgs = {
  requestId: Id<"runtimeModelDiscoveryRequests">;
  expectedExpiresAt: number;
};

export const expireModelDiscoveryRef = makeFunctionReference<
  "mutation",
  ExpireModelDiscoveryArgs,
  boolean
>("runtime_host/model_discovery_expiry:expireRequest") as unknown as FunctionReference<
  "mutation",
  "internal",
  ExpireModelDiscoveryArgs,
  boolean
>;

export async function scheduleModelDiscoveryExpiry(
  ctx: Pick<MutationCtx, "scheduler">,
  requestId: Id<"runtimeModelDiscoveryRequests">,
  expiresAt: number,
): Promise<void> {
  await ctx.scheduler.runAt(expiresAt, expireModelDiscoveryRef, {
    requestId,
    expectedExpiresAt: expiresAt,
  });
}

export async function expireModelDiscoveryRequestHandler(
  ctx: MutationCtx,
  args: ExpireModelDiscoveryArgs & { now?: number },
): Promise<boolean> {
  const request = await ctx.db.get(args.requestId);
  const now = args.now ?? Date.now();
  if (
    !request
    || request.expiresAt !== args.expectedExpiresAt
    || request.expiresAt > now
  ) return false;

  const models = await ctx.db.query("runtimeModelDiscoveryModels")
    .withIndex("by_request_ordinal", (query) =>
      query.eq("requestId", request._id)
    )
    .take(RUNTIME_LIMITS.maxModels);
  for (const model of models) await ctx.db.delete(model._id);

  if (request.status === "pending" || request.status === "claimed") {
    const purgeAt = now + MODEL_DISCOVERY_EXPIRED_VISIBILITY_MS;
    await ctx.db.patch(request._id, {
      status: "expired",
      errorCode: "REQUEST_EXPIRED",
      errorMessage: "The live model request expired. Try again while the Runtime Host is online.",
      expiresAt: purgeAt,
      updatedAt: now,
      completedAt: now,
    });
    await scheduleModelDiscoveryExpiry(ctx, request._id, purgeAt);
    return true;
  }

  await ctx.db.delete(request._id);
  return true;
}

export const expireRequest = internalMutation({
  args: {
    requestId: v.id("runtimeModelDiscoveryRequests"),
    expectedExpiresAt: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) =>
    await expireModelDiscoveryRequestHandler(ctx, args),
});

