import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import { attachmentTypeForMime } from "@/components/chat/MessageInput.attachments.utils";
import { hasDocumentAttachmentPayload } from "@/lib/documentEvents";
import type { ChatAttachment, ChatVideoRole } from "@/routes/ChatPage.sendFlow";

export interface KnowledgeBaseAttachmentFile {
  storageId: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  driveFileId?: string;
  lastRefreshedAt?: number;
}

export function buildKnowledgeBaseAttachments(
  files: KnowledgeBaseAttachmentFile[] | undefined,
): ChatAttachment[] {
  return (files ?? []).map((file) => ({
    type: file.mimeType ? attachmentTypeForMime(file.mimeType) : "document",
    storageId: file.storageId as Id<"_storage">,
    name: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    driveFileId: file.driveFileId,
    lastRefreshedAt: file.lastRefreshedAt,
  }));
}

export function pruneVideoRoleOverrides(
  overrides: Record<string, ChatVideoRole>,
  attachments: ChatAttachment[],
): Record<string, ChatVideoRole> {
  const selectedStorageIds = new Set(attachments.flatMap((attachment) => (
    attachment.storageId ? [attachment.storageId as string] : []
  )));
  const keptEntries = Object.entries(overrides).filter(([storageId]) => selectedStorageIds.has(storageId));
  if (keptEntries.length === Object.keys(overrides).length) {
    return overrides;
  }
  return Object.fromEntries(keptEntries);
}

export function attachmentsWithVideoRoles(args: {
  attachments: ChatAttachment[];
  roleOverrides: Record<string, ChatVideoRole>;
  isVideoMode: boolean;
  supportsFrameImages: boolean;
}): ChatAttachment[] {
  const { attachments, roleOverrides, isVideoMode, supportsFrameImages } = args;

  if (!isVideoMode || !supportsFrameImages) {
    return attachments.map((attachment) => ({
      ...attachment,
      videoRole: roleOverrides[(attachment.storageId ?? "") as string] ?? attachment.videoRole,
    }));
  }

  let imageIndex = 0;
  return attachments.map((attachment) => {
    if (attachment.type !== "image") return attachment;
    const storageId = (attachment.storageId ?? "") as string;
    const fallback: ChatVideoRole =
      imageIndex === 0 ? "first_frame" : imageIndex === 1 ? "last_frame" : "reference";
    imageIndex += 1;
    return { ...attachment, videoRole: roleOverrides[storageId] ?? fallback };
  });
}

export function generatedDocumentSuggestion(messages: Message[]): ChatAttachment | undefined {
  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant") continue;
    const event = [...(message.documentEvents ?? [])].reverse().find((candidate) =>
      hasDocumentAttachmentPayload(candidate)
    );
    if (!event || !hasDocumentAttachmentPayload(event)) continue;
    return {
      storageId: event.storageId as Id<"_storage">,
      name: event.filename,
      type: attachmentTypeForMime(event.mimeType),
      mimeType: event.mimeType,
    };
  }
  return undefined;
}
