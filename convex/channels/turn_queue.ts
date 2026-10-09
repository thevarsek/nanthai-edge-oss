import { ownedWorkflowCompletionRef } from "../execution/workflow_lifecycle";
import { cancelExecutionForGenerationJob } from "../execution/cancellation";
import { v } from "convex/values";
import type { EventId,WorkflowId } from "@convex-dev/workflow";
import { internal } from "../_generated/api";
import { internalMutation,type MutationCtx } from "../_generated/server";
import type { RunGenerationArgs } from "../chat/actions_run_generation_types";
import type { Id } from "../_generated/dataModel";
import { runGenerationArgs } from "../chat/actions_args";
import { durableWorkflow } from "../execution/components";
import { linkExecutionComponent } from "../execution/component_refs";
import { isIgnorableResumeSignalError } from "../chat/workflow_resume_handlers";
import { resolvePreparedMediaParents } from "./turn_ancestry";

export async function enqueueBoundConversation(ctx:MutationCtx,args:RunGenerationArgs):Promise<string|null> {
  if ((await ctx.db.get(args.chatId))?.channelConversation !== true) return null;
  const bindings=await ctx.db.query("channelBindings").withIndex("by_chat",q=>q.eq("chatId",args.chatId)).collect();
  if (!bindings.some(binding=>binding.active)) return null;
  const generationJobId=args.generationJobIds[0];
  const existing=await ctx.db.query("channelTurns").withIndex("by_generation_job",q=>q.eq("generationJobId",generationJobId)).unique();
  if (existing) return existing.workflowId ?? String(existing._id);
  const previous=await ctx.db.query("channelTurns").withIndex("by_message",q=>q.eq("userMessageId",args.userMessageId)).first();
  // Existing rows predate the per-generation identity. Adopt only their own job.
  if (previous && !previous.generationJobId && previous.generationArgs.generationJobIds[0]===generationJobId) {
    await ctx.db.patch(previous._id,{generationJobId});
    return previous.workflowId ?? String(previous._id);
  }
  const job=await ctx.db.get(generationJobId);
  if (!job?.executionRunId) throw new Error("CHANNEL_TURN_EXECUTION_MISSING");
  // Initial media keeps its receipt position; a retry joins at its new job's time.
  const createdAt=previous ? job.createdAt : (await ctx.db.get(args.userMessageId))?.createdAt ?? job.createdAt;
  const turnId=await ctx.db.insert("channelTurns",{userId:args.userId,chatId:args.chatId,userMessageId:args.userMessageId,generationJobId,generationArgs:args,status:"queued",createdAt});
  const workflowId=String(await durableWorkflow.start(ctx,internal.channels.turn_workflow.run,{turnId}, {onComplete: ownedWorkflowCompletionRef, context: {}}));
  await ctx.db.patch(turnId,{workflowId});
  await linkExecutionComponent(ctx,{runId:job.executionRunId,adapterId:"convex-workflow",operationId:workflowId,role:"channel-turn-admission"});
  return workflowId;
}
export const enqueue=internalMutation({args:{generationArgs:v.object(runGenerationArgs)},returns:v.union(v.string(),v.null()),handler:async(ctx,args)=>await enqueueBoundConversation(ctx,args.generationArgs)});
export async function wakeChannelTurns(ctx:MutationCtx,chatId:Id<"chats">) {
  if ((await ctx.db.get(chatId))?.channelConversation !== true) return;
  const running = await ctx.db.query("channelTurns").withIndex("by_chat_status", q => q.eq("chatId", chatId).eq("status", "running")).first();
  const queued = await ctx.db.query("channelTurns").withIndex("by_chat_status_createdAt", q => q.eq("chatId", chatId).eq("status", "queued")).first();
  const turns = [running, queued].filter((turn): turn is NonNullable<typeof turn> => Boolean(turn));
  for (const turn of turns) {
    if (!["completed", "failed", "cancelled"].includes(turn.status)) {
      const jobs = await Promise.all(turn.generationArgs.generationJobIds.map(id => ctx.db.get(id)));
      const messages = await Promise.all(turn.generationArgs.assistantMessageIds.map(id => ctx.db.get(id)));
      if (jobs.every(job => !job || ["completed", "failed", "cancelled", "timedOut"].includes(job.status))
        && messages.every(message => !message || !["pending", "streaming"].includes(message.status))) {
        await ctx.db.patch(turn._id, { status: jobs.some(job => job?.status === "cancelled") ? "cancelled" : "completed" });
      }
    }
    if (!turn.wakeEventId) continue;
    try {await durableWorkflow.sendEvent(ctx,{id:turn.wakeEventId as EventId<string>,validator:v.null(),value:null});}
    catch(error){if (!isIgnorableResumeSignalError(error)) throw error;}
    await ctx.db.patch(turn._id,{wakeEventId:undefined});
  }
}
export const advance=internalMutation({
  args:{turnId:v.id("channelTurns")},handler:async(ctx,args):Promise<{done:boolean;eventId?:string}>=>{
    const turn=await ctx.db.get(args.turnId); if (!turn || ["completed","cancelled","failed"].includes(turn.status)) return {done:true};
    const jobs=await Promise.all(turn.generationArgs.generationJobIds.map(id=>ctx.db.get(id)));
    const terminal=jobs.every(job=>!job || ["completed","failed","cancelled","timedOut"].includes(job.status));
    const messages=await Promise.all(turn.generationArgs.assistantMessageIds.map(id=>ctx.db.get(id)));
    if (terminal && messages.every(message=>!message || !["pending","streaming"].includes(message.status))) {
      await ctx.db.patch(turn._id,{status:jobs.some(job=>job?.status==="cancelled")?"cancelled":"completed"});
      await wakeChannelTurns(ctx,turn.chatId);return {done:true};
    }
    if (!turn.workflowId) throw new Error("CHANNEL_TURN_WORKFLOW_MISSING");
    const eventId=turn.wakeEventId ?? String(await durableWorkflow.createEvent(ctx,{workflowId:turn.workflowId as WorkflowId,name:`turn:${Date.now()}`}));
    await ctx.db.patch(turn._id,{wakeEventId:eventId});
    const firstQueued = await ctx.db.query("channelTurns").withIndex("by_chat_status_createdAt", q => q.eq("chatId", turn.chatId).eq("status", "queued")).order("asc").first();
    const running = await ctx.db.query("channelTurns").withIndex("by_chat_status", q => q.eq("chatId", turn.chatId).eq("status", "running")).first();
    const preparing = await ctx.db.query("channelInbox").withIndex("by_chat_status", q => q.eq("chatId",turn.chatId).eq("status","received")).order("asc").take(20);
    const requiredInputPending = preparing.some(item => item.files?.length && item.canonicalMessageId !== turn.userMessageId && item.createdAt <= turn.createdAt);
    const activeBefore = requiredInputPending || Boolean((firstQueued && firstQueued._id !== turn._id) || (running && running._id !== turn._id));
    if (turn.status==="queued" && !activeBefore) {
      const inbox=await ctx.db.query("channelInbox").withIndex("by_message",q=>q.eq("canonicalMessageId",turn.userMessageId)).unique();
      if (inbox?.bindingId) {
        const binding=await ctx.db.get(inbox.bindingId);const identity=binding?await ctx.db.get(binding.identityId):null;
        if (!binding?.active || !identity?.active || binding.revision!==inbox.bindingRevision) {
          await ctx.db.patch(turn._id,{status:"cancelled"});
          for (const job of jobs) if (job) {
            await cancelExecutionForGenerationJob(ctx,{jobId:job._id,requestedBy:turn.userId,now:Date.now()});
            await ctx.db.patch(job._id,{status:"cancelled",completedAt:Date.now()});
            await ctx.db.patch(job.messageId,{status:"cancelled"});
          }
          await wakeChannelTurns(ctx,turn.chatId);return {done:true};
        }
      }
      await resolvePreparedMediaParents(ctx,turn);
      await ctx.db.patch(turn._id,{status:"running"});
      await ctx.scheduler.runAfter(0,internal.chat.actions_runtime.runGeneration,turn.generationArgs);
    }
    return {done:false,eventId};
  },
});
