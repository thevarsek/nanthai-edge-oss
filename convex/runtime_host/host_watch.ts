import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import { authenticateOnlineRuntimeHost } from "./host_session_auth";

// Wake signal for a connected Runtime Host. The host subscribes over the Convex
// WebSocket instead of polling, then claims through the existing HTTP routes.
// Only record IDs leave this query: payloads stay behind the claim path.
const MAX_WATCHED_COMMANDS = 100;
const MAX_WATCHED_MODEL_DISCOVERY_REQUESTS = 10;

const credentialArgs = {
  deviceId: v.string(),
  credentialId: v.string(),
  credential: v.string(),
  presenceSessionId: v.string(),
};

export type PendingHostWork = {
  commandIds: Id<"runtimeCommands">[];
  modelDiscoveryRequestIds: Id<"runtimeModelDiscoveryRequests">[];
};

export async function pendingWorkForHostHandler(
  ctx: Pick<QueryCtx, "db">,
  args: {
    deviceId: string;
    credentialId: string;
    credential: string;
    presenceSessionId: string;
  },
  now = Date.now(),
): Promise<PendingHostWork> {
  const host = await authenticateOnlineRuntimeHost(ctx, args, now);
  const commands = await ctx.db.query("runtimeCommands")
    .withIndex("by_device_status", (queryBuilder) =>
      queryBuilder.eq("targetDeviceId", host.device.deviceId).eq("status", "pending"),
    )
    .order("asc")
    .take(MAX_WATCHED_COMMANDS);
  // The claim path rejects a presence still bound to a rotated credential; the
  // next heartbeat rebinds it and re-runs this query, so report nothing until then.
  const discovery = host.presence.credentialId === host.credential.credentialId
    ? await ctx.db.query("runtimeModelDiscoveryRequests")
      .withIndex("by_device_presence_status", (queryBuilder) =>
        queryBuilder.eq("runtimeDeviceId", host.device._id)
          .eq("presenceSessionId", host.presence.presenceSessionId)
          .eq("status", "pending"),
      )
      .order("asc")
      .take(MAX_WATCHED_MODEL_DISCOVERY_REQUESTS)
    : [];
  return {
    commandIds: commands.map((command) => command._id),
    modelDiscoveryRequestIds: discovery.map((request) => request._id),
  };
}

export const pendingWork = query({
  args: credentialArgs,
  returns: v.object({
    commandIds: v.array(v.id("runtimeCommands")),
    modelDiscoveryRequestIds: v.array(v.id("runtimeModelDiscoveryRequests")),
  }),
  handler: async (ctx, args) => await pendingWorkForHostHandler(ctx, args),
});
