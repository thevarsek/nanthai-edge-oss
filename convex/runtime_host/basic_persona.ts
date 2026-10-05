import { mutation, type MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { requireAuth, requirePro } from "../lib/auth";
import { availablePersonaDisplayName } from "../personas/name_uniqueness";
import { setPersonaRuntimeBindingHandler } from "./persona_routes";
import { runtimeHostError } from "./security";
import { runtimePersonaRecoveryBindings } from "./persona_recovery";

export async function createBasicCodexPersona(ctx: MutationCtx, device: Doc<"runtimeDevices">, now: number) {
  return createBasicRuntimePersona(ctx, device, "codex", now);
}

export async function createBasicRuntimePersona(ctx: MutationCtx, device: Doc<"runtimeDevices">, adapterId: "codex" | "pi", now: number) {
  const presence = device.currentPresenceId ? await ctx.db.get(device.currentPresenceId) : null;
  const solReady = presence?.status === "online" && presence.expiresAt > now
    && presence.adapters.some(adapter => adapter.adapterId === "codex" && adapter.authState === "ready" && adapter.capabilities.operations.listModels);
  const personaId = await ctx.db.insert("personas", {
    userId: device.userId,
    displayName: await availablePersonaDisplayName(ctx, device.userId, `${adapterId === "pi" ? "Pi" : "OpenAI Codex"} · ${device.displayName}`),
    systemPrompt: "You are a helpful assistant.", avatarSFSymbol: "terminal", isDefault: false, createdAt: now, updatedAt: now,
  });
  await setPersonaRuntimeBindingHandler(ctx, { userId: device.userId, personaId, deviceId: device.deviceId, adapterId,
    ...(adapterId === "codex" && solReady ? { modelSelectionMode: "explicit" as const, provider: "openai", modelId: "gpt-6.1-sol" }
      : { modelSelectionMode: "adapter_default" as const }), now });
  return personaId;
}

/** Recovery preserves Persona identity; only an explicit extra creates another row. */
export async function recoverBasicRuntimePersona(ctx: MutationCtx, device: Doc<"runtimeDevices">,
  adapterId: "codex" | "pi", options: { personaId?: Id<"personas">; createAnother?: boolean }, now: number) {
  const candidates = await runtimePersonaRecoveryBindings(ctx, device.userId);
  const existing = options.personaId
    ? candidates.find(item => item.binding.personaId === options.personaId && item.binding.adapterId === adapterId)
    : candidates.find(item => item.binding.deviceId === device.deviceId && item.binding.adapterId === adapterId);
  if (options.personaId && (!existing || (existing.binding.deviceId !== device.deviceId && existing.device.status !== "revoked"))) {
    throw runtimeHostError("NOT_FOUND", "Choose an existing Persona from this computer or a removed pairing");
  }
  if (options.createAnother && !options.personaId) return createBasicRuntimePersona(ctx, device, adapterId, now);
  if (!existing && candidates.some(item => item.binding.adapterId === adapterId && item.device.status === "revoked")) {
    throw runtimeHostError("VALIDATION_ERROR", "Choose a Persona to reconnect, or create another Persona");
  }
  const personaId = existing?.binding.personaId ?? await createBasicRuntimePersona(ctx, device, adapterId, now);
  if (existing && existing.binding.deviceId !== device.deviceId) {
    await setPersonaRuntimeBindingHandler(ctx, { userId: device.userId, personaId,
      deviceId: device.deviceId, adapterId, modelSelectionMode: existing.binding.modelSelectionMode,
      provider: existing.binding.provider, modelId: existing.binding.modelId, now });
  }
  const receipts = device.starterPersonaBindings ?? (device.starterPersonaId
    ? [{ adapterId: "codex", personaId: device.starterPersonaId }] : []);
  await ctx.db.patch(device._id, { starterPersonaBindings: [
    ...receipts.filter(receipt => receipt.adapterId !== adapterId), { adapterId, personaId },
  ], starterPersonaId: device.starterPersonaId ?? personaId });
  return personaId;
}

export const addBasicCodexPersona = mutation({
  args: { deviceId: v.string() }, returns: v.id("personas"),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const device = await ctx.db.query("runtimeDevices").withIndex("by_device_id", q => q.eq("deviceId", args.deviceId)).unique();
    if (!device || device.userId !== userId || device.status !== "active") throw runtimeHostError("RUNTIME_UNAVAILABLE", "Choose an active paired computer");
    return recoverBasicRuntimePersona(ctx, device, "codex", {}, Date.now());
  },
});

export const addBasicPersona = mutation({
  args: { deviceId: v.string(), adapterId: v.union(v.literal("codex"), v.literal("pi")),
    personaId: v.optional(v.id("personas")), createAnother: v.optional(v.boolean()) }, returns: v.id("personas"),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    await requirePro(ctx, userId);
    const device = await ctx.db.query("runtimeDevices").withIndex("by_device_id", q => q.eq("deviceId", args.deviceId)).unique();
    if (!device || device.userId !== userId || device.status !== "active") throw runtimeHostError("RUNTIME_UNAVAILABLE", "Choose an active paired computer");
    return recoverBasicRuntimePersona(ctx, device, args.adapterId, args, Date.now());
  },
});
