import { appChatUrl } from "./telegram/payload";
import { v } from "convex/values";
import { mutation,query } from "../_generated/server";
import { requireAuth } from "../lib/auth";
import { sha256Hex } from "../runtime_host/security";
import { bindConversation,channelError,requireChannelIdentity,revokeIdentity } from "./linking_helpers";

export const begin = mutation({
  args:{}, handler:async(ctx) => {
    const {userId}=await requireAuth(ctx);
    const botId=process.env.TELEGRAM_BOT_ID; const username=process.env.TELEGRAM_BOT_USERNAME;
    if (!botId || !username) channelError("Telegram is not configured on this deployment.");
    const token=Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,"0")).join("");
    const expiresAt=Date.now()+10*60*1000;
    const grantId=await ctx.db.insert("channelLinkGrants",{userId,tokenHash:await sha256Hex(token),botId,expiresAt,status:"pending",createdAt:Date.now()});
    return {grantId,expiresAt,url:`https://t.me/${username}?start=${token}`};
  },
});
export const confirm = mutation({
  args:{grantId:v.id("channelLinkGrants")},handler:async(ctx,args) => {
    const {userId}=await requireAuth(ctx); const grant=await ctx.db.get(args.grantId);
    if (!grant || grant.userId!==userId || grant.expiresAt<=Date.now() || !grant.externalUserId || !grant.externalChatId || !["claimed","confirmed"].includes(grant.status)) channelError("This Telegram link is expired or has not been claimed.");
    const existing=await ctx.db.query("channelIdentities").withIndex("by_external",q=>q.eq("botId",grant.botId).eq("externalUserId",grant.externalUserId!)).unique();
    if (existing && existing.userId!==userId) channelError("This Telegram account is already linked to another NanthAI account.");
    if (grant.status==="confirmed" && existing?.active) return existing._id;
    const identityId=existing?._id ?? await ctx.db.insert("channelIdentities",{userId,botId:grant.botId,externalUserId:grant.externalUserId,externalChatId:grant.externalChatId,revision:1,active:true,createdAt:Date.now()});
    if (existing) await ctx.db.patch(existing._id,{active:true,revision:existing.revision+1,externalChatId:grant.externalChatId});
    await ctx.db.patch(grant._id,{status:"confirmed"}); return identityId;
  },
});
export const selectConversation = mutation({
  args:{identityId:v.id("channelIdentities"),personaId:v.optional(v.id("personas")),chatId:v.optional(v.id("chats")),deliverFutureReplies:v.boolean()},
  handler:async(ctx,args) => {
    const {userId}=await requireAuth(ctx);
    if (!args.deliverFutureReplies) channelError("Confirm delivery of future replies into Telegram for this conversation.");
    return await bindConversation(ctx,await requireChannelIdentity(ctx,userId,args.identityId),args.personaId,args.chatId);
  },
});
export const disconnect = mutation({
  args:{identityId:v.id("channelIdentities")},handler:async(ctx,args) => {
    const {userId}=await requireAuth(ctx); await revokeIdentity(ctx,await requireChannelIdentity(ctx,userId,args.identityId)); return null;
  },
});
export const status = query({
  args:{},handler:async(ctx) => {
    const {userId}=await requireAuth(ctx);
    const identities=await ctx.db.query("channelIdentities").withIndex("by_user",q=>q.eq("userId",userId)).collect();
    const grants=await ctx.db.query("channelLinkGrants").withIndex("by_user",q=>q.eq("userId",userId)).order("desc").take(5);
    const bindings=await ctx.db.query("channelBindings").withIndex("by_user",q=>q.eq("userId",userId)).collect();
    const inbox=await ctx.db.query("channelInbox").withIndex("by_user",q=>q.eq("userId",userId)).order("desc").take(10);
    const deliveries=await ctx.db.query("channelDeliveries").withIndex("by_user",q=>q.eq("userId",userId)).order("desc").take(20);
    const botId = process.env.TELEGRAM_BOT_ID;
    const activeIdentities = identities.filter(row => row.active && row.botId === botId);
    const identityIds = new Set(activeIdentities.map(row => String(row._id)));
    const activeBindings = bindings.filter(row => row.active && identityIds.has(String(row.identityId)));
    const pendingGrants = grants.filter(row => row.botId === botId && row.status === "claimed" && row.expiresAt > Date.now());
    const active = activeBindings[0];
    const persona = active?.personaId ? await ctx.db.get(active.personaId) : null;
    const chat = active ? await ctx.db.get(active.chatId) : null;
    const roster = active ? await ctx.db.query("chatParticipants").withIndex("by_chat", q => q.eq("chatId", active.chatId)).collect() : [];
    roster.sort((a,b)=>a.sortOrder-b.sortOrder);
    const connectedParticipants = await Promise.all(roster.map(async participant => {
      const person = participant.personaId ? await ctx.db.get(participant.personaId) : null;
      const model = await ctx.db.query("cachedModels").withIndex("by_modelId", q => q.eq("modelId", participant.modelId)).first();
      return {id: participant._id, name: person?.userId === userId ? person.displayName : participant.personaName ?? model?.name ?? participant.modelId};
    }));
    const connectionState = !botId ? "unconfigured" : active ? "connected" : activeIdentities.length ? "choose_conversation" : pendingGrants.length ? "awaiting_confirmation" : "disconnected";
    const retainedInputs = await Promise.all(inbox.map(async item => {
      const originalChat = item.chatId ? await ctx.db.get(item.chatId) : null;
      return {id:item._id,status:item.status,error:item.error,chatId:item.chatId,
        chatTitle:originalChat?.userId === userId ? originalChat.title : undefined,
        fileNames:item.files?.map(file=>file.name)};
    }));
    return {setupUrl:appChatUrl(),configured:Boolean(botId),connectionState,botUsername:process.env.TELEGRAM_BOT_USERNAME,
      connectedParticipants,
      connectedPersonaName:persona?.userId === userId ? persona.displayName : undefined,
      connectedChatTitle:chat?.userId === userId ? chat.title : undefined,identities:activeIdentities,
      grants:pendingGrants.map(x=>({id:x._id,claimantName:x.claimantName,expiresAt:x.expiresAt})),
      bindings:activeBindings,inbox:retainedInputs,
      deliveries:deliveries.map(x=>({id:x._id,status:x.status,error:x.error,chatId:x.chatId,part:x.part}))};
  },
});
