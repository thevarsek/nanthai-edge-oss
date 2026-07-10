import type { MessageWithStoredAttachments } from "../chat/action_image_helpers";

export const MAX_ADVISOR_INLINE_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Convert stored documents into Responses API file inputs while bounding the
 * amount that will be base64-expanded inside the Advisor action.
 */
export function prepareAdvisorAttachmentMessages(
  messages: MessageWithStoredAttachments[],
  allowFiles: boolean,
): MessageWithStoredAttachments[] {
  let remainingFileBytes = MAX_ADVISOR_INLINE_FILE_BYTES;

  return [...messages].reverse().map((message) => {
    if (!message.attachments || message.attachments.length === 0) return message;
    const attachments = message.attachments.flatMap((attachment) => {
      if (attachment.type === "image") return [attachment];
      if (!allowFiles || attachment.type === "audio") return [];

      if (attachment.storageId) {
        const sizeBytes = attachment.sizeBytes;
        if (
          typeof sizeBytes !== "number" ||
          !Number.isFinite(sizeBytes) ||
          sizeBytes <= 0 ||
          sizeBytes > remainingFileBytes
        ) {
          return [];
        }
        remainingFileBytes -= sizeBytes;
      }

      return [{
        ...attachment,
        type: attachment.type === "document" ? "file" : attachment.type,
      }];
    });
    return { ...message, attachments };
  }).reverse();
}
