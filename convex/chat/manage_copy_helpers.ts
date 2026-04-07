import { ConvexError } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { MutationCtx } from "../_generated/server";
import {
  buildCopiedMessageInsert,
  CopiedMessageSummary,
} from "./manage_helpers";

export interface CopiedChatGraph {
  idMap: Map<string, string>;
  copiedMessages: CopiedMessageSummary[];
}

export async function loadMessagesForFork(
  ctx: MutationCtx,
  chatId: Id<"chats">,
  atMessageId: Id<"messages">,
): Promise<Doc<"messages">[]> {
  const allMessages = await loadAllChatMessages(ctx, chatId);

  const forkIdx = allMessages.findIndex((message) => message._id === atMessageId);
  if (forkIdx === -1) {
    throw new ConvexError({ code: "NOT_FOUND" as const, message: "Fork message not found in chat" });
  }

  return allMessages.slice(0, forkIdx + 1);
}

export async function loadAllChatMessages(
  ctx: MutationCtx,
  chatId: Id<"chats">,
): Promise<Doc<"messages">[]> {
  return await ctx.db
    .query("messages")
    .withIndex("by_chat", (q) => q.eq("chatId", chatId))
    .order("asc")
    .collect();
}

export async function copyMessagesWithIdMap(
  ctx: MutationCtx,
  messagesToCopy: Doc<"messages">[],
  newChatId: Id<"chats">,
): Promise<CopiedChatGraph> {
  const idMap = new Map<string, string>();
  const copiedMessages: CopiedMessageSummary[] = [];

  for (const msg of messagesToCopy) {
    const newParentIds = msg.parentMessageIds
      .map((parentId: Id<"messages">) => idMap.get(parentId as string))
      .filter(Boolean) as Id<"messages">[];

    const newMsgId = await ctx.db.insert(
      "messages",
      buildCopiedMessageInsert(msg, newChatId, newParentIds),
    );

    idMap.set(msg._id as string, newMsgId as string);
    copiedMessages.push({
      messageId: newMsgId,
      createdAt: msg.createdAt,
      content: msg.content,
    });
  }

  return { idMap, copiedMessages };
}

export async function copyChatParticipants(
  ctx: MutationCtx,
  sourceChatId: Id<"chats">,
  newChatId: Id<"chats">,
): Promise<void> {
  const participants = await ctx.db
    .query("chatParticipants")
    .withIndex("by_chat", (q) => q.eq("chatId", sourceChatId))
    .collect();

  for (const participant of participants) {
    await ctx.db.insert("chatParticipants", {
      chatId: newChatId,
      userId: participant.userId,
      modelId: participant.modelId,
      personaId: participant.personaId,
      personaName: participant.personaName,
      personaEmoji: participant.personaEmoji,
      personaAvatarImageUrl: participant.personaAvatarImageUrl,
      sortOrder: participant.sortOrder,
      createdAt: participant.createdAt,
    });
  }
}

export async function copyNodePositions(
  ctx: MutationCtx,
  sourceChatId: Id<"chats">,
  newChatId: Id<"chats">,
  userId: string,
  idMap: Map<string, string>,
): Promise<void> {
  const positions = await ctx.db
    .query("nodePositions")
    .withIndex("by_chat", (q) => q.eq("chatId", sourceChatId))
    .collect();

  for (const position of positions) {
    const mappedMessageId = idMap.get(position.messageId as string);
    if (!mappedMessageId) continue;

    await ctx.db.insert("nodePositions", {
      userId,
      chatId: newChatId,
      messageId: mappedMessageId as Id<"messages">,
      x: position.x,
      y: position.y,
      width: position.width,
      height: position.height,
    });
  }
}
