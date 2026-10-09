import { resolveParentMessageIdsForSend } from "../../chat/mutation_send_helpers";
import { assertUserDataWritable } from "../../lib/write_fence";
import { telegramFile } from "./media_types";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalMutation } from "../../_generated/server";
import { durableWorkflow } from "../../execution/components";
import { createExecutionRun } from "../../execution/runs";
import { linkExecutionComponent } from "../../execution/component_refs";
import { sha256Hex } from "../../runtime_host/security";

export const receive=internalMutation({
  args:{files:v.optional(v.array(telegramFile)),botId:v.string(),updateId:v.number(),externalUserId:v.string(),externalChatId:v.string(),externalMessageId:v.number(),text:v.string(),kind:v.string(),replyToId:v.optional(v.number()),claimantName:v.string()},
  handler:async(ctx,args)=>{
    const duplicate=await ctx.db.query("channelInbox").withIndex("by_update",q=>q.eq("botId",args.botId).eq("updateId",args.updateId)).unique();
    if (duplicate) return duplicate._id;
    const identity=await ctx.db.query("channelIdentities").withIndex("by_external",q=>q.eq("botId",args.botId).eq("externalUserId",args.externalUserId)).unique();
    const bindings=identity?await ctx.db.query("channelBindings").withIndex("by_identity",q=>q.eq("identityId",identity._id)).collect():[];
    const binding=bindings.find(row=>row.active);
    const latest=await ctx.db.query("channelInbox").withIndex("by_external",q=>q.eq("botId",args.botId).eq("externalChatId",args.externalChatId)).order("desc").first();
    const token=/^\/start\s+([a-f0-9]{48})$/.exec(args.text)?.[1];
    const {claimantName:_claimantName,...stored}=args;
    const userId=identity?.active?identity.userId:undefined;
    const inboxId=await ctx.db.insert("channelInbox",{...stored,text:token?`/start ${await sha256Hex(token)}`:args.text,userId,
      identityId:identity?.active?identity._id:undefined,bindingId:binding?._id,bindingRevision:binding?.revision,chatId:binding?.chatId,
      status:"received",late:Boolean(latest&&latest.updateId>args.updateId),createdAt:Date.now()});
    let preparedMessageId;
    if (args.files?.length && !args.text.trim().startsWith("/") && args.kind !== "edit" && userId && binding?.active && identity?.externalChatId === args.externalChatId) {
      const chat = await ctx.db.get(binding.chatId);
      if (chat?.userId === userId && !chat.isDeleting) {
        await assertUserDataWritable(ctx,userId);
        const parents = await resolveParentMessageIdsForSend(ctx,{chatId:chat._id,activeBranchLeafId:chat.activeBranchLeafId,expandMultiModelGroups:true});
        preparedMessageId = await ctx.db.insert("messages",{userId,chatId:chat._id,role:"user",content:args.text || args.files[0].name,
          status:"pending",parentMessageIds:parents,inputProcessingNotice:"preparing_input",createdAt:Date.now()});
        await ctx.db.patch(inboxId,{canonicalMessageId:preparedMessageId});
        await ctx.db.patch(chat._id,{activeBranchLeafId:preparedMessageId,activeBranchLeafFocusOrder:undefined});
      }
    }
    const execution=await createExecutionRun(ctx,{userId:userId ?? `channel-transport:${args.botId}`,kind:"maintenance",requestedPlacement:"cloud",chatId:binding?.chatId,sourceMessageId:preparedMessageId,
      runKey:`telegram-inbox:${args.botId}:${args.updateId}`,domainType:"channel_inbox",domainId:String(inboxId),
      initialAttempt:{executorKind:"convex_workflow",placement:"cloud",adapterId:"convex-workflow",orchestrationEngine:"convex_workflow"}});
    await ctx.db.patch(inboxId, {admissionRunId: execution.runId});
    const workflowId=String(await durableWorkflow.start(ctx,internal.channels.telegram.inbox_workflow.run,{inboxId,claimantName:args.claimantName}, {onComplete: internal.channels.telegram.inbox_workflow.complete, context: {inboxId: inboxId, runId: execution.runId}}));
    await linkExecutionComponent(ctx,{...execution,adapterId:"convex-workflow",operationId:workflowId,role:"telegram-admission"});
    return inboxId;
  },
});
