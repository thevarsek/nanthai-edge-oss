import { v } from "convex/values";
import { internalQuery } from "../_generated/server";

export const pageMessages = internalQuery({
  args: { chatId: v.id("chats"), userId: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== args.userId || chat.isDeleting) throw new Error("CHAT_NOT_AVAILABLE");
    const deletion = await ctx.db.query("accountDeletionTombstones").withIndex("by_user", q => q.eq("userId", args.userId)).unique();
    if (deletion) throw new Error("ACCOUNT_DELETION_IN_PROGRESS");
    return await ctx.db.query("messages").withIndex("by_chat", q => q.eq("chatId", args.chatId))
      .order("asc").paginate({cursor: args.cursor, numItems: 128, maximumBytesRead: 250_000});
  },
});
export const scope = internalQuery({
  args: { jobId: v.id("generationJobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("GENERATION_JOB_MISSING");
    const chat = await ctx.db.get(job.chatId);
    const participantId = String(job.chatParticipantId ?? job.effectivePersonaConfig?.personaId ?? job.modelId);
    const summaries = await ctx.db.query("conversationSummaries")
      .withIndex("by_scope", q => q.eq("chatId", job.chatId).eq("participantId", participantId)).order("desc").take(1);
    const attempt = job.executionAttemptId ? await ctx.db.get(job.executionAttemptId) : null;
    return { job, chat, attempt, participantId, latest: summaries[0] ?? null };
  },
});
export const summary = internalQuery({
  args: { summaryId: v.id("conversationSummaries") },
  handler: async (ctx, args) => await ctx.db.get(args.summaryId),
});
export const sourcePage = internalQuery({
  args: { summaryId: v.id("conversationSummaries"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const head = await ctx.db.get(args.summaryId);
    if (!head) throw new Error("SUMMARY_MISSING");
    const query = head.sourceOperationId
      ? ctx.db.query("conversationSummarySources").withIndex("by_operation", q => q.eq("operationId", head.sourceOperationId))
      : ctx.db.query("conversationSummarySources").withIndex("by_summary", q => q.eq("summaryId", args.summaryId));
    return await query.paginate({cursor: args.cursor, numItems: 32});
  },
});
export const operation = internalQuery({
  args: { operationId: v.id("conversationCompactions") },
  handler: async (ctx, args) => {
    const operation = await ctx.db.get(args.operationId);
    if (!operation) throw new Error("COMPACTION_MISSING");
    const chunk = await ctx.db.query("conversationCompactionChunks")
      .withIndex("by_operation", q => q.eq("operationId", operation._id).eq("ordinal", operation.nextChunk)).unique();
    return {operation,chunk};
  },
});
