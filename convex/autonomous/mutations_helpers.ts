// convex/autonomous/mutations_helpers.ts
// =============================================================================
// Internal helper mutations for autonomous actions.
//
// These are low-level DB operations called from the runCycle action that need
// to run as separate mutations (actions can't access ctx.db directly).
// =============================================================================

import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";

export interface CreateAutonomousMessageArgs extends Record<string, unknown> {
  sessionId?: Id<"autonomousSessions">;
  executionEpoch?: number;
  chatId: Id<"chats">;
  userId: string;
  modelId: string;
  participantId: string;
  participantName?: string;
  personaId?: Id<"personas"> | null;
  parentMessageIds: Id<"messages">[];
  moderatorDirective?: string;
  turnCycle?: number;
  turnParticipantIndex?: number;
}

export async function createAutonomousMessageHandler(
  ctx: MutationCtx,
  args: CreateAutonomousMessageArgs,
): Promise<Id<"messages"> | null> {
  if (args.sessionId) {
    const session = await ctx.db.get(args.sessionId);
    if (
      !session
      || session.status !== "running"
      || (args.executionEpoch !== undefined
        && session.executionEpoch !== args.executionEpoch)
      || (args.turnCycle !== undefined && (
        session.activeTurnCycle !== args.turnCycle
        || session.activeTurnParticipantIndex !== args.turnParticipantIndex
        || session.activeTurnExecutionEpoch !== args.executionEpoch
      ))
    ) {
      return null;
    }
  }
  const now = Date.now();

  const messageId = await ctx.db.insert("messages", {
    chatId: args.chatId,
    userId: args.userId,
    role: "assistant",
    content: "",
    modelId: args.modelId,
    participantId: args.personaId ?? undefined,
    participantName: args.participantName,
    autonomousParticipantId: args.participantId,
    parentMessageIds: args.parentMessageIds,
    moderatorDirective: args.moderatorDirective,
    status: "pending",
    createdAt: now,
  });

  // Move active leaf immediately so branch-aware UIs can render streaming content.
  const chat = await ctx.db.get(args.chatId);
  await ctx.db.patch(args.chatId, {
    updatedAt: now,
    messageCount: (chat?.messageCount ?? 0) + 1,
    activeBranchLeafId: messageId,
    activeBranchLeafFocusOrder: undefined,
  });
  if (args.sessionId && args.turnCycle !== undefined && args.turnParticipantIndex !== undefined) {
    const session = await ctx.db.get(args.sessionId);
    if (
      session?.activeTurnCycle === args.turnCycle
      && session.activeTurnParticipantIndex === args.turnParticipantIndex
      && session.activeTurnExecutionEpoch === args.executionEpoch
    ) {
      await ctx.db.patch(session._id, { activeTurnMessageId: messageId, updatedAt: now });
    }
  }

  return messageId;
}

/** Create an assistant message for an autonomous turn. */
export const createAutonomousMessage = internalMutation({
  args: {
    sessionId: v.optional(v.id("autonomousSessions")),
    executionEpoch: v.optional(v.number()),
    chatId: v.id("chats"),
    userId: v.string(),
    modelId: v.string(),
    participantId: v.string(),
    participantName: v.optional(v.string()),
    personaId: v.optional(v.union(v.id("personas"), v.null())),
    parentMessageIds: v.array(v.id("messages")),
    moderatorDirective: v.optional(v.string()),
    turnCycle: v.optional(v.number()),
    turnParticipantIndex: v.optional(v.number()),
  },
  returns: v.union(v.id("messages"), v.null()),
  handler: createAutonomousMessageHandler,
});

/** Update chat branch leaf to a completed autonomous message. */
export const setChatActiveLeaf = internalMutation({
  args: {
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    sessionId: v.optional(v.id("autonomousSessions")),
    executionEpoch: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.sessionId) {
      const session = await ctx.db.get(args.sessionId);
      if (
        !session
        || session.status !== "running"
        || (args.executionEpoch !== undefined
          && session.executionEpoch !== args.executionEpoch)
      ) return;
    }
    await ctx.db.patch(args.chatId, {
      activeBranchLeafId: args.messageId,
      activeBranchLeafFocusOrder: undefined,
      updatedAt: Date.now(),
    });
  },
});

/** Create a generation job for an autonomous turn. */
export const createGenerationJob = internalMutation({
  args: {
    sessionId: v.optional(v.id("autonomousSessions")),
    executionEpoch: v.optional(v.number()),
    executionAttemptId: v.optional(v.id("executionAttempts")),
    executionFence: v.optional(v.number()),
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    modelId: v.string(),
    userId: v.string(),
    turnCycle: v.optional(v.number()),
    turnParticipantIndex: v.optional(v.number()),
  },
  returns: v.union(v.id("generationJobs"), v.null()),
  handler: async (ctx, args) => {
    if (args.sessionId) {
      const session = await ctx.db.get(args.sessionId);
      if (
        !session
        || session.status !== "running"
        || (args.executionEpoch !== undefined
          && session.executionEpoch !== args.executionEpoch)
        || (args.turnCycle !== undefined && (
          session.activeTurnCycle !== args.turnCycle
          || session.activeTurnParticipantIndex !== args.turnParticipantIndex
          || session.activeTurnExecutionEpoch !== args.executionEpoch
          || session.activeTurnMessageId !== args.messageId
        ))
      ) return null;
    }
    const now = Date.now();

    const jobId = await ctx.db.insert("generationJobs", {
      chatId: args.chatId,
      messageId: args.messageId,
      userId: args.userId,
      modelId: args.modelId,
      status: "queued",
      createdAt: now,
    });
    if (args.sessionId && args.turnCycle !== undefined && args.turnParticipantIndex !== undefined) {
      const session = await ctx.db.get(args.sessionId);
      if (
        session?.activeTurnCycle === args.turnCycle
        && session.activeTurnParticipantIndex === args.turnParticipantIndex
        && session.activeTurnExecutionEpoch === args.executionEpoch
        && session.activeTurnMessageId === args.messageId
      ) {
        await ctx.db.patch(session._id, { activeTurnJobId: jobId, updatedAt: now });
      }
    }
    return jobId;
  },
});

/** Delete a message (for failed/empty autonomous turns). */
export const deleteMessage = internalMutation({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const msg = await ctx.db.get(args.messageId);
    if (msg) {
      await ctx.db.delete(args.messageId);
      const chat = await ctx.db.get(msg.chatId);
      if (chat) {
        const nextCount = Math.max((chat.messageCount ?? 1) - 1, 0);
        const patch: Record<string, unknown> = {
          messageCount: nextCount,
          updatedAt: Date.now(),
        };
        if (chat.activeBranchLeafId === msg._id) {
          patch.activeBranchLeafId = msg.parentMessageIds[0];
          patch.activeBranchLeafFocusOrder = undefined;
        }
        await ctx.db.patch(chat._id, patch);
      }
    }
  },
});

/** Delete a generation job (for failed/empty autonomous turns). */
export const deleteGenerationJob = internalMutation({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (job) {
      await ctx.db.delete(args.jobId);
    }
  },
});
