import assert from "node:assert/strict";
import {test, mock} from "node:test";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx } from "../_generated/server";
import {telegramFixture,telegramComponentFakes} from "../../test_helpers/telegram_fixture";
import { receive } from "../channels/telegram/ingress";
import { admit } from "../channels/telegram/admission";
import { confirm } from "../channels/linking";
import { deliveryAuthority, queueTelegramReply } from "../channels/delivery_queue";
import { claim, settle, resend } from "../channels/delivery_mutations";
import { advance, wakeChannelTurns } from "../channels/turn_queue";
import { notifyChannelInput, publishChannelMessage } from "../channels/publication";
import { telegramWebhook } from "../channels/telegram/http";
import { normalizeTelegramUpdate, telegramParts, telegramPublishedText } from "../channels/telegram/payload";
import { deleteChannelConversationBatch } from "../channels/cleanup";
import { sha256Hex } from "../runtime_host/security";
import { invoke } from "./conversation_context_fixture";

const update={botId:"bot",updateId:10,externalUserId:"42",externalChatId:"42",externalMessageId:1,text:"Remember blue",kind:"text",claimantName:"Tester"};

test("private webhook validates the secret before durable admission and ignores group/bot traffic",async()=>{
  const old=process.env.TELEGRAM_WEBHOOK_SECRET; const oldBot=process.env.TELEGRAM_BOT_ID;
  process.env.TELEGRAM_WEBHOOK_SECRET="test-secret";process.env.TELEGRAM_BOT_ID="bot";
  let writes=0;
  const ctx={runMutation:async()=>{writes++;}} as unknown as ActionCtx;
  try {
    const body={update_id:1,message:{message_id:1,from:{id:42},chat:{id:42,type:"private"},text:"hello"}};
    const request=(secret:string,value:unknown)=>new Request("https://dev.example/webhook",{method:"POST",headers:{"X-Telegram-Bot-Api-Secret-Token":secret},body:JSON.stringify(value)});
    assert.equal((await telegramWebhook(ctx,request("wrong",body))).status,401);assert.equal(writes,0);
    assert.equal((await telegramWebhook(ctx,request("test-secret",body))).status,200);assert.equal(writes,1);
    assert.equal(normalizeTelegramUpdate({...body,message:{...body.message,chat:{id:42,type:"group"}}}),null);
    assert.equal(normalizeTelegramUpdate({...body,message:{...body.message,from:{id:42,is_bot:true}}}),null);
    assert.equal((await telegramWebhook(ctx,request("test-secret",{}))).status,400);
    assert.equal((await telegramWebhook(ctx,request("test-secret",{padding:"x".repeat(1024*1024)}))).status,413);
    assert.equal(writes,1,"oversized envelopes must not create an inbox record");
  } finally {if(old===undefined)delete process.env.TELEGRAM_WEBHOOK_SECRET;else process.env.TELEGRAM_WEBHOOK_SECRET=old;if(oldBot===undefined)delete process.env.TELEGRAM_BOT_ID;else process.env.TELEGRAM_BOT_ID=oldBot;}
});

test("duplicate and out-of-order updates admit one canonical turn each through the shared product send",async()=>{
  telegramComponentFakes();const {ctx,rows}=telegramFixture();
  try {
    const id=await invoke<Id<"channelInbox">>(receive,ctx,update);
    assert.equal(await invoke(receive,ctx,update),id);
    await invoke(admit,ctx,{inboxId:id,claimantName:"Tester"});
    await invoke(admit,ctx,{inboxId:id,claimantName:"Tester"});
    assert.equal(rows.messages.filter(message=>message.role==="user").length,1);
    assert.equal(rows.channelInbox[0].status,"accepted");assert.equal(rows.channelTurns.length,1);
    const late=await invoke<Id<"channelInbox">>(receive,ctx,{...update,updateId:9,externalMessageId:2,text:"Then green"});
    assert.equal(rows.channelInbox[1].late,true);
    await invoke(admit,ctx,{inboxId:late,claimantName:"Tester"});
    assert.equal(rows.messages.filter(message=>message.role==="user").length,2);
    assert.equal(rows.channelTurns.length,2);
    const first=await invoke<{done:boolean}>(advance,ctx,{turnId:rows.channelTurns[0]._id});assert.equal(first.done,false);
    await invoke(advance,ctx,{turnId:rows.channelTurns[1]._id});assert.equal(rows.channelTurns[1].status,"queued");
    const firstArgs=rows.channelTurns[0].generationArgs as {generationJobIds:string[];assistantMessageIds:string[]};
    rows.generationJobs.find(job=>job._id===firstArgs.generationJobIds[0])!.status="completed";
    await wakeChannelTurns(ctx,"chat" as Id<"chats">);
    assert.equal(rows.channelTurns[0].status,"running","a terminal job alone cannot release uncommitted text");
    rows.messages.find(message=>message._id===firstArgs.assistantMessageIds[0])!.status="completed";
    await wakeChannelTurns(ctx,"chat" as Id<"chats">);
    await invoke(advance,ctx,{turnId:rows.channelTurns[1]._id});assert.equal(rows.channelTurns[1].status,"running");
  } finally {mock.restoreAll();}
});

test("link claim is immutable, expires, and needs the authenticated grant owner",async()=>{
  telegramComponentFakes();const {ctx,rows}=telegramFixture();rows.channelIdentities=[];rows.channelBindings=[];
  const token="a".repeat(48);rows.channelLinkGrants=[{_id:"grant",userId:"user_1",botId:"bot",tokenHash:await sha256Hex(token),expiresAt:Date.now()+10000,status:"pending"}];
  try {
    const id=await invoke(receive,ctx,{...update,text:`/start ${token}`});
    assert.doesNotMatch(String(rows.channelInbox[0].text),new RegExp(token));
    await invoke(admit,ctx,{inboxId:id,claimantName:"Tester"});assert.equal(rows.channelLinkGrants[0].status,"claimed");
    const stolen=await invoke(receive,ctx,{...update,updateId:11,externalUserId:"99",externalChatId:"99",text:`/start ${token}`});
    await invoke(admit,ctx,{inboxId:stolen,claimantName:"Wrong claimant"});assert.equal(rows.channelLinkGrants[0].externalUserId,"42");
    const foreign={...ctx,auth:{getUserIdentity:async()=>({subject:"user_2"})}} as unknown as MutationCtx;
    await assert.rejects(invoke(confirm,foreign,{grantId:"grant"}));
    const identity=await invoke(confirm,ctx,{grantId:"grant"});assert.equal(await invoke(confirm,ctx,{grantId:"grant"}),identity);
    rows.channelLinkGrants[0].expiresAt=0;await assert.rejects(invoke(confirm,ctx,{grantId:"grant"}));
  } finally {mock.restoreAll();}
});

test("published future replies and native-input links deduplicate; revoked revisions never deliver",async()=>{
  telegramComponentFakes();const {ctx,rows}=telegramFixture();
  rows.messages=[{_id:"answer",userId:"user_1",chatId:"chat",chatParticipantId:"participant",role:"assistant",status:"completed",content:"Result /Users/test/private.txt",createdAt:100}];
  try {
    await publishChannelMessage(ctx,"answer" as Id<"messages">);await publishChannelMessage(ctx,"answer" as Id<"messages">);
    assert.equal(rows.channelDeliveries.length,1);assert.doesNotMatch(String(rows.channelDeliveries[0].text),/\/Users/);
    await notifyChannelInput(ctx,"chat" as Id<"chats">,"request");assert.match(String(rows.channelDeliveries[1].text),/signed-in NanthAI/);
    assert.doesNotMatch(String(rows.channelDeliveries[1].text),/approve|allow/i);
    assert.equal(await deliveryAuthority(ctx,rows.channelDeliveries[0] as unknown as Doc<"channelDeliveries">),true);
    rows.channelBindings[0].revision=2;
    assert.equal(await invoke(claim,ctx,{deliveryId:rows.channelDeliveries[0]._id}),null);
    assert.equal(rows.channelDeliveries[0].status,"cancelled");
  } finally {mock.restoreAll();}
});

test("429 delivery retry and unknown-send explicit resend preserve canonical inference",async()=>{
  telegramComponentFakes();const {ctx,rows}=telegramFixture();
  try {
    await queueTelegramReply(ctx,{botId:update.botId,externalChatId:update.externalChatId,dedupKey:"reply",text:"published answer",userId:"user_1",bindingId:"binding" as Id<"channelBindings">,bindingRevision:1,chatId:"chat" as Id<"chats">});
    const item=rows.channelDeliveries[0];await invoke(claim,ctx,{deliveryId:item._id});
    await invoke(settle,ctx,{deliveryId:item._id,attemptId:item.attemptId,fence:item.fence,status:"retry",retrySeconds:2});assert.equal(item.status,"retry");
    item.status="unknown";
    await assert.rejects(invoke(resend,ctx,{deliveryId:item._id,acknowledgeDuplicateRisk:false}));
    await invoke(resend,ctx,{deliveryId:item._id,acknowledgeDuplicateRisk:true});assert.equal(item.status,"scheduled");
    assert.equal(rows.generationJobs?.length ?? 0,0);
  } finally {mock.restoreAll();}
});

test("multipart Unicode remains literal and chat cleanup drains every summary and channel owner",async()=>{
  const text="😀`<test>".repeat(1400);const parts=telegramParts(text);
  assert.ok(parts.every(part=>Array.from(part).length<4096));assert.equal(parts.map(part=>part.replace(/^\[\d+\/\d+\]\n/,"")).join(""),text);
  assert.equal(telegramPublishedText("file /home/test/key.txt"),"file [local file; open NanthAI]");
  const {ctx,rows}=telegramFixture();rows.conversationSummaries=[{_id:"summary",chatId:"chat"}];rows.conversationSummarySources=[{_id:"manifest",chatId:"chat"}];
  assert.equal(await deleteChannelConversationBatch(ctx,"chat" as Id<"chats">,5),false);
  assert.equal(rows.channelBindings.length,0);assert.equal(rows.conversationSummarySources.length,0);
  assert.equal(rows.channelIdentities.length,1,"connection survives a deleted conversation without a binding");
});
