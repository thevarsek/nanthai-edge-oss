import { v } from "convex/values";
import { internal } from "../_generated/api";
import { mutation } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { durableWorkflow } from "../execution/components";
import { createExecutionRun } from "../execution/runs";
import { linkExecutionComponent } from "../execution/component_refs";
import { channelError } from "./linking_helpers";

export const retryInput=mutation({
  args:{inboxId:v.id("channelInbox")},handler:async(ctx,args)=>{
    const {userId}=await requireAuth(ctx);const item=await ctx.db.get(args.inboxId);
    if (!item || item.userId!==userId || item.status!=="failed") channelError("This retained input is not available to retry.");
    const identity=item.identityId?await ctx.db.get(item.identityId):null;
    const bindings=identity?await ctx.db.query("channelBindings").withIndex("by_identity", q=>q.eq("identityId",identity._id)).collect():[];
    const binding=bindings.find(row=>row.active && row.chatId===item.chatId && row.userId===userId);
    if (!identity?.active||!binding) channelError("The selected conversation changed. Choose its original conversation before retrying.");
    await ctx.db.patch(item._id,{status:"received",error:undefined,bindingId:binding._id,bindingRevision:binding.revision});
    if(item.files?.length && item.canonicalMessageId)await ctx.db.patch(item.canonicalMessageId,{status:"pending",inputProcessingNotice:"preparing_input"});
    const execution=await createExecutionRun(ctx,{userId,kind:"maintenance",requestedPlacement:"cloud",chatId:item.chatId,sourceMessageId:item.canonicalMessageId,runKey:`telegram-inbox-retry:${String(item._id)}:${Date.now()}`,domainType:"channel_inbox",domainId:String(item._id),
      initialAttempt:{executorKind:"convex_workflow",placement:"cloud",adapterId:"convex-workflow",orchestrationEngine:"convex_workflow"}});
    await ctx.db.patch(item._id, {admissionRunId: execution.runId});
    const workflowId=String(await durableWorkflow.start(ctx,internal.channels.telegram.inbox_workflow.run,{inboxId:item._id,claimantName:""}, {onComplete: internal.channels.telegram.inbox_workflow.complete, context: {inboxId: item._id, runId: execution.runId}}));
    await linkExecutionComponent(ctx,{...execution,adapterId:"convex-workflow",operationId:workflowId,role:"telegram-admission"});return null;
  },
});
