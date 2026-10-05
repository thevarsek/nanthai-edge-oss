import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { effectivePersonaConfig, effectivePersonaRouteHash } from "./effective_persona_config";

export type ResolvedParticipantRuntimeRoute = {
  chatParticipantId: Id<"chatParticipants">;
  personaId?: Id<"personas">;
  placement: "cloud" | "local";
  source: "bare_model" | "persona_current" | "chat_override";
  personaConfig?: ReturnType<typeof effectivePersonaConfig>;
  participantRouteSnapshotId?: Id<"chatParticipantRuntimeRoutes">;
  chatRuntimeOverrideId?: Id<"chatRuntimeOverrides">;
  routeSnapshotHash?: string;
  deviceId?: string;
  deviceName?: string;
  adapterId?: string;
  modelSelectionMode?: "adapter_default" | "explicit";
  provider?: string;
  modelId?: string;
  availability: "cloud" | "ready" | "persona_unavailable" | "device_unavailable"
    | "device_offline" | "adapter_unavailable" | "adapter_signed_out";
};

async function localAvailability(
  ctx: QueryCtx,
  route: {
    deviceId: string;
    adapterId: string;
  },
  userId: string,
  now: number,
): Promise<Pick<ResolvedParticipantRuntimeRoute, "availability" | "deviceName">> {
  const device = await ctx.db.query("runtimeDevices")
    .withIndex("by_device_id", (query) => query.eq("deviceId", route.deviceId))
    .unique();
  if (!device || device.userId !== userId || device.status !== "active") {
    return { availability: "device_unavailable" };
  }
  const presence = device.currentPresenceId
    ? await ctx.db.get(device.currentPresenceId)
    : null;
  if (!presence || presence.status !== "online" || presence.expiresAt <= now) {
    return { availability: "device_offline", deviceName: device.displayName };
  }
  const adapter = presence.adapters.find((candidate) =>
    candidate.adapterId === route.adapterId,
  );
  if (!adapter || adapter.authState === "unavailable") {
    return { availability: "adapter_unavailable", deviceName: device.displayName };
  }
  if (adapter.authState !== "ready") {
    return { availability: "adapter_signed_out", deviceName: device.displayName };
  }
  return { availability: "ready", deviceName: device.displayName };
}

export async function resolveEffectiveParticipantRoute(
  ctx: QueryCtx,
  args: {
    userId: string;
    chatParticipantId: Id<"chatParticipants">;
    personaId?: Id<"personas"> | null;
    now?: number;
  },
): Promise<ResolvedParticipantRuntimeRoute | null> {
  const participant = await ctx.db.get(args.chatParticipantId);
  if (!participant || participant.userId !== args.userId) return null;
  const personaId = args.personaId === undefined ? participant.personaId : args.personaId;
  if (!personaId) {
    return {
      chatParticipantId: participant._id,
      placement: "cloud",
      source: "bare_model",
      modelId: participant.modelId,
      availability: "cloud",
    };
  }
  const persona = await ctx.db.get(personaId);
  if (!persona || persona.userId !== args.userId) return {
    chatParticipantId: participant._id, personaId,
    placement: "cloud", source: "persona_current", availability: "persona_unavailable",
  };
  const [binding, override] = await Promise.all([
    activePersonaRuntimeBinding(ctx, persona),
    ctx.db.query("chatRuntimeOverrides")
      .withIndex("by_chat_status", (query) =>
        query.eq("chatId", participant.chatId).eq("status", "active"),
      ).unique(),
  ]);
  const personaConfig = effectivePersonaConfig(persona);
  const route = override ?? binding;
  if (!route) return {
    chatParticipantId: participant._id, personaId: persona._id, personaConfig,
    placement: "cloud", source: "persona_current", availability: "cloud",
    modelId: persona.modelId ?? participant.modelId,
  };
  const availability = await localAvailability(ctx, route, args.userId, args.now ?? Date.now());
  return {
    chatParticipantId: participant._id, personaId: persona._id, personaConfig,
    placement: "local", source: override ? "chat_override" : "persona_current",
    chatRuntimeOverrideId: override?._id,
    routeSnapshotHash: await effectivePersonaRouteHash(route.routeHash, persona),
    deviceId: route.deviceId, deviceName: availability.deviceName, adapterId: route.adapterId,
    modelSelectionMode: route.modelSelectionMode, provider: route.provider,
    modelId: route.modelId, availability: availability.availability,
  };
}

export async function activePersonaRuntimeBinding(
  ctx: QueryCtx,
  persona: Doc<"personas">,
): Promise<Doc<"personaRuntimeBindings"> | null> {
  return await ctx.db.query("personaRuntimeBindings")
    .withIndex("by_persona_status", (query) =>
      query.eq("personaId", persona._id).eq("status", "active"),
    )
    .unique();
}
