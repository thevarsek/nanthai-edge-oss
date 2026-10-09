import { z } from "zod";

const sender=z.object({id:z.number().int(),is_bot:z.boolean().optional(),first_name:z.string().optional(),last_name:z.string().optional()});
const media=z.object({file_id:z.string(),file_size:z.number().optional(),file_name:z.string().optional(),mime_type:z.string().optional(),duration:z.number().optional(),width:z.number().optional(),height:z.number().optional()});
const message=z.object({message_id:z.number().int(),from:sender.optional(),chat:z.object({id:z.number().int(),type:z.string()}),
  text:z.string().optional(),caption:z.string().optional(),photo:z.array(media).optional(),document:media.optional(),video:media.optional(),audio:media.optional(),voice:media.optional(),video_note:media.optional(),reply_to_message:z.object({message_id:z.number().int()}).optional()});
export const telegramUpdateSchema=z.object({update_id:z.number().int(),message:message.optional(),edited_message:message.optional()});
export function normalizeTelegramUpdate(value:unknown) {
  const update=telegramUpdateSchema.parse(value); const item=update.message ?? update.edited_message;
  if (!item || !item.from || item.from.is_bot || item.chat.type!=="private") return null;
  const photo=item.photo?.slice().sort((a,b)=>(a.width ?? 0)*(a.height ?? 0)-(b.width ?? 0)*(b.height ?? 0)).at(-1);
  const selected = photo ? {value: photo, type: "image" as const, name: "Telegram photo.jpg", mime: "image/jpeg"}
    : item.voice ? {value: item.voice, type: "voice" as const, name: "Voice message.ogg", mime: "audio/ogg"}
    : item.audio ? {value: item.audio, type: "audio" as const, name: "Audio message.mp3", mime: "audio/mpeg"}
    : item.document ? {value: item.document, type: "document" as const, name: "Telegram document", mime: "application/octet-stream"}
    : item.video || item.video_note ? {value: (item.video ?? item.video_note)!, type: "video" as const, name: "Telegram video.mp4", mime: "video/mp4"} : null;
  const files = selected ? [{fileId: selected.value.file_id, type: selected.type, name: selected.value.file_name ?? selected.name,
    mimeType: selected.value.mime_type ?? selected.mime, sizeBytes: selected.value.file_size, durationMs: selected.value.duration === undefined ? undefined : selected.value.duration*1000}] : undefined;
  return {files, updateId:update.update_id,externalUserId:String(item.from.id),externalChatId:String(item.chat.id),
    externalMessageId:item.message_id,text:item.text ?? item.caption ?? "",kind:update.edited_message?"edit":item.text?"text":"media",
    replyToId:item.reply_to_message?.message_id,claimantName:[item.from.first_name,item.from.last_name].filter(Boolean).join(" ")};
}
export function telegramParts(text:string):string[] {
  // Plain text keeps code/markup literal, so every part is formatting-safe.
  const chars=Array.from(text); const parts:string[]=[];
  for (let i=0;i<chars.length;i+=3500) parts.push(chars.slice(i,i+3500).join(""));
  return parts.length>1?parts.map((part,i)=>`[${i+1}/${parts.length}]\n${part}`):parts;
}
export function telegramPublishedText(text:string) {
  return text.replace(/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s)\]`]+/g,"[local file; open NanthAI]");
}
export function appChatUrl(chatId?:string) {
  const origin=process.env.NANTHAI_WEB_ORIGIN ?? "https://nanthai.tech";
  return `${origin.replace(/\/$/,"")}/app/${chatId?`chat/${chatId}`:"settings#telegram"}`;
}

export function telegramAppAction(label: string, chatId?: string) {
  if (!process.env.NANTHAI_WEB_ORIGIN) return label;
  const url = appChatUrl(chatId);
  const host = new URL(url).hostname;
  // Local origins open the recipient's device rather than this DEV application.
  const local = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".lan")
    || host === "[::1]" || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  return local ? label : `${label}: ${url}`;
}
