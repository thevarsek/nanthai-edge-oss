import { cancelExecutionForGenerationJob } from "../execution/cancellation";
import { patchStreamingMessageStatus } from "../chat/streaming_state";
import { wakeChannelTurns } from "./turn_queue";
import { cancelPreparingTelegramInputs } from "./telegram/media_cancellation";
import { MODEL_IDS } from "../lib/model_constants";
import { ConvexError } from "convex/values";
import type { Doc,Id } from "../_generated/dataModel";
import type { MutationCtx,QueryCtx } from "../_generated/server";
import { createChatForActor } from "../chat/mutations_public_handlers";
import { assertUserDataWritable } from "../lib/write_fence";

export function channelError(message:string):never {throw new ConvexError({code:"VALIDATION",message});}
export async function requireChannelIdentity(ctx:QueryCtx|MutationCtx,userId:string,id:Id<"channelIdentities">) {
  const identity=await ctx.db.get(id);
  if (!identity || identity.userId!==userId || !identity.active) channelError("Telegram connection is unavailable.");
  return identity;
}
export async function bindConversation(ctx:MutationCtx,identity:Doc<"channelIdentities">,personaId:Id<"personas"> | undefined,chatId?:Id<"chats">) {
  await assertUserDataWritable(ctx,identity.userId);
  const starterPersonaId = chatId ? undefined : personaId;
  const persona=starterPersonaId ? await ctx.db.get(starterPersonaId) : null;
  if (starterPersonaId && (!persona || persona.userId!==identity.userId)) channelError("Choose an owned Persona.");
  let selectedChatId=chatId;
  if (selectedChatId) {
    const chat=await ctx.db.get(selectedChatId);
    if (!chat || chat.userId!==identity.userId || chat.isDeleting) channelError("Choose an owned conversation with participants.");
  } else {
    const preferences = await ctx.db.query("userPreferences").withIndex("by_user", q => q.eq("userId", identity.userId)).first();
    const defaultPersona = preferences?.defaultPersonaId ? await ctx.db.get(preferences.defaultPersonaId) : null;
    const starter = persona ?? (defaultPersona?.userId === identity.userId ? defaultPersona : null);
    selectedChatId = await createChatForActor(ctx, {mode: "chat", title: starter ? `${starter.displayName} · Telegram` : "Telegram",
      participants: [{modelId: starter?.modelId ?? preferences?.defaultModelId ?? MODEL_IDS.appDefault,
        personaId: starter?._id, personaName: starter?.displayName}]}, identity.userId);
  }
  await ctx.db.patch(selectedChatId, {channelConversation: true});
  const previous=await ctx.db.query("channelBindings").withIndex("by_identity",q=>q.eq("identityId",identity._id)).collect();
  for (const binding of previous) if (binding.active) await ctx.db.patch(binding._id,{active:false,revision:binding.revision+1});
  return await ctx.db.insert("channelBindings",{userId:identity.userId,identityId:identity._id,chatId:selectedChatId,personaId:starterPersonaId,
    revision:Math.max(0,...previous.map(row=>row.revision))+1,active:true,deliverAfter:Date.now(),createdAt:Date.now()});
}
export async function revokeIdentity(ctx:MutationCtx,identity:Doc<"channelIdentities">) {
  await ctx.db.patch(identity._id,{active:false,revision:identity.revision+1});
  const bindings=await ctx.db.query("channelBindings").withIndex("by_identity",q=>q.eq("identityId",identity._id)).collect();
  for (const binding of bindings) await ctx.db.patch(binding._id,{active:false,revision:binding.revision+1});
  for (const binding of bindings) {
    await cancelPreparingTelegramInputs(ctx, {chatId: binding.chatId, userId: identity.userId, identityId: identity._id});
    const turns=await ctx.db.query("channelTurns").withIndex("by_chat",q=>q.eq("chatId",binding.chatId)).collect();
    for (const turn of turns) {
      if (!["queued","running"].includes(turn.status)) continue;
      const inbox=await ctx.db.query("channelInbox").withIndex("by_message",q=>q.eq("canonicalMessageId",turn.userMessageId)).unique();
      if (inbox?.identityId!==identity._id) continue;
      for (const id of turn.generationArgs.generationJobIds) {
        const job=await ctx.db.get(id);if (!job || ["completed","failed","cancelled","timedOut"].includes(job.status)) continue;
        await cancelExecutionForGenerationJob(ctx,{jobId:job._id,requestedBy:identity.userId,now:Date.now()});
        await ctx.db.patch(job._id,{status:"cancelled",completedAt:Date.now()});
        await ctx.db.patch(job.messageId,{status:"cancelled"});
        await patchStreamingMessageStatus(ctx,job.messageId,"cancelled");
      }
      await ctx.db.patch(turn._id,{status:"cancelled"});
    }
    await wakeChannelTurns(ctx,binding.chatId);
  }
  // Admission and outbound effects also recheck the immutable identity and revision.
}
