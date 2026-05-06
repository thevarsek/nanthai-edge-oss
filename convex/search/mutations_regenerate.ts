import { mutation, MutationCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "../_generated/api";
import { requireAuth, requirePro } from "../lib/auth";
import { Id } from "../_generated/dataModel";

export interface RegeneratePaperArgs extends Record<string, unknown> {
  sessionId: Id<"searchSessions">;
  modelId: string;
  personaId?: Id<"personas">;
  personaName?: string;
  personaEmoji?: string;
  personaAvatarImageUrl?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number | null;
  includeReasoning?: boolean | null;
  reasoningEffort?: string | null;
  enabledIntegrations?: string[];
  subagentsEnabled?: boolean;
}

export const regeneratePaper = mutation({
  args: {
    sessionId: v.id("searchSessions"),
    modelId: v.string(),
    personaId: v.optional(v.id("personas")),
    personaName: v.optional(v.string()),
    personaEmoji: v.optional(v.string()),
    personaAvatarImageUrl: v.optional(v.string()),
    systemPrompt: v.optional(v.string()),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.union(v.number(), v.null())),
    includeReasoning: v.optional(v.union(v.boolean(), v.null())),
    reasoningEffort: v.optional(v.union(v.string(), v.null())),
    enabledIntegrations: v.optional(v.array(v.string())),
    subagentsEnabled: v.optional(v.boolean()),
  },
  returns: v.object({
    assistantMessageId: v.id("messages"),
  }),
  handler: regeneratePaperHandler,
});

export async function regeneratePaperHandler(
  ctx: MutationCtx,
  args: RegeneratePaperArgs,
): Promise<{ assistantMessageId: Id<"messages"> }> {
  const { userId } = await requireAuth(ctx);
  await requirePro(ctx, userId);
  const now = Date.now();

  const sourceSession = await ctx.db.get(args.sessionId);
  if (!sourceSession || sourceSession.userId !== userId) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Search session not found" });
  }
  if (sourceSession.mode !== "paper") {
    throw new ConvexError({ code: "VALIDATION", message: "Can only regenerate research paper sessions" });
  }
  if (sourceSession.status !== "completed" && sourceSession.status !== "failed") {
    throw new ConvexError({ code: "VALIDATION", message: "Can only regenerate from a completed or failed research paper" });
  }

  const originalMessage = await ctx.db.get(sourceSession.assistantMessageId);
  if (!originalMessage) {
    throw new ConvexError({ code: "NOT_FOUND", message: "Original message not found" });
  }

  const assistantMessageId = await ctx.db.insert("messages", {
    chatId: sourceSession.chatId,
    userId,
    role: "assistant",
    content: "",
    modelId: args.modelId,
    participantId: args.personaId,
    participantName: args.personaName,
    participantEmoji: args.personaEmoji,
    participantAvatarImageUrl: args.personaAvatarImageUrl,
    parentMessageIds: originalMessage.parentMessageIds,
    status: "pending",
    createdAt: now,
  });

  const jobId = await ctx.db.insert("generationJobs", {
    chatId: sourceSession.chatId,
    messageId: assistantMessageId,
    userId,
    modelId: args.modelId,
    status: "queued",
    createdAt: now,
  });

  const regenerationSessionId = await ctx.db.insert("searchSessions", {
    chatId: sourceSession.chatId,
    userId,
    assistantMessageId,
    query: sourceSession.query,
    mode: "paper",
    complexity: sourceSession.complexity,
    status: "writing",
    progress: 90,
    currentPhase: "writing",
    phaseOrder: 0,
    participantId: args.personaId ?? undefined,
    startedAt: now,
  });

  await ctx.db.patch(assistantMessageId, { searchSessionId: regenerationSessionId });

  await ctx.scheduler.runAfter(
    0,
    internal.search.actions.regeneratePaperAction,
    {
      sessionId: regenerationSessionId,
      sourceSessionId: args.sessionId,
      assistantMessageId,
      jobId,
      chatId: sourceSession.chatId,
      userId,
      modelId: args.modelId,
      personaId: args.personaId ?? undefined,
      systemPrompt: args.systemPrompt ?? undefined,
      temperature: args.temperature ?? undefined,
      maxTokens: args.maxTokens ?? undefined,
      includeReasoning: args.includeReasoning ?? undefined,
      reasoningEffort: args.reasoningEffort ?? undefined,
      enabledIntegrations: args.enabledIntegrations,
      subagentsEnabled: false,
    },
  );

  const chat = await ctx.db.get(sourceSession.chatId);
  if (chat) {
    await ctx.db.patch(chat._id, {
      updatedAt: now,
      lastMessageDate: now,
      activeBranchLeafId: assistantMessageId,
      messageCount: (chat.messageCount ?? 0) + 1,
    });
  }

  return { assistantMessageId };
}
