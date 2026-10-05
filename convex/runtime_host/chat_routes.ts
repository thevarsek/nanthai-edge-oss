import { ConvexError, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation, type MutationCtx } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import {
  assertRouteDevice,
  routeHash,
  type RuntimeRouteInput,
} from "./route_common";

const routeArgs = {
  deviceId: v.string(),
  adapterId: v.string(),
  modelSelectionMode: v.union(
    v.literal("adapter_default"),
    v.literal("explicit"),
  ),
  provider: v.optional(v.string()),
  modelId: v.optional(v.string()),
};

export async function clearParticipantRuntimeSnapshotHandler(
  ctx: MutationCtx,
  chatParticipantId: Id<"chatParticipants">,
  now = Date.now(),
): Promise<boolean> {
  const current = await ctx.db.query("chatParticipantRuntimeRoutes")
    .withIndex("by_participant_status", (query) =>
      query.eq("chatParticipantId", chatParticipantId).eq("status", "active"),
    )
    .unique();
  if (!current) return false;
  await ctx.db.patch(current._id, { status: "cleared", supersededAt: now });
  return true;
}

export const setChatRuntimeOverride = mutation({
  args: { chatId: v.id("chats"), ...routeArgs },
  returns: v.id("chatRuntimeOverrides"),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found" });
    }
    const route: RuntimeRouteInput = {
      deviceId: args.deviceId,
      adapterId: args.adapterId,
      modelSelectionMode: args.modelSelectionMode,
      provider: args.provider,
      modelId: args.modelId,
    };
    await assertRouteDevice(ctx, userId, route);
    const current = await ctx.db.query("chatRuntimeOverrides")
      .withIndex("by_chat_status", (query) =>
        query.eq("chatId", chat._id).eq("status", "active"),
      )
      .unique();
    const hash = await routeHash(route);
    if (current?.routeHash === hash) return current._id;
    const now = Date.now();
    if (current) {
      await ctx.db.patch(current._id, {
        status: "superseded",
        supersededAt: now,
        updatedAt: now,
      });
    }
    return await ctx.db.insert("chatRuntimeOverrides", {
      userId,
      chatId: chat._id,
      revision: (current?.revision ?? 0) + 1,
      status: "active",
      ...route,
      routeHash: hash,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const clearChatRuntimeOverride = mutation({
  args: { chatId: v.id("chats") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found" });
    }
    const current = await ctx.db.query("chatRuntimeOverrides")
      .withIndex("by_chat_status", (query) =>
        query.eq("chatId", chat._id).eq("status", "active"),
      )
      .unique();
    if (!current) return false;
    const now = Date.now();
    await ctx.db.patch(current._id, {
      status: "cleared",
      supersededAt: now,
      updatedAt: now,
    });
    return true;
  },
});
