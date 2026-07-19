import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../_generated/server";

type SettledOutcome = "completed" | "failed" | "skipped";

const turnArgs = {
  sessionId: v.id("autonomousSessions"),
  cycle: v.number(),
  participantIndex: v.number(),
  executionEpoch: v.optional(v.number()),
};

function matchesTurn(
  session: Doc<"autonomousSessions">,
  args: { cycle: number; participantIndex: number; executionEpoch?: number },
): boolean {
  return session.activeTurnCycle === args.cycle
    && session.activeTurnParticipantIndex === args.participantIndex
    && session.activeTurnExecutionEpoch === args.executionEpoch;
}

function matchesSettledTurn(
  session: Doc<"autonomousSessions">,
  args: { cycle: number; participantIndex: number; executionEpoch?: number },
): boolean {
  return session.lastSettledTurnCycle === args.cycle
    && session.lastSettledTurnParticipantIndex === args.participantIndex
    && session.lastSettledTurnExecutionEpoch === args.executionEpoch;
}

async function clearAbandonedTurn(
  ctx: MutationCtx,
  session: Doc<"autonomousSessions">,
): Promise<void> {
  const message = session.activeTurnMessageId
    ? await ctx.db.get(session.activeTurnMessageId)
    : null;
  if (session.activeTurnJobId) {
    const job = await ctx.db.get(session.activeTurnJobId);
    if (job && job.status !== "completed") await ctx.db.delete(job._id);
  }
  if (message && message.status !== "completed") {
    const chat = await ctx.db.get(message.chatId);
    await ctx.db.delete(message._id);
    if (chat) {
      await ctx.db.patch(chat._id, {
        messageCount: Math.max((chat.messageCount ?? 1) - 1, 0),
        activeBranchLeafId: chat.activeBranchLeafId === message._id
          ? message.parentMessageIds[0]
          : chat.activeBranchLeafId,
        activeBranchLeafFocusOrder: undefined,
        updatedAt: Date.now(),
      });
    }
  }
  await ctx.db.patch(session._id, {
    activeTurnCycle: undefined,
    activeTurnParticipantIndex: undefined,
    activeTurnExecutionEpoch: undefined,
    activeTurnMessageId: undefined,
    activeTurnJobId: undefined,
    updatedAt: Date.now(),
  });
}

async function settleTurn(
  ctx: MutationCtx,
  session: Doc<"autonomousSessions">,
  args: {
    cycle: number;
    participantIndex: number;
    executionEpoch?: number;
    outcome: SettledOutcome;
    messageId?: Id<"messages">;
  },
): Promise<void> {
  const messageId = args.messageId ?? session.activeTurnMessageId;
  if (args.outcome === "completed" && messageId) {
    const message = await ctx.db.get(messageId);
    if (message?.status !== "completed") return;
    const chat = await ctx.db.get(message.chatId);
    if (chat) {
      await ctx.db.patch(chat._id, {
        activeBranchLeafId: message._id,
        activeBranchLeafFocusOrder: undefined,
        updatedAt: Date.now(),
      });
    }
    await ctx.db.patch(session._id, { parentMessageIds: [message._id] });
  }
  await ctx.db.patch(session._id, {
    lastSettledTurnCycle: args.cycle,
    lastSettledTurnParticipantIndex: args.participantIndex,
    lastSettledTurnExecutionEpoch: args.executionEpoch,
    lastSettledTurnOutcome: args.outcome,
    activeTurnCycle: undefined,
    activeTurnParticipantIndex: undefined,
    activeTurnExecutionEpoch: undefined,
    activeTurnMessageId: undefined,
    activeTurnJobId: undefined,
    updatedAt: Date.now(),
  });
}

export const recoverTurn = internalMutation({
  args: turnArgs,
  returns: v.union(
    v.literal("execute"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("skipped"),
    v.literal("terminal"),
  ),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status !== "running" ||
        (args.executionEpoch !== undefined && session.executionEpoch !== args.executionEpoch)) {
      return "terminal" as const;
    }
    if (matchesSettledTurn(session, args) && session.lastSettledTurnOutcome) {
      return session.lastSettledTurnOutcome;
    }
    if (matchesTurn(session, args) && session.activeTurnMessageId) {
      const message = await ctx.db.get(session.activeTurnMessageId);
      if (message?.status === "completed") {
        await settleTurn(ctx, session, { ...args, outcome: "completed", messageId: message._id });
        return "completed" as const;
      }
      if (message?.status === "failed" || message?.status === "cancelled") {
        await settleTurn(ctx, session, { ...args, outcome: "failed" });
        return "failed" as const;
      }
    }
    if (session.activeTurnCycle !== undefined) await clearAbandonedTurn(ctx, session);
    await ctx.db.patch(session._id, {
      activeTurnCycle: args.cycle,
      activeTurnParticipantIndex: args.participantIndex,
      activeTurnExecutionEpoch: args.executionEpoch,
      activeTurnMessageId: undefined,
      activeTurnJobId: undefined,
      updatedAt: Date.now(),
    });
    return "execute" as const;
  },
});

export const settle = internalMutation({
  args: {
    ...turnArgs,
    outcome: v.union(v.literal("completed"), v.literal("failed"), v.literal("skipped")),
    messageId: v.optional(v.id("messages")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.status !== "running" || !matchesTurn(session, args)) return null;
    if (args.outcome !== "completed" && session.activeTurnMessageId) {
      const message = await ctx.db.get(session.activeTurnMessageId);
      if (message?.status === "completed") {
        await settleTurn(ctx, session, {
          ...args,
          outcome: "completed",
          messageId: message._id,
        });
        return null;
      }
    }
    await settleTurn(ctx, session, args);
    return null;
  },
});
