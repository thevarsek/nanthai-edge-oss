import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import { sha256Hex } from "../../runtime_host/security";

export const send=internalAction({
  args:{deliveryId:v.id("channelDeliveries")},returns:v.null(),handler:async(ctx,args):Promise<null>=>{
    const item=await ctx.runMutation(internal.channels.delivery_mutations.claim,args);
    if (!item?.attemptId||item.fence===undefined) return null;
    const token=process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("Telegram bot credential is not configured.");
    let method = "sendMessage";
    let request: RequestInit = {method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({chat_id:item.externalChatId,text:item.text,link_preview_options:{is_disabled:true}})};
    if(item.storageId){
      const url=await ctx.storage.getUrl(item.storageId);
      if(!url){await ctx.runMutation(internal.channels.delivery_mutations.settle,{deliveryId:item._id,attemptId:item.attemptId,fence:item.fence,status:"failed",error:"The audio result is no longer available in NanthAI."});return null;}
      let bytes:Blob;
      try {const response=await fetch(url,{signal:AbortSignal.timeout(20_000)});if(!response.ok)throw new Error("Missing audio");bytes=await response.blob();}
      catch {await ctx.runMutation(internal.channels.delivery_mutations.settle,{deliveryId:item._id,attemptId:item.attemptId,fence:item.fence,status:"failed",error:"The audio result could not be read. Retry delivery in NanthAI."});return null;}
      method=item.kind==="voice"?"sendVoice":"sendDocument";
      const form=new FormData();form.set("chat_id",item.externalChatId);if(item.text)form.set("caption",item.text);
      const extension = item.mimeType?.includes("mpeg") ? "mp3" : item.mimeType?.includes("mp4") ? "m4a" : item.mimeType?.split("/")[1] ?? "audio";
      form.set(item.kind==="voice"?"voice":"document",bytes,`NanthAI reply.${extension}`);
      request={method:"POST",body:form};
    }
    const operationKey=`send:${item.attempt}`;
    const operation=await ctx.runMutation(internal.execution.operations.prepare,{attemptId:item.attemptId,fence:item.fence,operationKey,
      toolName:"telegram_send_message",toolCallId:String(item._id),effect:"write",retry:"never",authorizationSource:"explicit_user_turn",
      inputHash:await sha256Hex(JSON.stringify({chat:item.externalChatId,text:item.text,storageId:item.storageId,kind:item.kind}))});
    if (operation.decision!=="execute") throw new Error("Telegram delivery outcome requires reconciliation.");
    await ctx.runMutation(internal.execution.operations.markDispatched,{attemptId:item.attemptId,fence:item.fence,operationKey});
    let result:{ok:boolean;result?:{message_id:number};error_code?:number;parameters?:{retry_after?:number}};
    try {
      const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{...request,signal:AbortSignal.timeout(20_000)});
      result=await response.json();
    } catch {
      await ctx.runMutation(internal.execution.operations.markOutcomeUnknown, {attemptId: item.attemptId, fence: item.fence, operationKey, errorSummary: "Telegram send outcome is unknown."});
      await ctx.runMutation(internal.channels.delivery_mutations.settle,{deliveryId:item._id,attemptId:item.attemptId,fence:item.fence,status:"unknown",error:"Telegram send outcome is unknown. Open NanthAI and choose whether to resend."});return null;
    }
    await ctx.runMutation(internal.execution.operations.complete,{attemptId:item.attemptId,fence:item.fence,operationKey,resultJson:JSON.stringify(result),externalId:result.result?String(result.result.message_id):undefined});
    await ctx.runMutation(internal.channels.delivery_mutations.settle,{deliveryId:item._id,attemptId:item.attemptId,fence:item.fence,
      status:result.ok?"sent":result.error_code===429?"retry":"failed",externalMessageId:result.result?.message_id,
      retrySeconds:result.parameters?.retry_after,error:result.ok?undefined:result.error_code===429?"Telegram rate limit; delivery retry queued.":"Telegram rejected delivery. The canonical result remains in NanthAI."});
    return null;
  },
});
