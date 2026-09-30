import { internalQuery, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";

export async function getDecisionContextHandler(ctx: QueryCtx, args: { chatId: Id<"chats">; userId: string; parentMessageIds?: Id<"messages">[] }) {
    const chat = await ctx.db.get(args.chatId);
    if (!chat || chat.userId !== args.userId || chat.isDeleting) return null;
    const starts = args.parentMessageIds?.length ? args.parentMessageIds : chat.activeBranchLeafId ? [chat.activeBranchLeafId] : [];
    if (!starts.length) return null;
    const messages: Array<{ id: Id<"messages">; role: string; content: string; speaker: string; createdAt: number }> = [];
    const seen = new Set<string>();
    const pending = [...starts];
    // Match the current branch only. Long-thread continuity is owned by M59.
    for (let i = 0; i < 64 && pending.length; i += 1) {
      const current = pending.shift();
      if (!current || seen.has(String(current))) continue;
      seen.add(String(current));
      const message: Doc<"messages"> | null = await ctx.db.get(current);
      if (!message || message.userId !== args.userId || message.chatId !== args.chatId) continue;
      if (message.status === "completed" && (message.role === "user" || message.role === "assistant") && message.content.trim()) {
        messages.push({ id: message._id, role: message.role, content: message.content.slice(0, 2_000), speaker: message.participantName ?? (message.chatParticipantId ? String(message.chatParticipantId) : message.modelId ?? message.role), createdAt: message.createdAt });
        if (message.role === "user") continue;
      }
      pending.push(...message.parentMessageIds);
    }
    const question = messages.filter((message) => message.role === "user").sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!question) return null;
    return { question: question.content, messageId: question.id, messages: messages.filter((message) => message.createdAt >= question.createdAt).sort((a, b) => a.createdAt - b.createdAt) };
}

export const getDecisionContext = internalQuery({
  args: { chatId: v.id("chats"), userId: v.string(), parentMessageIds: v.optional(v.array(v.id("messages"))) },
  handler: getDecisionContextHandler,
});
