import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { createBasicRuntimePersona } from "./basic_persona";
import { getIsProUnlocked } from "../lib/auth";
import { selectLocalOnboardingDefault } from "./onboarding_default";
import { runtimePersonaRecoveryBindings, runtimePersonasForDevice } from "./persona_recovery";

/** Pairing authorizes setup; the selected executable must report ready before provisioning. */
export async function provisionStarterPersona(
  ctx: MutationCtx,
  device: Doc<"runtimeDevices">,
  now: number,
): Promise<void> {
  if (!await getIsProUnlocked(ctx, device.userId)) return;
  const presence = device.currentPresenceId ? await ctx.db.get(device.currentPresenceId) : null;
  if (!presence || presence.status !== "online" || presence.expiresAt <= now) return;
  // Receipts survive deletion/rerouting; heartbeats never resurrect a user's removed Persona.
  const receipts = [...(device.starterPersonaBindings ?? (device.starterPersonaId
    ? [{ adapterId: "codex", personaId: device.starterPersonaId }] : []))];
  let changed = false;
  const readyAdapterIds = presence.adapters.filter(adapter => adapter.authState === "ready"
    && (adapter.adapterId === "codex" || adapter.adapterId === "pi")).map(adapter => adapter.adapterId);
  const candidates = readyAdapterIds.some(adapterId => !receipts.some(receipt => receipt.adapterId === adapterId))
    ? runtimePersonasForDevice(await runtimePersonaRecoveryBindings(ctx, device.userId), device, readyAdapterIds) : [];
  for (const adapter of presence.adapters) {
    if (adapter.authState !== "ready" || (adapter.adapterId !== "codex" && adapter.adapterId !== "pi")) continue;
    let receipt = receipts.find(item => item.adapterId === adapter.adapterId);
    if (!receipt) {
      const existing = candidates.find(item => item.adapterId === adapter.adapterId && !item.needsReconnect);
      // A new pairing has new authority. Let the user choose which retained Persona to reconnect.
      if (!existing && candidates.some(item => item.adapterId === adapter.adapterId && item.needsReconnect)) continue;
      receipt = { adapterId: adapter.adapterId, personaId: existing?.personaId ?? await createBasicRuntimePersona(ctx, device, adapter.adapterId, now) };
      receipts.push(receipt); changed = true;
    }
    await selectLocalOnboardingDefault(ctx, device.userId, receipt.personaId, now);
  }
  if (changed) await ctx.db.patch(device._id, {
    starterPersonaBindings: receipts, starterPersonaId: device.starterPersonaId ?? receipts[0]?.personaId,
  });
}
