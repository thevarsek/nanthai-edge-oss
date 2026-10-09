import { conversationSummaryMessages } from "./conversation_context_prompt";
import { sha256Hex } from "../runtime_host/security";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { ContextMessage } from "./helpers_types";
import { loadConversationMessages, validSummary } from "./conversation_context_loading";
import { contextPrefixPlan, conversationSourceDigest, eligibleConversationMessages, summaryChunks } from "./conversation_context_policy";
import { getRequiredUserOpenRouterApiKey } from "../lib/user_secrets";
import { callOpenRouterNonStreaming } from "../lib/openrouter_nonstream";
import { withZdrProvider } from "../lib/openrouter_zdr";
import { MODEL_IDS } from "../lib/model_constants";

export const plan = internalAction({
  args:{jobId:v.id("generationJobs"),expand:v.boolean()},
  handler: async(ctx,args):Promise<Id<"conversationCompactions">|null> => {
    const {job,chat,attempt,participantId,latest}=await ctx.runQuery(internal.chat.conversation_context_queries.scope,{jobId:args.jobId});
    if (job.conversationContextPrepared) return null;
    await ctx.runMutation(internal.chat.conversation_context_mutations.markPreparing, {jobId: job._id});
    const raw=await loadConversationMessages(ctx,job.chatId,job.userId);
    const messages=eligibleConversationMessages(raw as unknown as ContextMessage[],String(job.messageId),args.expand);
    const head=await validSummary(ctx,latest,messages);
    const caps=await ctx.runQuery(internal.chat.queries.getModelCapabilities,{modelId:job.modelId});
    const coverage=head?.coverageCount ?? 0;
    const target=contextPrefixPlan(messages,coverage,caps?.contextLength ?? 75_000,head?.text,attempt?.placement === "local" ? 400 : Infinity);
    if (target===coverage) {
      await ctx.runMutation(internal.chat.conversation_context_mutations.capture,{jobId:job._id,summaryId:head?._id,expand:args.expand});
      return null;
    }
    const chunks=summaryChunks(messages.slice(coverage,target));
    const operationId=await ctx.runMutation(internal.chat.conversation_context_mutations.begin,{
      jobId:job._id,participantId,expand:args.expand,previousId:head?._id,sourceDigest:await conversationSourceDigest(messages.slice(0,target)),
      targetCount:target,coverageEndId:messages[target-1]._id as Id<"messages">,chunks:chunks.length,text:head?.text ?? "",
    });
    for (let i=0;i<target;i+=128) await ctx.runMutation(internal.chat.conversation_context_mutations.stageSources, {operationId, ordinal: i/128, messageIds: messages.slice(i, i+128 < target ? i+128 : target).map(message => message._id as Id<"messages">)});
    for (let i=0;i<chunks.length;i++) await ctx.runMutation(internal.chat.conversation_context_mutations.addChunk,{operationId,ordinal:i,content:chunks[i].content,messageIds:chunks[i].messageIds as Id<"messages">[]});
    if (!chat) throw new Error("CHAT_NOT_AVAILABLE");
    return operationId;
  },
});
export const compactChunk = internalAction({
  args:{operationId:v.id("conversationCompactions")},
  handler: compactChunkHandler,
});
export async function compactChunkHandler(ctx: ActionCtx, args: {operationId: Id<"conversationCompactions">}, deps = {
  apiKey: getRequiredUserOpenRouterApiKey, summarize: callOpenRouterNonStreaming,
}): Promise<boolean | {taskId: Id<"runtimeHelperTasks">}> {
    const {operation:op,chunk}=await ctx.runQuery(internal.chat.conversation_context_queries.operation,args);
    if (op.status==="completed") return true;
    const scope = await ctx.runQuery(internal.chat.conversation_context_queries.scope, {jobId: op.jobId});
    if (op.nextChunk===op.chunks) {
      const modelId = scope.attempt?.placement === "local" ? scope.attempt.modelId ?? "adapter_default" : MODEL_IDS.compaction;
      await ctx.runMutation(internal.chat.conversation_context_mutations.publish,{operationId:op._id,modelId}); return true;
    }
    if (!chunk) throw new Error("COMPACTION_CHUNK_MISSING");
    if (scope.attempt?.placement === "local") {
      const taskId = await ctx.runMutation(internal.chat.conversation_context_native.start, {operationId: op._id});
      return {taskId};
    }
    await ctx.runMutation(internal.chat.conversation_context_mutations.markCalling,{operationId:op._id,ordinal:chunk.ordinal});
    const apiKey=await deps.apiKey(ctx,op.userId);
    const prefs=await ctx.runQuery(internal.chat.queries.getUserPreferences,{userId:op.userId});
    const operationKey = `conversation-summary:${String(op._id)}:${chunk.ordinal}`;
    const journal = await ctx.runMutation(internal.execution.operations.prepare, {
      jobId: op.jobId, attemptId: op.attemptId, fence: op.fence, operationKey,
      toolName: "conversation_summary", toolCallId: operationKey, effect: "read", retry: "never",
      authorizationSource: "runtime_policy", inputHash: await sha256Hex(JSON.stringify({prior: op.text, source: chunk.content})),
    });
    if (journal.decision !== "execute") throw new Error("COMPACTION_OUTCOME_UNKNOWN");
    await ctx.runMutation(internal.execution.operations.markDispatched, {attemptId: op.attemptId, fence: op.fence, operationKey});
    const result=await deps.summarize(apiKey,MODEL_IDS.compaction,conversationSummaryMessages(op.text, chunk.content),withZdrProvider({temperature:0,maxTokens:4000},prefs?.zdrEnabled===true));
    await ctx.runMutation(internal.execution.operations.complete, {attemptId: op.attemptId, fence: op.fence, operationKey, resultJson: JSON.stringify({summary: result.content, generationId: result.generationId})});
    if (!result.content?.trim()) throw new Error("COMPACTION_EMPTY_RESULT");
    await ctx.runMutation(internal.chat.conversation_context_mutations.commitChunk,{operationId:op._id,ordinal:chunk.ordinal,text:result.content});
    if (result.usage) await ctx.runMutation(internal.chat.mutations.storeAncillaryCost,{
      messageId:(await ctx.runQuery(internal.chat.queries.getGenerationJobInternal,{jobId:op.jobId}))!.messageId,
      chatId:op.chatId,userId:op.userId,modelId:MODEL_IDS.compaction,source:"conversation_compaction",
      promptTokens:result.usage.promptTokens,completionTokens:result.usage.completionTokens,totalTokens:result.usage.totalTokens,
      cost:result.usage.cost,generationId:result.generationId ?? undefined,idempotencyKey:`conversation-compaction:${String(op._id)}:${chunk.ordinal}`,
    });
    return false;
}
