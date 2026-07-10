import { Id } from "../_generated/dataModel";

interface StoredAttachment {
  type: string;
  url?: string;
  storageId?: Id<"_storage">;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface MessageWithStoredAttachments {
  _id: Id<"messages">;
  role: string;
  content: string;
  attachments?: StoredAttachment[];
  [key: string]: unknown;
}

export interface AttachmentStorageContext {
  storage: {
    store: (blob: Blob) => Promise<Id<"_storage">>;
    get: (storageId: Id<"_storage">) => Promise<Blob | null>;
    getUrl: (storageId: Id<"_storage">) => Promise<string | null>;
    delete?: (storageId: Id<"_storage">) => Promise<void>;
  };
}

interface HydrateAttachmentsForRequestOptions {
  inlineStoredNonImageAttachments?: boolean;
  maxTotalStoredNonImageBytes?: number;
}

function encodeBytesToBase64(bytes: Uint8Array): string {
  const runtimeBuffer = (globalThis as {
    Buffer?: {
      from: (value: Uint8Array) => { toString: (encoding: string) => string };
    };
  }).Buffer;
  if (runtimeBuffer) {
    return runtimeBuffer.from(bytes).toString("base64");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function hydrateAttachmentsForRequest(
  ctx: AttachmentStorageContext,
  messages: MessageWithStoredAttachments[],
  options: HydrateAttachmentsForRequestOptions = {},
): Promise<MessageWithStoredAttachments[]> {
  const inlineStoredNonImageAttachments = options.inlineStoredNonImageAttachments !== false;
  const byteBudget = options.maxTotalStoredNonImageBytes == null
    ? undefined
    : { remaining: Math.max(0, options.maxTotalStoredNonImageBytes) };
  const hydrateMessage = async (
    message: MessageWithStoredAttachments,
  ): Promise<MessageWithStoredAttachments> => {
    if (!message.attachments || message.attachments.length === 0) {
      return message;
    }

    const hydrateAttachment = async (
      attachment: StoredAttachment,
    ): Promise<StoredAttachment> => {
      if (!attachment.storageId) return attachment;

      if (attachment.type === "image") {
        const imageUrl = await ctx.storage.getUrl(attachment.storageId);
        return imageUrl ? { ...attachment, url: imageUrl } : attachment;
      }

      if (!inlineStoredNonImageAttachments) return attachment;

      try {
        const stored = await ctx.storage.get(attachment.storageId);
        if (!stored) return attachment;
        if (byteBudget && stored.size > byteBudget.remaining) return attachment;
        if (byteBudget) byteBudget.remaining -= stored.size;
        const bytes = new Uint8Array(await stored.arrayBuffer());
        const mimeType = attachment.mimeType ?? "application/octet-stream";
        return {
          ...attachment,
          url: `data:${mimeType};base64,${encodeBytesToBase64(bytes)}`,
          sizeBytes: bytes.length,
        };
      } catch {
        return attachment;
      }
    };
    const attachments = byteBudget
      ? await sequentialMap(message.attachments, hydrateAttachment)
      : await Promise.all(message.attachments.map(hydrateAttachment));

    return { ...message, attachments };
  };

  if (!byteBudget) return await Promise.all(messages.map(hydrateMessage));
  return (await sequentialMap([...messages].reverse(), hydrateMessage)).reverse();
}

async function sequentialMap<Input, Output>(
  values: Input[],
  transform: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const output: Output[] = [];
  for (const value of values) output.push(await transform(value));
  return output;
}
