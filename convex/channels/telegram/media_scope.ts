import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import { internalMutation, type MutationCtx } from "../../_generated/server";
import { assertCurrentExecution } from "../../execution/attempts";
import { assertUserDataWritable } from "../../lib/write_fence";
import { createChatUploadUrlForActor, bindChatUploadSessionForActor } from "../../chat/upload_handlers";
import { telegramFile, telegramUploadedFile } from "./media_types";
import { storeAncillaryCostHandler } from "../../chat/mutations_internal_handlers";

export async function requireMediaInbox(ctx: MutationCtx, inboxId: Id<"channelInbox">) {
  const item = await ctx.db.get(inboxId);
  if (!item || item.status !== "received" || !item.userId || !item.bindingId || !item.identityId || !item.admissionRunId) throw new Error("This retained Telegram input is no longer active.");
  const [binding, identity, run] = await Promise.all([ctx.db.get(item.bindingId),ctx.db.get(item.identityId),ctx.db.get(item.admissionRunId)]);
  const chat = binding ? await ctx.db.get(binding.chatId) : null;
  if (!binding?.active || !identity?.active || binding.revision !== item.bindingRevision || identity.userId !== item.userId || identity.externalUserId !== item.externalUserId
    || !chat || chat.userId !== item.userId || chat.isDeleting || !run?.activeAttemptId || run.userId !== item.userId) throw new Error("The Telegram connection changed. Retry under the current connection in NanthAI.");
  const attempt = await ctx.db.get(run.activeAttemptId);
  if (!attempt) throw new Error("Telegram admission attempt is unavailable.");
  await assertCurrentExecution(ctx,{attemptId:attempt._id,fence:attempt.fence});
  return {item, userId:item.userId, runId:run._id, attemptId:attempt._id, fence:attempt.fence};
}

export const get = internalMutation({
  args:{inboxId:v.id("channelInbox")},returns:v.union(v.null(),v.object({userId:v.string(),runId:v.id("executionRuns"),attemptId:v.id("executionAttempts"),fence:v.number(),files:v.array(telegramFile),uploads:v.array(telegramUploadedFile),transcript:v.optional(v.string())})),handler:async(ctx,{inboxId}):Promise<ReturnType<typeof scopeProjection>|null>=>{
    const item = await ctx.db.get(inboxId);
    if (!item?.files?.length || item.kind === "edit" || item.text.trim().startsWith("/") || !item.identityId || !item.bindingId) return null;
    const scope = await requireMediaInbox(ctx,inboxId);
    const uploads = [];
    for (const upload of scope.item.uploads ?? []) {
      const session = await ctx.db.get(upload.uploadSessionId);
      if (session?.userId === scope.userId && session.status === "pending" && session.storageId === upload.storageId && await ctx.storage.getMetadata(upload.storageId)) uploads.push(upload);
    }
    return {...scopeProjection(scope),uploads};
  },
});
function scopeProjection(scope: {item:Doc<"channelInbox">;userId:string;runId:Id<"executionRuns">;attemptId:Id<"executionAttempts">;fence:number}) {
  return {userId:scope.userId,runId:scope.runId,attemptId:scope.attemptId,fence:scope.fence,files:scope.item.files ?? [],uploads:scope.item.uploads ?? [],transcript:scope.item.transcript};
}
export const prepareUpload = internalMutation({
  args:{inboxId:v.id("channelInbox"),fileId:v.string()},returns:v.object({uploadUrl:v.string(),uploadSessionId:v.id("chatUploadSessions")}),handler:async(ctx,args)=>{
    const scope = await requireMediaInbox(ctx,args.inboxId); await assertUserDataWritable(ctx,scope.userId);
    if (!scope.item.files?.some(file=>file.fileId===args.fileId)) throw new Error("Telegram file is not owned by this input.");
    return await createChatUploadUrlForActor(ctx,scope.userId);
  },
});
export const commitUpload = internalMutation({
  args:{inboxId:v.id("channelInbox"),attemptId:v.id("executionAttempts"),fence:v.number(),upload:telegramUploadedFile},returns:v.null(),handler:async(ctx,args)=>{
    const scope = await requireMediaInbox(ctx,args.inboxId);
    if(scope.attemptId!==args.attemptId||scope.fence!==args.fence)throw new Error("STALE_TELEGRAM_MEDIA");
    await bindChatUploadSessionForActor(ctx,args.upload,scope.userId);
    await ctx.db.patch(scope.item._id,{uploads:[...(scope.item.uploads ?? []).filter(file=>file.fileId!==args.upload.fileId),args.upload]});return null;
  },
});
export const commitTranscript = internalMutation({
  args:{inboxId:v.id("channelInbox"),attemptId:v.id("executionAttempts"),fence:v.number(),text:v.string(),modelId:v.string(),cost:v.number(),promptTokens:v.number(),completionTokens:v.number(),totalTokens:v.number(),generationId:v.optional(v.string())},returns:v.null(),handler:async(ctx,args)=>{
    const scope=await requireMediaInbox(ctx,args.inboxId);
    if(scope.attemptId!==args.attemptId||scope.fence!==args.fence)throw new Error("STALE_TELEGRAM_MEDIA");
    if(!args.text.trim())throw new Error("No speech was recognized. The audio is retained; retry it in NanthAI.");
    const {inboxId:_inboxId,attemptId:_attemptId,fence:_fence,text,...cost}=args;
    await ctx.db.patch(scope.item._id,{transcript:text,transcriptionCost:cost});
    if (scope.item.canonicalMessageId && scope.item.chatId) await storeAncillaryCostHandler(ctx, {
      ...cost, messageId: scope.item.canonicalMessageId, chatId: scope.item.chatId, userId: scope.userId,
      source: "telegram_transcription", idempotencyKey: `telegram-transcription:${String(scope.item._id)}`,
    });
    return null;
  },
});
