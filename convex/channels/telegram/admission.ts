import { wakeChannelTurns } from "../turn_queue";
import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { sendMessageForActor,cancelActiveGenerationForActor } from "../../chat/mutations_public_handlers";
import { bindConversation,revokeIdentity } from "../linking_helpers";
import { queueTelegramReply } from "../delivery_queue";
import { telegramAppAction } from "./payload";
import { assertUserDataWritable } from "../../lib/write_fence";

const HELP="In NanthAI Settings → AI connections → Telegram, connect this bot and confirm your Telegram account. Then choose a conversation or start a new one using your NanthAI defaults. Each user has a separate account and history. /persona lists your Personas; /persona N selects one; /new starts a fresh conversation; /status shows the current conversation; /stop cancels its work; /disconnect revokes your link. Approvals and retries stay in NanthAI.";
export const admit=internalMutation({
  args:{inboxId:v.id("channelInbox"),claimantName:v.string()},handler:async(ctx,args)=>{
    const item=await ctx.db.get(args.inboxId);if (!item || item.status!=="received") return null;
    const reply=async(text:string)=>await queueTelegramReply(ctx,{botId:item.botId,externalChatId:item.externalChatId,dedupKey:`inbox:${String(item._id)}`,text,userId:item.userId});
    const command=item.text.trim().split(/\s+/,1)[0].toLowerCase().replace(/@[^ ]+$/,"");
    if (command==="/start" && /^\/start [a-f0-9]{64}$/.test(item.text)) {
      const tokenHash=item.text.split(" ")[1];
      const grant=await ctx.db.query("channelLinkGrants").withIndex("by_token",q=>q.eq("tokenHash",tokenHash)).unique();
      if (!grant || grant.botId!==item.botId || grant.expiresAt<=Date.now() || !["pending","claimed"].includes(grant.status)
        || (grant.externalUserId&&grant.externalUserId!==item.externalUserId)) await reply("This link is expired or already used. Create another in NanthAI.");
      else {
        await assertUserDataWritable(ctx,grant.userId);
        await ctx.db.patch(grant._id,{status:"claimed",externalUserId:item.externalUserId,externalChatId:item.externalChatId,claimantName:args.claimantName});
        await ctx.db.patch(item._id,{userId:grant.userId});
        await reply(telegramAppAction("Return to NanthAI Settings → Telegram to confirm this Telegram account, then choose a conversation"));
      }
      await ctx.db.patch(item._id,{status:"control"});return null;
    }
    const identity=item.identityId?await ctx.db.get(item.identityId):null;
    if (!identity?.active || identity.externalUserId!==item.externalUserId || identity.externalChatId!==item.externalChatId) {
      await reply(`${HELP}\n\n${telegramAppAction("Open Telegram settings in NanthAI")}`);await ctx.db.patch(item._id,{status:"unlinked"});return null;
    }
    await assertUserDataWritable(ctx,identity.userId);
    const bindings=await ctx.db.query("channelBindings").withIndex("by_identity",q=>q.eq("identityId",identity._id)).collect();
    const current=bindings.find(row=>row.active);
    const personas=await ctx.db.query("personas").withIndex("by_user",q=>q.eq("userId",identity.userId)).collect();
    personas.sort((a,b)=>a.displayName.localeCompare(b.displayName)||String(a._id).localeCompare(String(b._id)));
    let response:string|undefined;
    if (item.kind==="edit") response="Send a correction as a new message so the canonical conversation retains the instruction history.";
    else if (item.kind==="media" && !item.files?.length) response="This message type cannot be imported. Send a photo, document, video, audio file or voice message, or open NanthAI.";
    else if (command==="/help"||command==="/start") response=HELP;
    else if (command==="/disconnect") {await revokeIdentity(ctx,identity);response="Telegram disconnected. Your canonical chats remain in NanthAI.";}
    else if (command==="/persona") {
      const index=Number(item.text.trim().split(/\s+/)[1]);
      if (Number.isInteger(index)&&index>0&&index<=personas.length) {
        const selected=personas[index-1];await bindConversation(ctx,identity,selected._id);
        response=`Selected ${selected.displayName}. Future replies in its new conversation will be copied into Telegram. No older history is exported.`;
      } else response=personas.map((persona,i)=>`${i+1}. ${persona.displayName}`).join("\n")+"\nUse /persona N to select a Persona and enable future replies for a new conversation.";
    } else if (command==="/new") {
      if (current) {await bindConversation(ctx,identity,undefined);response="Started a new conversation using your NanthAI defaults.";} else response="Choose a conversation in NanthAI first.";
    } else if (!current) response=telegramAppAction("Your account is connected. Choose a conversation in NanthAI Settings → Telegram to start chatting");
    else if (command==="/status") {
      const chat=await ctx.db.get(current.chatId); const persona=current.personaId ? await ctx.db.get(current.personaId) : null;
      const jobs=await ctx.db.query("generationJobs").withIndex("by_chat_status",q=>q.eq("chatId",current.chatId)).order("desc").take(1);
      const requests=await ctx.db.query("runtimePermissionRequests").withIndex("by_user_chat_status",q=>q.eq("userId",identity.userId).eq("chatId",current.chatId).eq("status","pending")).take(1);
      response=`${chat?.title ?? "Conversation"}${persona ? ` · ${persona.displayName}` : ""}\n${requests.length?"Waiting for your input or permission":jobs[0]?.status ?? "Ready"}\n${telegramAppAction("Open conversation in NanthAI",current.chatId)}`;
    } else if (command==="/stop") {
      const stopped=await cancelActiveGenerationForActor(ctx,{chatId:current.chatId},identity.userId);response=`Cancelled ${stopped.cancelledCount} active/queued turn(s).`;
    } else if (command.startsWith("/")) response=HELP;
    if (response!==undefined) {await reply(response);await ctx.db.patch(item._id,{status:"control"});return null;}
    if (!current || current._id!==item.bindingId || current.revision!==item.bindingRevision) throw new Error("The selected conversation changed before admission. Send this input again under the current selection.");
    if (item.replyToId!==undefined) {
      const delivered=await ctx.db.query("channelDeliveries").withIndex("by_external_message",q=>q.eq("botId",item.botId).eq("externalChatId",item.externalChatId).eq("externalMessageId",item.replyToId)).unique();
      if (delivered?.bindingId && delivered.bindingId!==current._id) throw new Error("This reply belongs to an older conversation. Select that conversation in NanthAI before continuing it.");
    }
    const participants=await ctx.db.query("chatParticipants").withIndex("by_chat",q=>q.eq("chatId",current.chatId)).collect();
    if (participants.length===0) throw new Error("Add a participant to this conversation in NanthAI before continuing.");
    participants.sort((a,b)=>a.sortOrder-b.sortOrder);
    const voiceUpload = item.transcript ? item.uploads?.find(file=>file.type === "audio") : undefined;
    if (voiceUpload) {
      const session=await ctx.db.get(voiceUpload.uploadSessionId);
      if(!session || session.userId!==identity.userId || session.storageId!==voiceUpload.storageId || session.status!=="pending")throw new Error("Voice upload is no longer available. Retry the retained input in NanthAI.");
      await ctx.db.patch(session._id,{status:"consumed",consumedAt:Date.now()});
    }
    const accepted=await sendMessageForActor(ctx,{chatId:current.chatId,text:[item.text,item.transcript].filter(Boolean).join("\n\n") || "Please inspect the attached file.",
      attachments:item.uploads?.filter(file=>file!==voiceUpload).map(({storageId,uploadSessionId,type,name,mimeType,sizeBytes})=>({storageId,uploadSessionId,type,name,mimeType,sizeBytes})),
      recordedAudio:voiceUpload ? {storageId:voiceUpload.storageId,transcript:item.transcript ?? "",mimeType:voiceUpload.mimeType,durationMs:voiceUpload.durationMs} : undefined,
      participants:participants.map(participant=>({participantKey:participant._id,modelId:participant.modelId,personaId:participant.personaId,personaName:participant.personaName})),
      expandMultiModelGroups:true},identity.userId,item.files?.length && item.canonicalMessageId ? {preacceptedMessageId:item.canonicalMessageId} : undefined);
    await ctx.db.patch(item._id,{status:"accepted",canonicalMessageId:accepted.userMessageId});
    await wakeChannelTurns(ctx,current.chatId);
    if (item.late) await reply("This late Telegram update was accepted after the newer messages already received, in arrival order.");
    return null;
  },
});
export const fail=internalMutation({
  args:{inboxId:v.id("channelInbox"),error:v.string()},handler:async(ctx,args)=>{
    const item=await ctx.db.get(args.inboxId);if (!item || item.status!=="received") return null;
    await ctx.db.patch(item._id,{status:"failed",error:args.error});
    if(item.files?.length && item.canonicalMessageId) await ctx.db.patch(item.canonicalMessageId,{status:"failed",inputProcessingNotice:args.error.includes("OpenRouter") ? "openrouter_required" : "input_preparation_failed"});
    if(item.chatId)await wakeChannelTurns(ctx,item.chatId);
    await queueTelegramReply(ctx,{botId:item.botId,externalChatId:item.externalChatId,dedupKey:`failure:${String(item._id)}`,text:`${args.error}\n${telegramAppAction("Retry the retained input in NanthAI Settings → Telegram",item.chatId)}`,userId:item.userId});return null;
  },
});
