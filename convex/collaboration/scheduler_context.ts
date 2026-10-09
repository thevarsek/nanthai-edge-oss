import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { branchPathIds } from "../chat/helpers_utils";
import { eligibleWork } from "./work_context";
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
        replyToMessageIds: message.parentMessageIds,
      }));
    const workState = exchange.workEnabled ? await eligibleWork(ctx, exchange.chatId, exchange.workIds) : null;
    const work = workState?.rows.filter(row => row.status !== "done" && row.status !== "cancelled") ?? [];
    const available = exchange.participantSnapshot.filter(row => !exchange.activeParticipantIds.includes(row.participantId) && !exchange.failedParticipantIds.includes(row.participantId));
    return {
      work: work.map(row => ({ id: row._id, objective: row.objective, criteria: row.acceptanceCriteria, status: row.status, blocker: row.blocker,
        participantIds: available.filter(p => workState?.candidates.some(candidate => candidate._id === row._id && (candidate.status === "review" ? candidate.pendingReviewerIds.includes(p.participantId) : !candidate.assigneeId || candidate.assigneeId === p.participantId))).map(p => p.participantId) })),
      chatId: exchange.chatId,
      messageId: exchange.initiatingMessageId,
      userId: exchange.userId,
      wave: args.wave,
      consensusAutoStop: exchange.consensusAutoStop ?? false,
      frontierMessageIds: exchange.frontierMessageIds,
      participants: exchange.participantSnapshot.map((participant, index) => ({
        ...participant,
        modelId: personaRows[index]?.modelId ?? participant.modelId,
        displayName: personaRows[index]?.displayName ?? participant.displayName,
        roleSummary: personaRows[index]?.systemPrompt?.slice(0, 1_000),
      })),
      mentionedParticipantIds: exchange.mentionedParticipantIds,
      failedParticipantIds: [...new Set([...exchange.failedParticipantIds, ...exchange.activeParticipantIds])],
      previousSpeakerIds,
      remainingMessageBudget: Math.max(
        0,
        exchange.bounds.maxParticipantMessages - exchange.publishedMessageCount - exchange.activeParticipantIds.length,
      ),
      deadlineReached: Date.now() >= exchange.bounds.deadlineAt,
      deadlineAt: exchange.bounds.deadlineAt,
      recentMessages,
    };
  },
});
