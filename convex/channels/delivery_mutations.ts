import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation,mutation } from "../_generated/server";
import { assertCurrentExecution } from "../execution/attempts";
import { requireAuth } from "../lib/auth";
import { deliveryAuthority,dispatchNextDelivery } from "./delivery_queue";
import { channelError } from "./linking_helpers";

export const claim=internalMutation({
  args:{deliveryId:v.id("channelDeliveries")},handler:async(ctx,args)=>{
    const item=await ctx.db.get(args.deliveryId);
    if (!item?.attemptId||item.fence===undefined||item.status!=="scheduled") return null;
    await assertCurrentExecution(ctx,{attemptId:item.attemptId,fence:item.fence});
    if (!await deliveryAuthority(ctx,item)) {await ctx.db.patch(item._id,{status:"cancelled",updatedAt:Date.now()});return null;}
    await ctx.db.patch(item._id,{status:"sending",updatedAt:Date.now()}); return item;
  },
});
export const settle=internalMutation({
  args:{deliveryId:v.id("channelDeliveries"),attemptId:v.id("executionAttempts"),fence:v.number(),status:v.string(),externalMessageId:v.optional(v.number()),error:v.optional(v.string()),retrySeconds:v.optional(v.number())},
  handler:async(ctx,args)=>{
    const item=await ctx.db.get(args.deliveryId);if (!item||item.attemptId!==args.attemptId) throw new Error("STALE_DELIVERY");
    await assertCurrentExecution(ctx,{attemptId:args.attemptId,fence:args.fence});
    const retry=args.status==="retry"&&item.attempt<3;
    const retryAfter=retry?Date.now()+Math.min(60*60,Math.max(1,args.retrySeconds ?? 1))*1000:undefined;
    await ctx.db.patch(item._id,{status:retry?"retry":args.status==="retry"?"failed":args.status,externalMessageId:args.externalMessageId,error:args.error,retryAfter,updatedAt:Date.now()});
    if (retryAfter) await ctx.scheduler.runAt(retryAfter,internal.channels.delivery_queue.dispatch,{botId:item.botId,externalChatId:item.externalChatId});
    return null;
  },
});
export const resend=mutation({
  args:{deliveryId:v.id("channelDeliveries"),acknowledgeDuplicateRisk:v.boolean()},handler:async(ctx,args)=>{
    const {userId}=await requireAuth(ctx); const item=await ctx.db.get(args.deliveryId);
    if (!item||item.userId!==userId||!["failed","unknown"].includes(item.status)) channelError("This delivery cannot be retried.");
    if (item.status==="unknown"&&!args.acknowledgeDuplicateRisk) channelError("Telegram may already have received this message. Confirm the duplicate risk to resend.");
    if (!await deliveryAuthority(ctx,item)) channelError("The selected Telegram conversation changed or disconnected.");
    await ctx.db.patch(item._id,{status:"pending",retryAfter:undefined,error:undefined,updatedAt:Date.now()});
    await dispatchNextDelivery(ctx,item.botId,item.externalChatId);return null;
  },
});
