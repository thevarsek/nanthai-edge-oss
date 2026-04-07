import { v, ConvexError } from "convex/values";
import { mutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { requireAuth } from "../lib/auth";

// =============================================================================
// Chat Participant Mutations
// =============================================================================

async function assertNoActiveAutonomousSession(
  ctx: { db: any },
  chatId: Id<"chats">,
): Promise<void> {
  const sessions = await ctx.db
    .query("autonomousSessions")
    .withIndex("by_chat", (q: any) => q.eq("chatId", chatId))
    .collect();
  const hasActive = sessions.some(
    (session: { status: string }) =>
      session.status === "running" || session.status === "paused",
  );
  if (hasActive) {
    throw new ConvexError({ code: "VALIDATION" as const, message: "Cannot edit participants while autonomous mode is active" });
  }
}

async function patchChatForParticipantCount(
  ctx: { db: any },
  chat: { _id: Id<"chats">; subagentOverride?: string },
  participantCount: number,
): Promise<void> {
  const patch: Record<string, unknown> = {
    updatedAt: Date.now(),
  };
  if (participantCount > 1 && chat.subagentOverride === "enabled") {
    patch.subagentOverride = undefined;
  }
  await ctx.db.patch(chat._id, patch);
}

/** Add a participant (bare model or persona-backed) to a chat. */
export const addParticipant = mutation({
  args: {
    chatId: v.id("chats"),
    modelId: v.string(),
    personaId: v.optional(v.id("personas")),
    personaName: v.optional(v.string()),
    personaEmoji: v.optional(v.union(v.string(), v.null())),
    personaAvatarImageUrl: v.optional(v.union(v.string(), v.null())),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    // Verify chat ownership
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Chat not found" });
    }
    await assertNoActiveAutonomousSession(ctx, args.chatId);

    // Count existing participants
    const existing = await ctx.db
      .query("chatParticipants")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();

    if (existing.length >= 3) {
      throw new ConvexError({ code: "VALIDATION" as const, message: "Maximum 3 participants per chat" });
    }

    const sortOrder =
      args.sortOrder ??
      (existing.length > 0
        ? Math.max(...existing.map((p) => p.sortOrder)) + 1
        : 0);

    const id = await ctx.db.insert("chatParticipants", {
      chatId: args.chatId,
      userId,
      modelId: args.modelId,
      personaId: args.personaId,
      personaName: args.personaName,
      personaEmoji: args.personaEmoji ?? undefined,
      personaAvatarImageUrl: args.personaAvatarImageUrl ?? undefined,
      sortOrder,
      createdAt: Date.now(),
    });

    await patchChatForParticipantCount(ctx, chat, existing.length + 1);

    return id;
  },
});

/** Remove a participant from a chat. */
export const removeParticipant = mutation({
  args: {
    participantId: v.id("chatParticipants"),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const participant = await ctx.db.get(args.participantId);
    if (!participant || participant.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Participant not found" });
    }
    await assertNoActiveAutonomousSession(ctx, participant.chatId);

    // Don't allow removing the last participant
    const siblings = await ctx.db
      .query("chatParticipants")
      .withIndex("by_chat", (q) => q.eq("chatId", participant.chatId))
      .collect();

    if (siblings.length <= 1) {
      throw new ConvexError({ code: "VALIDATION" as const, message: "Cannot remove the last participant" });
    }

    await ctx.db.delete(args.participantId);

    // Re-normalize sort orders
    const remaining = siblings
      .filter((p) => p._id !== args.participantId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i].sortOrder !== i) {
        await ctx.db.patch(remaining[i]._id, { sortOrder: i });
      }
    }

    const chat = await ctx.db.get(participant.chatId);
    if (chat) {
      await patchChatForParticipantCount(ctx, chat, remaining.length);
    }
  },
});

/** Update a participant's model or persona. */
export const updateParticipant = mutation({
  args: {
    participantId: v.id("chatParticipants"),
    modelId: v.optional(v.string()),
    personaId: v.optional(v.id("personas")),
    personaName: v.optional(v.string()),
    personaEmoji: v.optional(v.union(v.string(), v.null())),
    personaAvatarImageUrl: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const participant = await ctx.db.get(args.participantId);
    if (!participant || participant.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Participant not found" });
    }
    await assertNoActiveAutonomousSession(ctx, participant.chatId);

    const patch: Record<string, unknown> = {};
    if (args.modelId !== undefined) patch.modelId = args.modelId;
    if (args.personaId !== undefined) patch.personaId = args.personaId;
    if (args.personaName !== undefined) patch.personaName = args.personaName;
    if (args.personaEmoji !== undefined) patch.personaEmoji = args.personaEmoji ?? undefined;
    if (args.personaAvatarImageUrl !== undefined) patch.personaAvatarImageUrl = args.personaAvatarImageUrl ?? undefined;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.participantId, patch);
      const chat = await ctx.db.get(participant.chatId);
      if (chat) {
        const siblings = await ctx.db
          .query("chatParticipants")
          .withIndex("by_chat", (q) => q.eq("chatId", participant.chatId))
          .collect();
        await patchChatForParticipantCount(ctx, chat, siblings.length);
      }
    }
  },
});

/** Replace all participants on a chat (atomic swap). */
export const setParticipants = mutation({
  args: {
    chatId: v.id("chats"),
    participants: v.array(
      v.object({
        modelId: v.string(),
        personaId: v.optional(v.id("personas")),
        personaName: v.optional(v.string()),
        personaEmoji: v.optional(v.union(v.string(), v.null())),
        personaAvatarImageUrl: v.optional(v.union(v.string(), v.null())),
      })
    ),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);

    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId) {
      throw new ConvexError({ code: "NOT_FOUND" as const, message: "Chat not found" });
    }
    await assertNoActiveAutonomousSession(ctx, args.chatId);

    if (args.participants.length === 0) {
      throw new ConvexError({ code: "VALIDATION" as const, message: "At least one participant required" });
    }
    if (args.participants.length > 3) {
      throw new ConvexError({ code: "VALIDATION" as const, message: "Maximum 3 participants per chat" });
    }

    // Delete existing
    const existing = await ctx.db
      .query("chatParticipants")
      .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
      .collect();
    for (const p of existing) {
      await ctx.db.delete(p._id);
    }

    // Insert new
    for (let i = 0; i < args.participants.length; i++) {
      const p = args.participants[i];
      await ctx.db.insert("chatParticipants", {
        chatId: args.chatId,
        userId,
        modelId: p.modelId,
        personaId: p.personaId,
        personaName: p.personaName,
        personaEmoji: p.personaEmoji ?? undefined,
        personaAvatarImageUrl: p.personaAvatarImageUrl ?? undefined,
        sortOrder: i,
        createdAt: Date.now(),
      });
    }

    await patchChatForParticipantCount(ctx, chat, args.participants.length);
  },
});
