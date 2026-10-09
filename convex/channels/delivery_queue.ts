import { scheduleWorkpoolCompletionWatchdog } from "../execution/workpool_watchdog_schedule";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation,type MutationCtx } from "../_generated/server";
import type { Doc,Id } from "../_generated/dataModel";
import { backgroundWorkpool } from "../execution/components";
import { createExecutionRun } from "../execution/runs";
import { linkExecutionComponent } from "../execution/component_refs";
import { telegramParts } from "./telegram/payload";

export async function queueTelegramReply(ctx:MutationCtx,input:{botId:string;externalChatId:string;dedupKey:string;text:string;storageId?:Id<"_storage">;mimeType?:string;kind?:"voice"|"audio_file";
  userId?:string;identityId?:Id<"channelIdentities">;bindingId?:Id<"channelBindings">;bindingRevision?:number;chatId?:Id<"chats">;sourceMessageId?:Id<"messages">}) {
  const parts=input.storageId ? [input.text] : telegramParts(input.text);
  for (let part=0;part<parts.length;part++) {
    const key=`${input.dedupKey}:${part}`;
    const existing=await ctx.db.query("channelDeliveries").withIndex("by_key",q=>q.eq("dedupKey",key)).unique();
    if (!existing) await ctx.db.insert("channelDeliveries",{...input,dedupKey:key,text:parts[part],part,status:"pending",attempt:0,createdAt:Date.now()+part,updatedAt:Date.now()});
  }
  await dispatchNextDelivery(ctx,input.botId,input.externalChatId);
}
export async function dispatchNextDelivery(ctx:MutationCtx,botId:string,externalChatId:string) {
  if (process.env.TELEGRAM_DELIVERY_PAUSED==="true") return;
  const first = async (status: string) => await ctx.db.query("channelDeliveries").withIndex("by_external_status", q => q.eq("botId", botId).eq("externalChatId", externalChatId).eq("status", status)).order("asc").first();
  if (await first("sending") || await first("scheduled")) return;
  const pending = await first("pending"); const retry = await first("retry");
  const item = !pending ? retry : !retry ? pending : pending.createdAt <= retry.createdAt ? pending : retry;
  if (!item || (item.retryAfter && item.retryAfter > Date.now())) return;
  if (!await deliveryAuthority(ctx, item)) {
    await ctx.db.patch(item._id, {status: "cancelled", updatedAt: Date.now()});
    // One-shot transport cleanup; the Workpool remains the delivery engine.
    await ctx.scheduler.runAfter(0, internal.channels.delivery_queue.dispatch, {botId, externalChatId});
    return;
  }
  const execution=await createExecutionRun(ctx,{userId:item.userId ?? `channel-transport:${botId}`,kind:"maintenance",requestedPlacement:"cloud",
    runKey:`telegram-delivery:${String(item._id)}:${item.attempt+1}`,chatId:item.chatId,domainType:"channel_delivery",domainId:String(item._id),
    initialAttempt:{executorKind:"convex_action",placement:"cloud",adapterId:"background-workpool",orchestrationEngine:"convex_workpool"}});
  await ctx.db.patch(item._id,{runId:execution.runId,attemptId:execution.attemptId,fence:execution.fence,status:"scheduled",attempt:item.attempt+1,updatedAt:Date.now()});
  const workId=await backgroundWorkpool.enqueueAction(ctx,internal.channels.telegram.delivery.send,{deliveryId:item._id},{retry:false,name:"telegram-delivery",onComplete:internal.channels.delivery_callbacks.complete,context:{deliveryId:item._id,runId:execution.runId}});
  await linkExecutionComponent(ctx,{...execution,adapterId:"background-workpool",operationId:String(workId),role:"telegram-delivery"});
  await scheduleWorkpoolCompletionWatchdog(ctx, {kind: "background_work", operationId: String(workId), runId: execution.runId, deliveryId: item._id});
}
export async function deliveryAuthority(ctx:MutationCtx,item:Doc<"channelDeliveries">) {
  if (process.env.TELEGRAM_DELIVERY_PAUSED==="true") return false;
  if (!item.bindingId) return true;
  const binding=await ctx.db.get(item.bindingId); const identity=binding?await ctx.db.get(binding.identityId):null;
  const chat=binding?await ctx.db.get(binding.chatId):null;
  if (item.sourceMessageId) { const source = await ctx.db.get(item.sourceMessageId); if (!source || source.userId !== item.userId || source.chatId !== item.chatId || (item.storageId && source.audioStorageId !== item.storageId)) return false; }
  const userId=item.userId;
  const deleted=userId?await ctx.db.query("accountDeletionTombstones").withIndex("by_user",q=>q.eq("userId",userId)).unique():null;
  return Boolean(!deleted&&binding?.active&&identity?.active&&binding.revision===item.bindingRevision&&chat&&!chat.isDeleting&&chat.userId===item.userId);
}
export const dispatch=internalMutation({args:{botId:v.string(),externalChatId:v.string()},handler:async(ctx,args)=>{await dispatchNextDelivery(ctx,args.botId,args.externalChatId);return null;}});
