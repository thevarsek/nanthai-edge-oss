import { query } from "../_generated/server";
import { v } from "convex/values";
import { requireAuth } from "../lib/auth";
import {
  collaborationExchangeStatus,
  groupBehavior,
} from "./validators";

const collaborationChatState = v.union(
  v.null(),
  v.object({
    behavior: groupBehavior,
    exchange: v.union(
      v.null(),
      v.object({
        id: v.id("collaborationExchanges"),
        status: collaborationExchangeStatus,
        currentWave: v.number(),
        maxWaves: v.number(),
        activeSpeakers: v.array(v.object({ displayName: v.string() })),
        pendingInputCount: v.number(),
        terminalReason: v.optional(v.string()),
        error: v.optional(v.string()),
        completedAt: v.optional(v.number()),
      }),
    ),
  }),
);

export const getChatState = query({
  args: { chatId: v.id("chats") },
  returns: collaborationChatState,
  handler: async (ctx, args) => {
    const { userId } = await requireAuth(ctx);
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== userId || chat.isDeleting === true) return null;
    const exchanges = await ctx.db
      .query("collaborationExchanges")
      .withIndex("by_chat", (query) => query.eq("chatId", chat._id))
      .order("desc")
      .take(1);
    const exchange = exchanges[0] ?? null;
    const participantById = new Map(
      exchange?.participantSnapshot.map((participant) => [
        String(participant.participantId),
        participant,
      ]) ?? [],
    );
    return {
      behavior: chat.groupBehavior ?? "parallel",
      exchange: exchange
        ? {
            id: exchange._id,
            status: exchange.status,
            currentWave: exchange.currentWave,
            maxWaves: exchange.bounds.maxWaves,
            activeSpeakers: exchange.activeParticipantIds.map((participantId) => {
              const participant = participantById.get(String(participantId));
              return {
                displayName: participant?.displayName ?? "Participant",
              };
            }),
            pendingInputCount: exchange.pendingHumanMessageIds.length,
            terminalReason: exchange.terminalReason,
            error: exchange.error,
            completedAt: exchange.completedAt,
          }
        : null,
    };
  },
});
