import { mutation, query, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { ConvexError, v } from "convex/values";
import { requireAuth } from "../lib/auth";
import { runtimePersonaRecoveryBindings, runtimePersonasForDevice } from "./persona_recovery";

const deviceProjection = v.object({
  runtimeDeviceId: v.id("runtimeDevices"),
  deviceId: v.string(),
  displayName: v.string(),
  status: v.union(v.literal("active"), v.literal("revoked")),
  operatingSystem: v.string(),
  architecture: v.string(),
  platformRelease: v.string(),
  hostVersion: v.string(),
  credentialId: v.string(),
  isOnline: v.boolean(),
  starterPersonaId: v.optional(v.id("personas")),
  starterPersonas: v.array(v.object({ adapterId: v.string(), personaId: v.id("personas") })),
  runtimePersonas: v.array(v.object({ adapterId: v.string(), personaId: v.id("personas"), needsReconnect: v.boolean() })),
  presenceOwner: v.optional(v.string()),
  presenceSessionId: v.optional(v.string()),
  presenceExpiresAt: v.optional(v.number()),
  lastSeenAt: v.optional(v.number()),
  adapters: v.array(v.object({
    adapterId: v.string(),
    isAvailable: v.boolean(),
    displayName: v.string(),
    adapterVersion: v.string(),
    authState: v.string(),
    inputModalities: v.array(v.string()),
    operations: v.object({
      listModels: v.boolean(),
      cancel: v.boolean(),
      resume: v.boolean(),
      permissionResponse: v.boolean(),
      inputResponse: v.boolean(),
    }),
  })),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const listMyDevices = query({
  args: {},
  returns: v.array(deviceProjection),
  handler: async (ctx) => {
    const { userId } = await requireAuth(ctx);
    const devices = await ctx.db.query("runtimeDevices")
      .withIndex("by_user_status", (queryBuilder) =>
        queryBuilder.eq("userId", userId),
      )
      .order("desc")
      .collect();
    // Heartbeats update the index; keep machine choices stationary during selection.
    devices.sort((left, right) => right.status.localeCompare(left.status)
      || right.createdAt - left.createdAt || left.deviceId.localeCompare(right.deviceId));
    const now = Date.now();
    const candidates = await runtimePersonaRecoveryBindings(ctx, userId);
    return await Promise.all(devices.filter((device) => device.hiddenAt === undefined).map(async (device) => {
      const presence = device.currentPresenceId
        ? await ctx.db.get(device.currentPresenceId)
        : null;
      const isOnline = device.status === "active"
        && presence?.status === "online"
        && presence.expiresAt > now;
      const starter = device.starterPersonaId ? await ctx.db.get(device.starterPersonaId) : null;
      const receipts = device.starterPersonaBindings ?? (device.starterPersonaId ? [{ adapterId: "codex", personaId: device.starterPersonaId }] : []);
      const starterPersonas = (await Promise.all(receipts.map(async receipt => {
        const persona = await ctx.db.get(receipt.personaId);
        return persona?.userId === userId ? receipt : null;
      }))).filter((receipt): receipt is NonNullable<typeof receipt> => receipt !== null);
      return {
        runtimeDeviceId: device._id,
        deviceId: device.deviceId,
        displayName: device.displayName,
        status: device.status,
        operatingSystem: device.operatingSystem,
        architecture: device.architecture,
        platformRelease: device.platformRelease,
        hostVersion: device.hostVersion,
        credentialId: device.currentCredentialId,
        isOnline,
        starterPersonaId: starter?.userId === userId ? starter._id : undefined,
        starterPersonas,
        runtimePersonas: runtimePersonasForDevice(candidates, device, isOnline
          ? (presence?.adapters ?? []).filter(adapter => adapter.authState === "ready").map(adapter => adapter.adapterId) : []),
        presenceOwner: presence?.owner,
        presenceSessionId: presence?.presenceSessionId,
        presenceExpiresAt: presence?.expiresAt,
        lastSeenAt: device.lastSeenAt,
        adapters: (presence?.adapters ?? []).map((adapter) => ({
          adapterId: adapter.adapterId,
          isAvailable: isOnline && adapter.authState === "ready",
          displayName: adapter.adapterId === "codex" ? "OpenAI Codex" : adapter.adapterId === "pi" ? "Pi" : adapter.adapterId,
          adapterVersion: adapter.adapterVersion,
          authState: adapter.authState,
          inputModalities: adapter.capabilities.inputModalities,
          operations: adapter.capabilities.operations,
        })),
        createdAt: device.createdAt,
        updatedAt: device.updatedAt,
      };
    }));
  },
});

export async function hideRemovedDeviceHandler(
  ctx: MutationCtx,
  args: { userId: string; runtimeDeviceId: Id<"runtimeDevices">; now?: number },
): Promise<boolean> {
  const device = await ctx.db.get(args.runtimeDeviceId);
  if (!device || device.userId !== args.userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Removed machine not found" });
  }
  if (device.status !== "revoked") {
    throw new ConvexError({ code: "NOT_REMOVED", message: "Remove the pairing before deleting this machine from the list" });
  }
  if (device.hiddenAt !== undefined) return false;
  await ctx.db.patch(device._id, { hiddenAt: args.now ?? Date.now() });
  return true;
}

export const hideRemovedDevice = mutation({
  args: { runtimeDeviceId: v.id("runtimeDevices") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    return await hideRemovedDeviceHandler(ctx, { userId, ...args });
  },
});
