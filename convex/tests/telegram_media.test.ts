import assert from "node:assert/strict";
import {test, mock} from "node:test";
import type {ActionCtx} from "../_generated/server";
import type {Id} from "../_generated/dataModel";
import {normalizeTelegramUpdate,telegramAppAction} from "../channels/telegram/payload";
import {ingestTelegramMedia,TELEGRAM_VOICE_KEY_MESSAGE} from "../channels/telegram/media_actions";

test("Telegram normalizes photos, files and voice recordings with their caption and actual source metadata",()=>{
  const envelope={update_id:1,message:{message_id:4,chat:{type:"private",id:42},from:{id:42},caption:"Read this",photo:[{file_id:"small",width:10,height:10},{file_id:"large",width:100,height:100}]}};
  const photo=normalizeTelegramUpdate(envelope);assert.equal(photo?.files?.[0].fileId,"large");assert.equal(photo?.text,"Read this");
  const voice=normalizeTelegramUpdate({...envelope,message:{...envelope.message,photo:undefined,voice:{file_id:"voice",duration:3,mime_type:"audio/ogg"}}});
  assert.equal(voice?.files?.[0].durationMs,3000);assert.equal(voice?.files?.[0].type,"voice");
  const document=normalizeTelegramUpdate({...envelope,message:{...envelope.message,photo:undefined,document:{file_id:"file",file_name:"notes.pdf",mime_type:"application/pdf"}}});
  assert.equal(document?.files?.[0].name,"notes.pdf");
});

test("voice input without an OpenRouter key is intercepted before any download, upload or provider call",async()=>{
  let effects=0;
  const ctx={runMutation:async()=>({userId:"user",runId:"run",attemptId:"attempt",fence:1,files:[{fileId:"voice",type:"voice"}],uploads:[]})} as unknown as ActionCtx;
  mock.method(globalThis,"fetch",async()=>{effects++;throw new Error("No request expected");});
  try {await assert.rejects(ingestTelegramMedia(ctx,{inboxId:"inbox" as Id<"channelInbox">},{getKey:async()=>null}),error=>error instanceof Error&&error.message===TELEGRAM_VOICE_KEY_MESSAGE);assert.equal(effects,0);}
  finally {mock.restoreAll();}
});

test("normal replies have no app footer; explicit app actions never advertise a local-only address",()=>{
  const previous=process.env.NANTHAI_WEB_ORIGIN;
  try {
    delete process.env.NANTHAI_WEB_ORIGIN;assert.equal(telegramAppAction("Open NanthAI","chat"),"Open NanthAI");
    process.env.NANTHAI_WEB_ORIGIN="http://localhost:5173";assert.equal(telegramAppAction("Open NanthAI","chat"),"Open NanthAI");
    process.env.NANTHAI_WEB_ORIGIN="https://dev.example.com";assert.equal(telegramAppAction("Open NanthAI","chat"),"Open NanthAI: https://dev.example.com/app/chat/chat");
  } finally {if(previous===undefined)delete process.env.NANTHAI_WEB_ORIGIN;else process.env.NANTHAI_WEB_ORIGIN=previous;}
});

// Composed shared API paths, including the same queue used by app-origin turns.
import {telegramFixture,telegramComponentFakes} from "../../test_helpers/telegram_fixture";
import {invoke} from "./conversation_context_fixture";
import {receive} from "../channels/telegram/ingress";
import {admit,fail} from "../channels/telegram/admission";
import {advance,wakeChannelTurns} from "../channels/turn_queue";
import {publishChannelMessage} from "../channels/publication";
import {publishChannelAudio} from "../channels/audio_publication";
import {cancelPreparingTelegramInputs} from "../channels/telegram/media_cancellation";
import {commitTranscript} from "../channels/telegram/media_scope";
import {maybeStartAutomaticMessageAudio} from "../chat/audio_workflow_start";
import {sendMessageForActor} from "../chat/mutations_public_handlers";
import {buildRequestMessages} from "../chat/helpers";
import type {ContextMessage} from "../chat/helpers_types";
import type {RunGenerationArgs} from "../chat/actions_run_generation_types";

const source={botId:"bot",updateId:20,externalUserId:"42",externalChatId:"42",externalMessageId:20,text:"",kind:"media",claimantName:"Tester",
 files:[{fileId:"voice",type:"voice",name:"voice.ogg",mimeType:"audio/ogg",durationMs:2000}]};

test("multiple AIs receive the ordinary shared turn; speaker labels appear only for multiple AIs",async()=>{
 telegramComponentFakes();const {ctx,rows}=telegramFixture();
 try {
  rows.chatParticipants.push({_id:"reviewer",userId:"user_1",chatId:"chat",modelId:"model_tools",personaName:"Reviewer",sortOrder:1});
  const inboxId=await invoke(receive,ctx,{...source,kind:"text",files:undefined,text:"Compare perspectives"});
  await invoke(admit,ctx,{inboxId,claimantName:"Tester"});
  assert.equal(rows.generationJobs.length,2);
  const answer=rows.messages.find(row=>row.chatParticipantId==="participant")!;Object.assign(answer,{status:"completed",content:"A result"});
  await publishChannelMessage(ctx,answer._id as Id<"messages">);
  assert.equal(rows.channelDeliveries[0].text,"Writer\nA result");
  rows.chatParticipants.splice(1);answer._id="single-answer";rows.messages.push({...answer});
  await publishChannelMessage(ctx,answer._id as Id<"messages">);
  assert.equal(rows.channelDeliveries[1].text,"A result");
 } finally {mock.restoreAll();}
});

test("preparing voice reserves its canonical position and a later text turn waits until preparation terminates",async()=>{
 telegramComponentFakes();const {ctx,rows}=telegramFixture();
 try {
  const voice=await invoke(receive,ctx,source);
  const pending=rows.messages[0];assert.equal(pending.status,"pending");
  const later=await invoke(receive,ctx,{...source,updateId:21,externalMessageId:21,kind:"text",files:undefined,text:"Follow up"});
  await invoke(admit,ctx,{inboxId:later,claimantName:"Tester"});
  const textTurn=rows.channelTurns[0];await invoke(advance,ctx,{turnId:textTurn._id});
  assert.equal(textTurn.status,"queued");assert.ok(textTurn.wakeEventId);
  await invoke(fail,ctx,{inboxId:voice,error:TELEGRAM_VOICE_KEY_MESSAGE});
  assert.equal(pending.status,"failed");assert.equal(pending.inputProcessingNotice,"openrouter_required");
  assert.equal(textTurn.wakeEventId,undefined,"failure wakes the existing durable queue");
  await invoke(advance,ctx,{turnId:textTurn._id});assert.equal(textTurn.status,"running");
 } finally {mock.restoreAll();}
});

test("Telegram media followed by Telegram or app text retains media, committed replies and the newer selected leaf",async()=>{
 for(const origin of ["telegram","app"]) {
  telegramComponentFakes();const {ctx,rows}=telegramFixture();
  try {
   let now=Date.now();mock.method(Date,"now",()=>++now);
   rows.messages=[{_id:"old-reply",userId:"user_1",chatId:"chat",role:"assistant",status:"completed",content:"Previous answer",parentMessageIds:[],createdAt:1}];
   rows.chats[0].activeBranchLeafId="old-reply";
   const inboxId=await invoke<Id<"channelInbox">>(receive,ctx,{...source,text:"Inspect this image",
    files:[{fileId:"photo",type:"image",name:"photo.jpg",mimeType:"image/jpeg"}]});
   const media=rows.messages[1];assert.equal(rows.chats[0].activeBranchLeafId,media._id);
   if(origin==="telegram") {
    const laterId=await invoke(receive,ctx,{...source,updateId:21,externalMessageId:21,kind:"text",files:undefined,text:"What color is it?"});
    await invoke(admit,ctx,{inboxId:laterId,claimantName:"Tester"});
   } else {
    await sendMessageForActor(ctx,{chatId:"chat" as Id<"chats">,text:"What color is it?",
     participants:[{participantKey:"participant",modelId:"model_tools",personaId:"persona" as Id<"personas">}]},"user_1");
   }
   const textTurn=rows.channelTurns[0];const textArgs=textTurn.generationArgs as RunGenerationArgs;
   const selectedLeaf=rows.chats[0].activeBranchLeafId;
   await invoke(advance,ctx,{turnId:textTurn._id});assert.equal(textTurn.status,"queued");
   Object.assign(ctx.storage,{getMetadata:async()=>({size:12,contentType:"image/jpeg"})});
   rows.chatUploadSessions=[{_id:"upload",userId:"user_1",storageId:"photo-storage",status:"pending"}];
   rows.channelInbox.find(item=>item._id===inboxId)!.uploads=[{fileId:"photo",type:"image",name:"photo.jpg",mimeType:"image/jpeg",sizeBytes:12,storageId:"photo-storage",uploadSessionId:"upload"}];
   await invoke(admit,ctx,{inboxId,claimantName:"Tester"});
   assert.equal(rows.chats[0].activeBranchLeafId,selectedLeaf,"delayed media admission preserves the newer selected reply");
   const mediaTurn=rows.channelTurns[1];const mediaArgs=mediaTurn.generationArgs as RunGenerationArgs;
   // The shared fake does not implement index ordering; match the real queue index.
   rows.channelTurns.sort((a,b)=>Number(a.createdAt)-Number(b.createdAt));
   await invoke(advance,ctx,{turnId:mediaTurn._id});assert.equal(mediaTurn.status,"running");
   for(const id of mediaArgs.generationJobIds)rows.generationJobs.find(job=>job._id===id)!.status="completed";
   for(const id of mediaArgs.assistantMessageIds)Object.assign(rows.messages.find(message=>message._id===id)!,{status:"completed",content:"The image is blue."});
   await wakeChannelTurns(ctx,"chat" as Id<"chats">);
   await invoke(advance,ctx,{turnId:textTurn._id});assert.equal(textTurn.status,"running");
   const followup=rows.messages.find(message=>message._id===textArgs.userMessageId)!;
   assert.deepEqual(followup.parentMessageIds,mediaArgs.assistantMessageIds);
   const request=buildRequestMessages({messages:rows.messages as unknown as ContextMessage[],excludeMessageId:textArgs.assistantMessageIds[0]});
   const serialized=JSON.stringify(request);
   assert.match(serialized,/Inspect this image/);assert.match(serialized,/photo-storage/);
   assert.match(serialized,/The image is blue/);assert.match(serialized,/What color is it/);
   assert.ok(serialized.indexOf("Inspect this image")<serialized.indexOf("The image is blue"));
   assert.ok(serialized.indexOf("The image is blue")<serialized.indexOf("What color is it"));
  } finally {mock.restoreAll();}
 }
});

test("Stop closes the media writer before stale transcript work can commit",async()=>{
 telegramComponentFakes();const {ctx,rows}=telegramFixture();
 try {
  const inboxId=await invoke(receive,ctx,source);
  const run=rows.executionRuns[0];const attempt=rows.executionAttempts[0];
  const count=await cancelPreparingTelegramInputs(ctx,{chatId:"chat" as Id<"chats">,userId:"user_1"});
  assert.equal(count,1);assert.equal(run.state,"cancelling");assert.equal(rows.messages[0].status,"cancelled");
  await assert.rejects(invoke(commitTranscript,ctx,{inboxId,attemptId:attempt._id,fence:attempt.fence,text:"Late transcript",modelId:"openai/whisper-1",cost:0.01,promptTokens:2,completionTokens:3,totalTokens:5}));
  assert.equal(rows.usageRecords?.length ?? 0,0);
 } finally {mock.restoreAll();}
});

test("transcription usage is owned and idempotent, and audio publication preserves app format and single-AI plain captions",async()=>{
 telegramComponentFakes();const {ctx,rows}=telegramFixture();
 try {
  const inboxId=await invoke(receive,ctx,source);const run=rows.executionRuns[0];const attempt=rows.executionAttempts[0];
  Object.assign(run,{state:"running"});Object.assign(attempt,{status:"running",leaseExpiresAt:Date.now()+10000});
  const args={inboxId,attemptId:attempt._id,fence:attempt.fence,text:"Speech",modelId:"openai/whisper-1",cost:0.01,promptTokens:2,completionTokens:3,totalTokens:5};
  await invoke(commitTranscript,ctx,args);await invoke(commitTranscript,ctx,args);
  assert.equal(rows.usageRecords.length,1);assert.equal(rows.usageRecords[0].source,"telegram_transcription");
  rows.messages.push({_id:"speech-answer",userId:"user_1",chatId:"chat",chatParticipantId:"participant",role:"assistant",status:"completed",content:"Reply",audioStorageId:"speech",audioMimeType:"audio/wav",createdAt:Date.now()+1});
  await publishChannelAudio(ctx,"speech-answer" as Id<"messages">);
  assert.equal(rows.channelDeliveries[0].kind,"audio_file");assert.equal(rows.channelDeliveries[0].mimeType,"audio/wav");assert.equal(rows.channelDeliveries[0].text,"");
 } finally {mock.restoreAll();}
});

test("local-only audio reply keeps committed text and creates no speech execution; disabled automatic speech stays off",async()=>{
 const {ctx,rows}=telegramFixture();
 rows.messages=[{_id:"input",userId:"user_1",chatId:"chat",role:"user",audioStorageId:"recording",audioSource:"user_recording"},{_id:"answer",userId:"user_1",chatId:"chat",role:"assistant",content:"The local text reply",status:"completed"}];
 rows.chats[0].autoAudioResponseOverride="disabled";
 const args={messageId:"answer" as Id<"messages">,chatId:"chat" as Id<"chats">,triggerUserMessageId:"input" as Id<"messages">};
 await maybeStartAutomaticMessageAudio(ctx,args);assert.equal(rows.messages[1].audioReplyNotice,undefined);
 rows.chats[0].autoAudioResponseOverride="enabled";await maybeStartAutomaticMessageAudio(ctx,args);
 assert.equal(rows.messages[1].content,"The local text reply");assert.equal(rows.messages[1].audioReplyNotice,"openrouter_required");assert.equal(rows.messages[1].audioGenerating,undefined);assert.equal(rows.executionRuns?.length ?? 0,0);
});

test("explicit retained-input retry can return to its original owned conversation after switching bindings",async()=>{
 telegramComponentFakes();const {ctx,rows}=telegramFixture();
 try {
  const {retryInput}=await import("../channels/controls");
  rows.channelBindings[0].active=false;
  rows.channelBindings.push({_id:"current-binding",identityId:"identity",userId:"user_1",chatId:"chat",active:true,revision:3,deliverAfter:Date.now()});
  rows.channelInbox=[{_id:"retained",userId:"user_1",botId:"bot",identityId:"identity",bindingId:"binding",bindingRevision:1,chatId:"chat",status:"failed",text:"Retained input",createdAt:1}];
  await invoke(retryInput,ctx,{inboxId:"retained"});
  assert.equal(rows.channelInbox[0].status,"received");assert.equal(rows.channelInbox[0].bindingId,"current-binding");assert.equal(rows.channelInbox[0].bindingRevision,3);
  rows.channelInbox[0].status="failed";rows.channelBindings[1].chatId="another-chat";
  await assert.rejects(invoke(retryInput,ctx,{inboxId:"retained"}),/original conversation/);
 } finally {mock.restoreAll();}
});
