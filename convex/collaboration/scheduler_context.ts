import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { branchPathIds } from "../chat/helpers_utils";
import type { ContextMessage } from "../chat/helpers_types";

export const getSchedulerContext = internalQuery({
  args: {
    exchangeId: v.id("collaborationExchanges"),
    wave: v.number(),
  },
  handler: async (ctx, args) => {
    const exchange = await ctx.db.get(args.exchangeId);
    if (!exchange || exchange.currentWave !== args.wave) return null;
    const [messages, decisions, personaRows] = await Promise.all([
      ctx.db
        .query("messages")
        .withIndex("by_chat", (query) => query.eq("chatId", exchange.chatId))
        .order("desc")
        .take(30),
      ctx.db
        .query("collaborationDecisions")
        .withIndex("by_exchange_wave", (query) =>
          query.eq("exchangeId", exchange._id)
        )
        .order("desc")
        .take(1),
      Promise.all(exchange.participantSnapshot.map(async (participant) =>
        participant.personaId ? await ctx.db.get(participant.personaId) : null
      )),
    ]);
    const previousSpeakerIds = decisions[0]?.wave === args.wave - 1
      ? decisions[0].selections.map((selection) => selection.participantId)
      : [];
    const messagesById = new Map(messages.map((message) => [
      String(message._id),
      message as ContextMessage,
    ]));
    const reachableMessageIds = new Set<string>();
    for (const frontierMessageId of exchange.frontierMessageIds) {
      for (const messageId of branchPathIds(String(frontierMessageId), messagesById)) {
        reachableMessageIds.add(messageId);
      }
    }
    const recentMessages = messages
      .filter((message) =>
        reachableMessageIds.has(String(message._id)) &&
        message.status === "completed" &&
        message.content.trim().length > 0
      )
      .slice(0, 12)
      .reverse()
      .map((message) => ({
        id: message._id,
        role: message.role,
        participantId: message.chatParticipantId,
        speaker: message.participantName ??
          message.modelId ??
          (message.role === "user" ? "User" : "System"),
        content: message.content.slice(0, 2_000),
      }));
    return {
      userId: exchange.userId,
      wave: args.wave,
      frontierMessageIds: exchange.frontierMessageIds,
      participants: exchange.participantSnapshot.map((participant, index) => ({
        ...participant,
        roleSummary: personaRows[index]?.systemPrompt?.slice(0, 1_000),
      })),
      mentionedParticipantIds: exchange.mentionedParticipantIds,
      failedParticipantIds: exchange.failedParticipantIds,
      previousSpeakerIds,
      remainingMessageBudget: Math.max(
        0,
        exchange.bounds.maxParticipantMessages - exchange.publishedMessageCount,
      ),
      deadlineReached: Date.now() >= exchange.bounds.deadlineAt,
      recentMessages,
    };
  },
});
