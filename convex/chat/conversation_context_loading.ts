import type { PaginationResult } from "convex/server";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ContextMessage } from "./helpers_types";
import { conversationSourceDigest, eligibleConversationMessages } from "./conversation_context_policy";

export async function loadConversationMessages(ctx: ActionCtx, chatId: Id<"chats">, userId: string): Promise<Doc<"messages">[]> {
  const messages: Doc<"messages">[] = []; let cursor: string | null = null;
  do {
    const page: PaginationResult<Doc<"messages">> = await ctx.runQuery(internal.chat.conversation_context_queries.pageMessages, {chatId,userId,cursor});
    messages.push(...page.page); cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
  return messages;
}
export async function loadSummarySources(ctx: ActionCtx, summaryId: Id<"conversationSummaries">): Promise<Id<"messages">[]> {
  const ids: Id<"messages">[] = []; let cursor: string | null = null;
  do {
    const page: PaginationResult<Doc<"conversationSummarySources">> = await ctx.runQuery(internal.chat.conversation_context_queries.sourcePage, {summaryId,cursor});
    ids.push(...page.page.flatMap(row => row.messageIds)); cursor = page.isDone ? null : page.continueCursor;
  } while (cursor);
  return ids;
}
export async function validSummary(ctx: ActionCtx, head: Doc<"conversationSummaries"> | null, messages: ContextMessage[]) {
  if (!head) return null;
  const ids = await loadSummarySources(ctx, head._id);
  const prefix = messages.slice(0, head.coverageCount);
  if (prefix.length !== ids.length || prefix.some((m,i) => String(m._id) !== String(ids[i]))) return null;
  if (await conversationSourceDigest(prefix) !== head.sourceDigest) return null;
  return { ...head, coveredIds: ids };
}
export async function capturedConversationSummary(ctx: ActionCtx, assistantId: Id<"messages">, allMessages: ContextMessage[], expand = true) {
  const message = allMessages.find(row => String(row._id) === String(assistantId));
  if (!message?.conversationSummaryId) return null;
  const head = await ctx.runQuery(internal.chat.conversation_context_queries.summary, {summaryId: message.conversationSummaryId});
  if (!head || head.chatId !== message.chatId || head.userId !== message.userId) throw new Error("SUMMARY_NOT_OWNED");
  const eligible = eligibleConversationMessages(allMessages, String(assistantId), expand);
  const valid = await validSummary(ctx, head, eligible);
  if (!valid) throw new Error("Conversation history changed after preparation. Retry this turn to rebuild its context.");
  return valid;
}
