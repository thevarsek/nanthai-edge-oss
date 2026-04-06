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
  chatId: Id<"chats">;
  userId: string;
  modelId: string;
  participantId: string;
  participantName: string;
  personaId?: Id<"personas"> | null;
  parentMessageIds: Id<"messages">[];
  moderatorDirective?: string;
}

export async function createAutonomousMessageHandler(
  ctx: MutationCtx,
  args: CreateAutonomousMessageArgs,
): Promise<Id<"messages">> {
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
  });

  return messageId;
}

/** Create an assistant message for an autonomous turn. */
export const createAutonomousMessage = internalMutation({
  args: {
    chatId: v.id("chats"),
    userId: v.string(),
    modelId: v.string(),
    participantId: v.string(),
    participantName: v.string(),
    personaId: v.optional(v.union(v.id("personas"), v.null())),
    parentMessageIds: v.array(v.id("messages")),
    moderatorDirective: v.optional(v.string()),
  },
  returns: v.id("messages"),
  handler: createAutonomousMessageHandler,
});

/** Update chat branch leaf to a completed autonomous message. */
export const setChatActiveLeaf = internalMutation({
  args: {
    chatId: v.id("chats"),
    messageId: v.id("messages"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.chatId, {
      activeBranchLeafId: args.messageId,
      updatedAt: Date.now(),
    });
  },
});

/** Create a generation job for an autonomous turn. */
export const createGenerationJob = internalMutation({
  args: {
    chatId: v.id("chats"),
    messageId: v.id("messages"),
    modelId: v.string(),
    userId: v.string(),
  },
  returns: v.id("generationJobs"),
  handler: async (ctx, args) => {
    const now = Date.now();

    return await ctx.db.insert("generationJobs", {
      chatId: args.chatId,
      messageId: args.messageId,
      userId: args.userId,
      modelId: args.modelId,
      status: "queued",
      createdAt: now,
    });
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
