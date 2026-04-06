import { Id } from "../_generated/dataModel";
import { QueryCtx } from "../_generated/server";
import { optionalAuth } from "../lib/auth";
import { getAuthorizedChat, getAuthorizedMessage } from "./query_helpers";
import {
  getStreamingMessageByMessageId,
  mergeStreamingMessageRecords,
} from "./streaming_state";

export interface ListStreamingMessagesArgs extends Record<string, unknown> {
  chatId: Id<"chats">;
}

export async function listStreamingMessagesHandler(
  ctx: QueryCtx,
  args: ListStreamingMessagesArgs,
): Promise<
  Array<{
    messageId: Id<"messages">;
    content: string;
    reasoning?: string;
    status: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      arguments: string;
    }>;
  }>
> {
  const auth = await optionalAuth(ctx);
  if (!auth) return [];

  const chat = await getAuthorizedChat(ctx, args.chatId, auth.userId);
  if (!chat) return [];

  const records = await ctx.db
    .query("streamingMessages")
    .withIndex("by_chat", (q) => q.eq("chatId", args.chatId))
    .collect();

  const dedupedByMessageId = new Map<string, typeof records>();
  for (const record of records) {
    const key = String(record.messageId);
    const existing = dedupedByMessageId.get(key) ?? [];
    existing.push(record);
    dedupedByMessageId.set(key, existing);
  }

  return [...dedupedByMessageId.values()]
    .map((group) => mergeStreamingMessageRecords(group))
    .filter((record): record is NonNullable<typeof record> => record !== null)
    .map((record) => ({
      messageId: record.messageId,
      content: record.content,
      reasoning: record.reasoning,
      status: record.status,
      toolCalls: record.toolCalls,
    }));
}

export interface GetStreamingContentArgs extends Record<string, unknown> {
  messageId: Id<"messages">;
}

export async function getStreamingContentHandler(
  ctx: QueryCtx,
  args: GetStreamingContentArgs,
): Promise<
  | {
      content: string;
      reasoning?: string;
      status: string;
      modelId?: string;
      participantName?: string;
      toolCalls?: Array<{
        id: string;
        name: string;
        arguments: string;
      }>;
      usage?: unknown;
    }
  | null
> {
  const auth = await optionalAuth(ctx);
  if (!auth) return null;

  const msg = await getAuthorizedMessage(ctx, args.messageId, auth.userId);
  if (!msg) return null;

  const streaming = await getStreamingMessageByMessageId(ctx, args.messageId);
  if (streaming) {
    return {
      content: streaming.content,
      reasoning: streaming.reasoning,
      status: streaming.status,
      modelId: msg.modelId,
      participantName: msg.participantName,
      toolCalls: streaming.toolCalls,
      usage: msg.usage,
    };
  }

  return {
    content: msg.content,
    reasoning: msg.reasoning,
    status: msg.status,
    modelId: msg.modelId,
    participantName: msg.participantName,
    toolCalls: msg.toolCalls,
    usage: msg.usage,
  };
}
