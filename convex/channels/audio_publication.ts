import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { queueTelegramReply } from "./delivery_queue";

export async function publishChannelAudio(ctx: MutationCtx, messageId: Id<"messages">) {
  const message=await ctx.db.get(messageId);
  if(!message?.audioStorageId || message.role!=="assistant" || message.status!=="completed" || (await ctx.db.get(message.chatId))?.channelConversation!==true)return;
  const bindings=await ctx.db.query("channelBindings").withIndex("by_chat",q=>q.eq("chatId",message.chatId)).collect();
  const roster=await ctx.db.query("chatParticipants").withIndex("by_chat",q=>q.eq("chatId",message.chatId)).collect();
  const participant=message.chatParticipantId ? await ctx.db.get(message.chatParticipantId) : null;
  if(!participant || participant.userId!==message.userId || participant.chatId!==message.chatId)return;
  const persona=participant.personaId ? await ctx.db.get(participant.personaId) : null;
  const model=await ctx.db.query("cachedModels").withIndex("by_modelId",q=>q.eq("modelId",message.modelId ?? participant.modelId)).first();
  const speaker=persona?.userId===message.userId ? persona.displayName : participant.personaName ?? model?.name ?? participant.modelId;
  const mimeType=message.audioMimeType ?? "audio/mpeg";
  const voice=["audio/mpeg","audio/mp3","audio/mp4","audio/ogg"].includes(mimeType);
  for(const binding of bindings){
    const identity=await ctx.db.get(binding.identityId);
    if(!binding.active || !identity?.active || identity.userId!==message.userId || message.createdAt<=binding.deliverAfter)continue;
    await queueTelegramReply(ctx,{userId:message.userId,identityId:identity._id,bindingId:binding._id,bindingRevision:binding.revision,
      chatId:message.chatId,sourceMessageId:message._id,botId:identity.botId,externalChatId:identity.externalChatId,
      dedupKey:`audio:${String(binding._id)}:${binding.revision}:${String(message._id)}:${String(message.audioStorageId)}`,
      text:roster.length>1?speaker:"",storageId:message.audioStorageId,mimeType,kind:voice?"voice":"audio_file"});
  }
}
