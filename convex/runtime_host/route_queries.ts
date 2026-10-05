import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import {
  activePersonaRuntimeBinding,
  resolveEffectiveParticipantRoute,
} from "./route_resolution";

const resolvedRoute = v.object({
  chatParticipantId: v.id("chatParticipants"),
  personaId: v.optional(v.id("personas")),
  placement: v.union(v.literal("cloud"), v.literal("local")),
  source: v.string(),
  participantRouteSnapshotId: v.optional(v.id("chatParticipantRuntimeRoutes")),
  chatRuntimeOverrideId: v.optional(v.id("chatRuntimeOverrides")),
  routeSnapshotHash: v.optional(v.string()),
  deviceId: v.optional(v.string()),
  deviceName: v.optional(v.string()),
  adapterId: v.optional(v.string()),
  modelSelectionMode: v.optional(v.string()),
  provider: v.optional(v.string()),
  modelId: v.optional(v.string()),
  availability: v.string(),
});

const personaRuntime = v.object({
  bindingId: v.id("personaRuntimeBindings"),
  revision: v.number(),
  routeHash: v.string(),
  deviceId: v.string(),
  deviceName: v.string(),
  adapterId: v.string(),
  modelSelectionMode: v.union(v.literal("adapter_default"), v.literal("explicit")),
  provider: v.optional(v.string()),
  modelId: v.optional(v.string()),
  isOnline: v.boolean(),
  presenceExpiresAt: v.optional(v.number()),
  adapterAuthState: v.optional(v.string()),
  updatedAt: v.number(),
});

export const getPersonaRuntime = query({
  args: { personaId: v.id("personas") },
  returns: v.union(personaRuntime, v.null()),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const persona = await ctx.db.get(args.personaId);
    if (!persona || persona.userId !== userId) return null;
    const binding = await activePersonaRuntimeBinding(ctx, persona);
    if (!binding) return null;
    const device = await ctx.db.query("runtimeDevices")
      .withIndex("by_device_id", (queryBuilder) =>
        queryBuilder.eq("deviceId", binding.deviceId),
      )
      .unique();
    if (!device || device.userId !== userId) return null;
    const presence = device.currentPresenceId
      ? await ctx.db.get(device.currentPresenceId)
      : null;
    const isOnline = device.status === "active"
      && presence?.status === "online"
      && presence.expiresAt > Date.now();
    const adapter = presence?.adapters.find((candidate) =>
      candidate.adapterId === binding.adapterId,
    );
    return {
      bindingId: binding._id,
      revision: binding.revision,
      routeHash: binding.routeHash,
      deviceId: binding.deviceId,
      deviceName: device.displayName,
      adapterId: binding.adapterId,
      modelSelectionMode: binding.modelSelectionMode,
      provider: binding.provider,
      modelId: binding.modelId,
      isOnline,
      presenceExpiresAt: presence?.expiresAt,
      adapterAuthState: adapter?.authState,
      updatedAt: binding.updatedAt,
    };
  },
});

export const getChatRuntimeRouting = query({
  args: { chatId: v.id("chats") },
  returns: v.array(resolvedRoute),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) return [];
    const participants = await ctx.db.query("chatParticipants")
      .withIndex("by_chat", (queryBuilder) => queryBuilder.eq("chatId", chat._id))
      .collect();
    const resolved = await Promise.all(participants.map((participant) =>
      resolveEffectiveParticipantRoute(ctx, {
        userId,
        chatParticipantId: participant._id,
      }),
    ));
    return resolved.filter((route) => route !== null)
      .map(({ personaConfig: _personaConfig, ...route }) => route);
  },
});
