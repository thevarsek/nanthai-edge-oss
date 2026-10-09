import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../_generated/server";
import { send } from "../channels/telegram/delivery";

test("Telegram transport journals confirmed, rate-limited and ambiguous sends without inference replay", async () => {
  const previous = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = "test-token";
  try {
    for (const outcome of ["sent", "retry", "unknown"] as const) {
      const calls: { name: string; args: Record<string, unknown> }[] = [];
      const ctx = { runMutation: async (ref: unknown, args: Record<string, unknown>) => {
        const name = getFunctionName(ref as never); calls.push({name, args});
        if (name.endsWith(":claim")) return {_id:"delivery", attemptId:"attempt", fence:1, attempt:1, externalChatId:"42", text:"Committed answer"};
        if (name.endsWith(":prepare")) return {decision:"execute"};
        return null;
      }} as unknown as ActionCtx;
      mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
        assert.deepEqual(JSON.parse(String(init?.body)), {chat_id:"42", text:"Committed answer", link_preview_options:{is_disabled:true}});
        if (outcome === "unknown") throw new Error("Disconnected after dispatch");
        return new Response(JSON.stringify(outcome === "sent" ? {ok:true,result:{message_id:17}} : {ok:false,error_code:429,parameters:{retry_after:12}}));
      });
      await (send as unknown as {_handler: (ctx: ActionCtx, args: {deliveryId: string}) => Promise<null>})._handler(ctx, {deliveryId:"delivery"});
      assert.equal(calls.find(call => call.name.endsWith(":settle"))?.args.status, outcome);
      assert.equal(calls.filter(call => call.name.endsWith(":markDispatched")).length, 1);
      assert.equal(calls.filter(call => call.name.endsWith(":complete")).length, outcome === "unknown" ? 0 : 1);
      assert.equal(calls.filter(call => call.name.endsWith(":markOutcomeUnknown")).length, outcome === "unknown" ? 1 : 0);
      assert.ok(calls.every(call => !/generation|sendMessage/.test(call.name)), "delivery recovery cannot invoke generation");
      if (outcome === "retry") assert.equal(calls.find(call => call.name.endsWith(":settle"))?.args.retrySeconds, 12);
      mock.restoreAll();
    }
  } finally {
    mock.restoreAll();
    if (previous === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = previous;
  }
});

test("audio delivery uses the app's stored bytes and journals one Telegram voice send", async () => {
  const old = process.env.TELEGRAM_BOT_TOKEN; process.env.TELEGRAM_BOT_TOKEN = "test-token";
  const calls: {name:string;args:Record<string,unknown>}[]=[];
  const ctx={storage:{getUrl:async()=>"https://storage.example/audio"},runMutation:async(ref:unknown,args:Record<string,unknown>)=>{
    const name=getFunctionName(ref as never);calls.push({name,args});
    if(name.endsWith(":claim"))return {_id:"delivery",attemptId:"attempt",fence:1,attempt:1,externalChatId:"42",text:"Writer",storageId:"audio",mimeType:"audio/mpeg",kind:"voice"};
    if(name.endsWith(":prepare"))return {decision:"execute"};return null;
  }} as unknown as ActionCtx;
  let externalSends=0;
  mock.method(globalThis,"fetch",async(url:unknown,init?:RequestInit)=>{
    if(url==="https://storage.example/audio")return new Response(new Uint8Array([1,2,3]),{headers:{"Content-Type":"audio/mpeg"}});
    externalSends++;assert.match(String(url),/\/sendVoice$/);assert.ok(init?.body instanceof FormData);
    const form=init.body;assert.equal(form.get("caption"),"Writer");assert.equal(form.get("chat_id"),"42");
    const audio=form.get("voice");assert.ok(audio instanceof Blob);assert.deepEqual([...new Uint8Array(await audio.arrayBuffer())],[1,2,3]);
    return new Response(JSON.stringify({ok:true,result:{message_id:18}}));
  });
  try {
    await (send as unknown as {_handler:(ctx:ActionCtx,args:{deliveryId:string})=>Promise<null>})._handler(ctx,{deliveryId:"delivery"});
    assert.equal(externalSends,1);assert.equal(calls.find(call=>call.name.endsWith(":settle"))?.args.status,"sent");
    assert.equal(calls.filter(call=>call.name.endsWith(":markDispatched")).length,1);
  } finally {mock.restoreAll();if(old===undefined)delete process.env.TELEGRAM_BOT_TOKEN;else process.env.TELEGRAM_BOT_TOKEN=old;}
});
