import { internal } from "../../_generated/api";
import type { ActionCtx } from "../../_generated/server";
import { normalizeTelegramUpdate } from "./payload";

export async function telegramWebhook(ctx:ActionCtx,request:Request):Promise<Response> {
  const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret || request.headers.get("X-Telegram-Bot-Api-Secret-Token")!==secret) return new Response("Unauthorized",{status:401});
  if (process.env.TELEGRAM_INGRESS_PAUSED==="true") return new Response("Ingress paused",{status:503});
  let update:ReturnType<typeof normalizeTelegramUpdate>;
  try {update=normalizeTelegramUpdate(await readTelegramBody(request));} catch (error) {return new Response("Invalid update",{status:error instanceof RangeError ? 413 : 400});}
  if (!update) return new Response("Ignored");
  const botId=process.env.TELEGRAM_BOT_ID;
  if (!botId) return new Response("Not configured",{status:503});
  await ctx.runMutation(internal.channels.telegram.ingress.receive,{botId,...update});
  return new Response("Accepted");
}

async function readTelegramBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing update body");
  // Transport envelope bound, comfortably above Telegram private text payloads.
  const limit = 1024 * 1024; const decoder = new TextDecoder();
  let bytes = 0; let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) {await reader.cancel(); throw new RangeError("Update envelope too large");}
      text += decoder.decode(part.value, {stream: true});
    }
    return JSON.parse(text + decoder.decode());
  } finally {reader.releaseLock();}
}
