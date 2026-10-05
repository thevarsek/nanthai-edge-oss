import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  authenticateRuntimeHost,
  runtimeHostError,
} from "./security";

export async function authenticateOnlineRuntimeHost(
  ctx: Pick<MutationCtx, "db"> | Pick<QueryCtx, "db">,
  args: {
    deviceId: string;
    credentialId: string;
    credential: string;
    presenceSessionId: string;
  },
  now = Date.now(),
): Promise<{
  credential: Doc<"runtimeDeviceCredentials">;
  device: Doc<"runtimeDevices">;
  presence: Doc<"runtimeDevicePresences">;
  claimantId: string;
}> {
  const { credential, device } = await authenticateRuntimeHost(ctx, args);
  const presence = await ctx.db.query("runtimeDevicePresences")
    .withIndex("by_device_session", (queryBuilder) =>
      queryBuilder.eq("runtimeDeviceId", device._id)
        .eq("presenceSessionId", args.presenceSessionId),
    )
    .unique();
  if (!presence || presence.status !== "online" || presence.expiresAt <= now) {
    throw runtimeHostError("RUNTIME_HOST_OFFLINE", "Runtime Host presence has expired");
  }
  return {
    credential,
    device,
    presence,
    claimantId: `runtime-host:${device.deviceId}:${presence.presenceSessionId}`,
  };
}

// A missed heartbeat is not proof of shutdown. Only the authenticated stop receipt is.
export async function hasStoppedAttemptOwner(
  ctx: Pick<MutationCtx, "db">,
  attempt: Doc<"executionAttempts">,
): Promise<boolean> {
  const { deviceId, claimantId } = attempt;
  if (!deviceId || !claimantId) return false;
  const prefix = `runtime-host:${deviceId}:`;
  if (!claimantId.startsWith(prefix)) return false;
  const device = await ctx.db.query("runtimeDevices")
    .withIndex("by_device_id", q => q.eq("deviceId", deviceId)).unique();
  if (!device || device.userId !== attempt.userId) return false;
  const presence = await ctx.db.query("runtimeDevicePresences")
    .withIndex("by_device_session", q => q.eq("runtimeDeviceId", device._id)
      .eq("presenceSessionId", claimantId.slice(prefix.length))).unique();
  return presence?.userId === attempt.userId && presence.executionStoppedAt !== undefined;
}
