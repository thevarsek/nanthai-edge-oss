import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { assertCurrentExecution } from "../execution/attempts";
import { CONVERSATION_CONTEXT_POLICY } from "./conversation_context_policy";

export async function assertContextJob(ctx: MutationCtx, jobId: Id<"generationJobs">) {
  const job = await ctx.db.get(jobId);
  if (!job?.executionAttemptId || job.executionFence === undefined || !job.executionRunId) throw new Error("CONTEXT_EXECUTION_MISSING");
  await assertCurrentExecution(ctx, {attemptId:job.executionAttemptId,fence:job.executionFence,allowWaiting:true});
  return job;
}
export const capture = internalMutation({
  args: {jobId:v.id("generationJobs"), summaryId:v.optional(v.id("conversationSummaries")),expand:v.boolean()},
  handler: async (ctx,args) => {
    const job = await assertContextJob(ctx,args.jobId);
    if (job.conversationContextPrepared) return null;
    if (args.summaryId) {
      const summary = await ctx.db.get(args.summaryId);
      if (!summary || summary.userId !== job.userId || summary.chatId !== job.chatId) throw new Error("SUMMARY_NOT_OWNED");
    }
    await ctx.db.patch(job._id,{conversationSummaryId:args.summaryId,conversationContextPrepared:true,conversationContextPreparing:false,conversationContextExpand:args.expand});
    await ctx.db.patch(job.messageId, {conversationSummaryId: args.summaryId});
    return null;
  },
});
export const begin = internalMutation({
  args: {jobId:v.id("generationJobs"),participantId:v.string(),expand:v.boolean(), previousId:v.optional(v.id("conversationSummaries")),
    sourceDigest:v.string(),targetCount:v.number(),coverageEndId:v.id("messages"),chunks:v.number(),text:v.string()},
  handler: async (ctx,args) => {
    const job = await assertContextJob(ctx,args.jobId);
    const existing = await ctx.db.query("conversationCompactions").withIndex("by_job", q=>q.eq("jobId",job._id)).unique();
    if (existing) return existing._id;
    const chat = await ctx.db.get(job.chatId);
    return await ctx.db.insert("conversationCompactions",{...args,userId:job.userId,chatId:job.chatId,
      sourceRevision:chat?.conversationSourceRevision ?? 0,runId:job.executionRunId!,attemptId:job.executionAttemptId!,fence:job.executionFence!,
      status:"preparing",nextChunk:0,stagedSourceCount:0,createdAt:Date.now()});
  },
});
export const addChunk = internalMutation({
  args: {operationId:v.id("conversationCompactions"),ordinal:v.number(),content:v.string(),messageIds:v.array(v.id("messages"))},
  handler: async (ctx,args) => {
    const op = await ctx.db.get(args.operationId); if (!op) throw new Error("COMPACTION_MISSING");
    await assertCurrentExecution(ctx,{attemptId:op.attemptId,fence:op.fence,allowWaiting:true});
    const existing = await ctx.db.query("conversationCompactionChunks").withIndex("by_operation",q=>q.eq("operationId",op._id).eq("ordinal",args.ordinal)).unique();
    if (!existing) await ctx.db.insert("conversationCompactionChunks",{...args,userId:op.userId,chatId:op.chatId,status:"pending"});
    if (args.ordinal === op.chunks-1) await ctx.db.patch(op._id,{status:"running"});
    return null;
  },
});
export const markCalling = internalMutation({
  args: {operationId:v.id("conversationCompactions"),ordinal:v.number()},
  handler: async(ctx,args) => {
    const op = await ctx.db.get(args.operationId); if (!op) throw new Error("COMPACTION_MISSING");
    await assertCurrentExecution(ctx,{attemptId:op.attemptId,fence:op.fence,allowWaiting:true});
    const chunk = await ctx.db.query("conversationCompactionChunks").withIndex("by_operation",q=>q.eq("operationId",op._id).eq("ordinal",args.ordinal)).unique();
    if (!chunk || op.nextChunk !== args.ordinal || chunk.status !== "pending") throw new Error("COMPACTION_OUTCOME_UNKNOWN");
    await ctx.db.patch(chunk._id,{status:"calling"});
    return null;
  },
});
export const commitChunk = internalMutation({
  args: {operationId:v.id("conversationCompactions"),ordinal:v.number(),text:v.string()},
  handler: async(ctx,args) => {
    const op = await ctx.db.get(args.operationId); if (!op) throw new Error("COMPACTION_MISSING");
    await assertCurrentExecution(ctx,{attemptId:op.attemptId,fence:op.fence,allowWaiting:true});
    if (!args.text.trim()) throw new Error("COMPACTION_EMPTY_RESULT");
    const chat=await ctx.db.get(op.chatId);
    if ((chat?.conversationSourceRevision ?? 0) !== op.sourceRevision) throw new Error("COMPACTION_SOURCE_CHANGED");
    const chunk=await ctx.db.query("conversationCompactionChunks").withIndex("by_operation",q=>q.eq("operationId",op._id).eq("ordinal",args.ordinal)).unique();
    if (!chunk || chunk.status !== "calling" || op.nextChunk !== args.ordinal) throw new Error("COMPACTION_STALE_RESULT");
    await ctx.db.patch(chunk._id,{status:"completed",result:args.text});
    await ctx.db.patch(op._id,{text:args.text,nextChunk:args.ordinal+1});
    return null;
  },
});
export const publish = internalMutation({
  args:{operationId:v.id("conversationCompactions"),modelId:v.string()},
  handler: async(ctx,args) => {
    const op=await ctx.db.get(args.operationId); if (!op) throw new Error("COMPACTION_MISSING");
    if (op.summaryId) return op.summaryId;
    await assertCurrentExecution(ctx,{attemptId:op.attemptId,fence:op.fence,allowWaiting:true});
    const chat=await ctx.db.get(op.chatId);
    if ((chat?.conversationSourceRevision ?? 0)!==op.sourceRevision || op.nextChunk!==op.chunks || op.stagedSourceCount!==op.targetCount || !op.text.trim()) throw new Error("COMPACTION_NOT_PUBLISHABLE");
    const latest=await ctx.db.query("conversationSummaries").withIndex("by_scope",q=>q.eq("chatId",op.chatId).eq("participantId",op.participantId)).order("desc").first();
    // Different forks may rebuild; a competing publisher must still match the captured head.
    if (latest && latest._id!==op.previousId && latest.createdAt>op.createdAt) throw new Error("COMPACTION_HEAD_CHANGED");
    const summaryId=await ctx.db.insert("conversationSummaries",{
      userId:op.userId,chatId:op.chatId,participantId:op.participantId,previousId:op.previousId,sourceOperationId:op._id,
      sourceDigest:op.sourceDigest,coverageCount:op.targetCount,coverageEndId:op.coverageEndId,
      text:op.text,policyVersion:CONVERSATION_CONTEXT_POLICY,modelId:args.modelId,createdAt:Date.now(),
      runId:op.runId,attemptId:op.attemptId,fence:op.fence,
    });
    await ctx.db.patch(op._id,{status:"completed",summaryId});
    await ctx.db.patch(op.jobId,{conversationSummaryId:summaryId,conversationContextPrepared:true,conversationContextPreparing:false,conversationContextExpand:op.expand});
    const job = await ctx.db.get(op.jobId);
    if (job) await ctx.db.patch(job.messageId, {conversationSummaryId: summaryId});
    return summaryId;
  },
});

// Stage the exact manifest in bounded writes. Publication only moves the head;
// it never rereads every provider chunk or rewrites a large manifest atomically.
export const stageSources = internalMutation({
  args: {operationId: v.id("conversationCompactions"), ordinal: v.number(), messageIds: v.array(v.id("messages"))},
  handler: async (ctx, args) => {
    const op = await ctx.db.get(args.operationId);
    if (!op) throw new Error("COMPACTION_MISSING");
    await assertCurrentExecution(ctx, {attemptId: op.attemptId, fence: op.fence, allowWaiting: true});
    const existing = await ctx.db.query("conversationSummarySources").withIndex("by_operation", q => q.eq("operationId", op._id).eq("ordinal", args.ordinal)).unique();
    if (existing) {
      if (JSON.stringify(existing.messageIds) !== JSON.stringify(args.messageIds)) throw new Error("COMPACTION_SOURCE_CHANGED");
      return null;
    }
    if (!args.messageIds.length || args.messageIds.length > 128 || args.ordinal * 128 !== op.stagedSourceCount || op.stagedSourceCount + args.messageIds.length > op.targetCount) throw new Error("COMPACTION_COVERAGE_MISMATCH");
    await ctx.db.insert("conversationSummarySources", {...args, userId: op.userId, chatId: op.chatId});
    await ctx.db.patch(op._id, {stagedSourceCount: op.stagedSourceCount + args.messageIds.length});
    return null;
  },
});

export const markPreparing = internalMutation({
  args: {jobId: v.id("generationJobs")},
  handler: async (ctx, {jobId}) => {
    const job = await assertContextJob(ctx, jobId);
    if (!job.conversationContextPrepared) await ctx.db.patch(jobId, {conversationContextPreparing: true});
    return null;
  },
});
