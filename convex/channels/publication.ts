import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { queueTelegramReply } from "./delivery_queue";
import { telegramAppAction,telegramPublishedText } from "./telegram/payload";
import { wakeChannelTurns } from "./turn_queue";

export async function publishChannelMessage(ctx:MutationCtx,messageId:Id<"messages">) {
  const message=await ctx.db.get(messageId);if (!message) return;
  if ((await ctx.db.get(message.chatId))?.channelConversation !== true) return;
  await wakeChannelTurns(ctx,message.chatId);
  if (message.role!=="assistant"||!["completed","failed","cancelled"].includes(message.status)) return;
  const bindings=await ctx.db.query("channelBindings").withIndex("by_chat",q=>q.eq("chatId",message.chatId)).collect();
  for (const binding of bindings) {
    if (!binding.active || message.createdAt<=binding.deliverAfter) continue;
    const identity=await ctx.db.get(binding.identityId);if (!identity?.active || identity.userId!==message.userId) continue;
    const participant=message.chatParticipantId ? await ctx.db.get(message.chatParticipantId) : null;
    if (!participant || participant.userId !== identity.userId || participant.chatId !== message.chatId) continue;
    const roster = await ctx.db.query("chatParticipants").withIndex("by_chat", q => q.eq("chatId", message.chatId)).collect();
    const persona = participant.personaId ? await ctx.db.get(participant.personaId) : null;
    const model = await ctx.db.query("cachedModels").withIndex("by_modelId", q => q.eq("modelId", message.modelId ?? participant.modelId)).first();
    const speaker = persona?.userId === identity.userId ? persona.displayName : participant.personaName ?? model?.name ?? message.participantName ?? participant.modelId;
    const text=message.status==="completed"?telegramPublishedText(message.content):`Turn ${message.status}. ${message.content?telegramPublishedText(message.content):"Open NanthAI for the retained result."}`;
    await queueTelegramReply(ctx,{userId:message.userId,identityId:identity._id,bindingId:binding._id,bindingRevision:binding.revision,
      chatId:message.chatId,sourceMessageId:message._id,botId:identity.botId,externalChatId:identity.externalChatId,
      dedupKey:`reply:${String(binding._id)}:${binding.revision}:${String(message._id)}:${message.status}`,text:message.status === "completed" ? `${roster.length > 1 ? `${speaker}\n` : ""}${text}` : `${text}\n\n${telegramAppAction("Open this conversation in NanthAI", message.chatId)}`});
  }
}
export async function notifyChannelInput(ctx:MutationCtx,chatId:Id<"chats">,requestId:string) {
  if ((await ctx.db.get(chatId))?.channelConversation !== true) return;
  const bindings=await ctx.db.query("channelBindings").withIndex("by_chat",q=>q.eq("chatId",chatId)).collect();
  for (const binding of bindings) if (binding.active) {
    const identity=await ctx.db.get(binding.identityId);if (!identity?.active) continue;
    await queueTelegramReply(ctx,{userId:identity.userId,identityId:identity._id,bindingId:binding._id,bindingRevision:binding.revision,
      chatId,botId:identity.botId,externalChatId:identity.externalChatId,dedupKey:`input:${requestId}:${String(binding._id)}`,
      text:`Your Persona is waiting for input or permission. ${telegramAppAction("Respond in signed-in NanthAI", chatId)}`});
  }
}
