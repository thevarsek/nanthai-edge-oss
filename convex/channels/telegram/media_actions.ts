"use node";

import { z } from "zod";
import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction, type ActionCtx } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { getOptionalUserOpenRouterApiKey } from "../../lib/user_secrets";
import { guessAudioInputFormat } from "../../chat/audio_runtime";
import { sha256Hex } from "../../runtime_host/security";

export const TELEGRAM_VOICE_KEY_MESSAGE = "Voice messages need an OpenRouter key for transcription and spoken replies. Connect OpenRouter in NanthAI Settings, then retry this retained message. Your local runtime can still handle text and supported files.";
export const TELEGRAM_TRANSCRIPTION_MODEL = "openai/whisper-large-v3";
const fileResponse = z.object({ok:z.boolean(),result:z.object({file_path:z.string()}).optional()});
const transcriptionResponse = z.object({text:z.string(),usage:z.object({cost:z.number().optional(),input_tokens:z.number().optional(),output_tokens:z.number().optional(),total_tokens:z.number().optional()}).optional()});

export const ingest = internalAction({
  args:{inboxId:v.id("channelInbox")},returns:v.null(),handler:(ctx,args)=>ingestTelegramMedia(ctx,args),
});

export async function ingestTelegramMedia(ctx: ActionCtx, {inboxId}: {inboxId: Id<"channelInbox">}, deps = {getKey:getOptionalUserOpenRouterApiKey}): Promise<null> {
  const scope = await ctx.runMutation(internal.channels.telegram.media_scope.get,{inboxId});
  if (!scope) return null;
  const voice = scope.files.some(file=>file.type === "voice" || file.type === "audio");
  const key = voice ? await deps.getKey(ctx,scope.userId) : null;
  if (voice && !key) throw new Error(TELEGRAM_VOICE_KEY_MESSAGE);
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Telegram is not configured on this deployment.");
  const execution={attemptId:scope.attemptId,fence:scope.fence};
  for (const file of scope.files) {
    if (scope.uploads.some(upload=>upload.fileId===file.fileId)) continue;
    const operationKey=`telegram-upload:${file.fileId}`;
    const uploadSession=await ctx.runMutation(internal.channels.telegram.media_scope.prepareUpload,{inboxId,fileId:file.fileId});
    const info = fileResponse.parse(await telegramJson(token,"getFile",{file_id:file.fileId}));
    if (!info.ok || !info.result) throw new Error("Telegram could not provide this attachment. Its hosted Bot API downloads files up to 20 MB; larger files can be sent in NanthAI.");
    let response: Response;
    try { response=await fetch(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`,{signal:AbortSignal.timeout(30_000)}); }
    catch {throw new Error("The Telegram attachment could not be downloaded. Retry the retained input in NanthAI.");}
    if (!response.ok) throw new Error("The Telegram attachment could not be downloaded. Retry the retained input in NanthAI.");
    const bytes=await response.arrayBuffer();
    const decision=await ctx.runMutation(internal.execution.operations.prepare,{...execution,operationKey,toolName:"telegram_attachment_upload",toolCallId:operationKey,effect:"write",retry:"never",authorizationSource:"explicit_user_turn",inputHash:await sha256Hex(JSON.stringify({inboxId,fileId:file.fileId,size:bytes.byteLength}))});
    if(decision.decision!=="execute")throw new Error("This attachment upload needs reconciliation. Retry explicitly in NanthAI.");
    await ctx.runMutation(internal.execution.operations.markDispatched,{...execution,operationKey});
    let uploaded: {storageId:Id<"_storage">};
    try {
      const result=await fetch(uploadSession.uploadUrl,{method:"POST",headers:{"Content-Type":file.mimeType},body:bytes,signal:AbortSignal.timeout(30_000)});
      if(!result.ok)throw new Error("Upload failed");
      uploaded=await result.json();
    } catch {
      await ctx.runMutation(internal.execution.operations.markOutcomeUnknown,{...execution,operationKey,errorSummary:"Attachment upload outcome is unknown."});
      throw new Error("Attachment upload did not complete. Retry the retained input in NanthAI.");
    }
    await ctx.runMutation(internal.execution.operations.complete,{...execution,operationKey,resultJson:JSON.stringify(uploaded)});
    await ctx.runMutation(internal.channels.telegram.media_scope.commitUpload,{inboxId,...execution,upload:{...file,type:file.type === "voice" ? "audio" : file.type,storageId:uploaded.storageId,uploadSessionId:uploadSession.uploadSessionId,sizeBytes:bytes.byteLength}});
  }
  if (voice && !scope.transcript) {
    const current=await ctx.runMutation(internal.channels.telegram.media_scope.get,{inboxId});
    const audio=current?.uploads.find(file=>file.type==="audio");
    if(!audio || !key)throw new Error("Voice attachment is unavailable. Retry the retained input in NanthAI.");
    const url=await ctx.storage.getUrl(audio.storageId);
    if(!url)throw new Error("Voice attachment is unavailable. Retry the retained input in NanthAI.");
    const bytes=await (await fetch(url,{signal:AbortSignal.timeout(30_000)})).arrayBuffer();
    const preferences=await ctx.runQuery(internal.chat.queries.getUserPreferences,{userId:scope.userId});
    const operationKey="telegram-transcription";
    const decision=await ctx.runMutation(internal.execution.operations.prepare,{...execution,operationKey,toolName:"telegram_transcription",toolCallId:operationKey,effect:"read",retry:"never",authorizationSource:"explicit_user_turn",inputHash:await sha256Hex(JSON.stringify({fileId:audio.fileId,model:TELEGRAM_TRANSCRIPTION_MODEL}))});
    if(decision.decision!=="execute")throw new Error("Transcription needs an explicit retry in NanthAI.");
    await ctx.runMutation(internal.execution.operations.markDispatched,{...execution,operationKey});
    const format = guessAudioInputFormat(audio.mimeType,audio.name);
    let response: Response;
    try {response=await fetch("https://openrouter.ai/api/v1/audio/transcriptions",{method:"POST",headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
      body:JSON.stringify({model:TELEGRAM_TRANSCRIPTION_MODEL,input_audio:{data:Buffer.from(bytes).toString("base64"),format},provider:{zdr:preferences?.zdrEnabled===true}}),signal:AbortSignal.timeout(65_000)});}
    catch {
      await ctx.runMutation(internal.execution.operations.markOutcomeUnknown,{...execution,operationKey,errorSummary:"Transcription outcome is unknown."});
      throw new Error("Voice transcription did not complete. The recording is retained; retry it in NanthAI.");
    }
    if(!response.ok) {
      await ctx.runMutation(internal.execution.operations.complete,{...execution,operationKey,resultJson:JSON.stringify({status:response.status,error:"transcription_rejected"})});
      if(response.status===401||response.status===403)throw new Error("OpenRouter rejected your key for voice transcription. Reconnect OpenRouter in NanthAI Settings, then retry this message.");
      throw new Error("Voice transcription is unavailable for the selected route or data policy. The recording is retained; retry it in NanthAI.");
    }
    const result=transcriptionResponse.parse(await response.json());
    await ctx.runMutation(internal.execution.operations.complete,{...execution,operationKey,resultJson:JSON.stringify(result)});
    await ctx.runMutation(internal.channels.telegram.media_scope.commitTranscript,{inboxId,...execution,text:result.text,modelId:TELEGRAM_TRANSCRIPTION_MODEL,cost:result.usage?.cost ?? 0,
      promptTokens:result.usage?.input_tokens ?? 0,completionTokens:result.usage?.output_tokens ?? 0,totalTokens:result.usage?.total_tokens ?? 0,generationId:response.headers.get("X-Generation-Id") ?? undefined});
  }
  return null;
}
async function telegramJson(token:string,method:string,args:Record<string,string>):Promise<unknown> {
  try {return await (await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(args),signal:AbortSignal.timeout(20_000)})).json();}
  catch {throw new Error("Telegram could not retrieve this file. Retry the retained input in NanthAI.");}
}
