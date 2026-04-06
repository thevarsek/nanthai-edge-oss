import { Id } from "../_generated/dataModel";
import { QueryCtx } from "../_generated/server";

export async function getAuthorizedChat(
  ctx: QueryCtx,
  chatId: Id<"chats">,
  userId: string,
) {
  const chat = await ctx.db.get(chatId);
  if (!chat || chat.userId !== userId) {
    return null;
  }
  return chat;
}

export async function getAuthorizedMessage(
  ctx: QueryCtx,
  messageId: Id<"messages">,
  userId: string,
) {
  const message = await ctx.db.get(messageId);
  if (!message) {
    return null;
  }
  const chat = await ctx.db.get(message.chatId);
  if (!chat || chat.userId !== userId) {
    return null;
  }
  return message;
}

async function refreshAttachmentUrls(
  ctx: QueryCtx,
  attachments: Array<{
    type: string;
    url: string;
    storageId?: Id<"_storage">;
    name?: string;
    mimeType?: string;
    sizeBytes?: number;
  }>,
) {
  return await Promise.all(
    attachments.map(async (attachment) => {
      if (!attachment.storageId) {
        return attachment;
      }
      const refreshedUrl = await ctx.storage.getUrl(attachment.storageId);
      if (!refreshedUrl) {
        return attachment;
      }
      return { ...attachment, url: refreshedUrl };
    }),
  );
}

export async function withRefreshedAttachmentUrls<
  T extends { attachments?: Array<any> },
>(
  ctx: QueryCtx,
  message: T,
): Promise<T> {
  if (!message.attachments || message.attachments.length === 0) {
    return message;
  }
  const attachments = await refreshAttachmentUrls(ctx, message.attachments);
  return { ...message, attachments };
}
