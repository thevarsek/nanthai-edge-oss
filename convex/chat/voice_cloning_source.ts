import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";

export async function getVoiceCloningSource(ctx: QueryCtx, messageId: Id<"messages">, userId: string) {
  const assistant = await ctx.db.get(messageId);
  if (!assistant || assistant.userId !== userId) return null;
  const chat = await ctx.db.get(assistant.chatId);
  if (!chat || chat.userId !== userId || chat.isDeleting) return null;
  const exchange = assistant.collaborationExchangeId ? await ctx.db.get(assistant.collaborationExchangeId) : null;
  const parents = exchange?.initiatingMessageId ? [exchange.initiatingMessageId] : assistant.parentMessageIds ?? [];
  for (const parentId of parents) {
    const source = await ctx.db.get(parentId);
    if (source?.role === "user" && source.userId === userId && source.chatId === assistant.chatId && source.voiceCloning) return source;
  }
  return null;
}
