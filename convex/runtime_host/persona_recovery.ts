import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** Canonical IDs, never display names, identify Personas and their route authority. */
export async function runtimePersonaRecoveryBindings(ctx: Pick<QueryCtx, "db">, userId: string) {
  // ponytail: the personal catalogue mirrors personas:list; paginate both if they approach Convex's read budget.
  const bindings = await ctx.db.query("personaRuntimeBindings")
    .withIndex("by_user_status", q => q.eq("userId", userId).eq("status", "active"))
    .collect();
  const candidates = await Promise.all(bindings.map(async binding => {
    const [persona, device] = await Promise.all([
      ctx.db.get(binding.personaId),
      ctx.db.query("runtimeDevices").withIndex("by_device_id", q => q.eq("deviceId", binding.deviceId)).unique(),
    ]);
    return persona?.userId === userId && device?.userId === userId ? { binding, device } : null;
  }));
  return candidates.filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
}

export function runtimePersonasForDevice(
  candidates: Awaited<ReturnType<typeof runtimePersonaRecoveryBindings>>,
  device: Doc<"runtimeDevices">,
  readyAdapterIds: string[],
) {
  return candidates.filter(({ binding, device: source }) => binding.deviceId === device.deviceId
    || (device.status === "active" && source.status === "revoked" && readyAdapterIds.includes(binding.adapterId)))
    .map(({ binding }) => ({
      adapterId: binding.adapterId, personaId: binding.personaId,
      needsReconnect: binding.deviceId !== device.deviceId,
    }));
}
