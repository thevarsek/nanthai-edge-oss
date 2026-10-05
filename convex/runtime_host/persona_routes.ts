import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import {
  assertRouteDevice,
  routeHash,
  type RuntimeRouteInput,
} from "./route_common";

export const runtimeRouteArgs = {
  deviceId: v.string(),
  adapterId: v.string(),
  modelSelectionMode: v.union(
    v.literal("adapter_default"),
    v.literal("explicit"),
  ),
  provider: v.optional(v.string()),
  modelId: v.optional(v.string()),
};

export const setPersonaRuntime = mutation({
  args: { personaId: v.id("personas"), ...runtimeRouteArgs },
  returns: v.id("personaRuntimeBindings"),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    return await setPersonaRuntimeBindingHandler(ctx, { userId, ...args });
  },
});

export async function setPersonaRuntimeBindingHandler(
  ctx: MutationCtx,
  args: RuntimeRouteInput & {
    userId: string;
    personaId: Id<"personas">;
    now?: number;
  },
): Promise<Id<"personaRuntimeBindings">> {
  const persona = await ctx.db.get(args.personaId);
  if (!persona || persona.userId !== args.userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Persona not found" });
  }
  const route: RuntimeRouteInput = {
    deviceId: args.deviceId,
    adapterId: args.adapterId,
    modelSelectionMode: args.modelSelectionMode,
    provider: args.provider,
    modelId: args.modelId,
  };
  await assertRouteDevice(ctx, args.userId, route, args.now);
  const current = await ctx.db.query("personaRuntimeBindings")
    .withIndex("by_persona_status", (query) =>
      query.eq("personaId", persona._id).eq("status", "active"),
    )
    .unique();
  const now = args.now ?? Date.now();
  const hash = await routeHash(route);
  if (current?.routeHash === hash) return current._id;
  if (current) {
    await ctx.db.patch(current._id, {
      status: "superseded",
      supersededAt: now,
      updatedAt: now,
    });
  }
  return await ctx.db.insert("personaRuntimeBindings", {
    userId: args.userId,
    personaId: persona._id,
    revision: (current?.revision ?? 0) + 1,
    status: "active",
    ...route,
    routeHash: hash,
    createdAt: now,
    updatedAt: now,
  });
}

export async function clearPersonaRuntimeBindingHandler(
  ctx: MutationCtx,
  args: { userId: string; personaId: Id<"personas">; now?: number },
): Promise<boolean> {
  const persona = await ctx.db.get(args.personaId);
  if (!persona || persona.userId !== args.userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Persona not found" });
  }
  const current = await ctx.db.query("personaRuntimeBindings")
    .withIndex("by_persona_status", (query) =>
      query.eq("personaId", persona._id).eq("status", "active"),
    )
    .unique();
  if (!current) return false;
  const now = args.now ?? Date.now();
  await ctx.db.patch(current._id, {
    status: "cleared",
    supersededAt: now,
    updatedAt: now,
  });
  return true;
}

export const clearPersonaRuntime = mutation({
  args: { personaId: v.id("personas") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    return await clearPersonaRuntimeBindingHandler(ctx, { userId, ...args });
  },
});
