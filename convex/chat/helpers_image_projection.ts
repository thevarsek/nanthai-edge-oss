import type { Id } from "../_generated/dataModel";
import type { ContentPart } from "../lib/openrouter";
import { splitMessageAttachmentParts } from "./helpers_attachment_utils";
import type { ContextMessage } from "./helpers_types";

export interface SelectedParentImageContext {
  partsByUserId: Map<string, ContentPart[]>;
  assistantMessageIds: Set<string>;
  sourceMessageIds: Set<string>;
}

interface ImageBearingMessage {
  message: ContextMessage;
  parts: ContentPart[];
}

function nearestSelectedImages(
  startId: Id<"messages">,
  messagesById: Map<Id<"messages">, ContextMessage>,
): ImageBearingMessage[] {
  const visited = new Set<string>();
  let frontier = [startId];

  while (frontier.length > 0) {
    const images: ImageBearingMessage[] = [];
    const next: Id<"messages">[] = [];
    for (const messageId of frontier) {
      if (visited.has(messageId)) continue;
      visited.add(messageId);
      const message = messagesById.get(messageId);
      if (!message) continue;

      if (message.status !== "failed" && message.status !== "cancelled") {
        const { imageParts } = splitMessageAttachmentParts(message);
        if (imageParts.length > 0) {
          images.push({ message, parts: imageParts });
          continue;
        }
      }
      next.push(...message.parentMessageIds);
    }
    if (images.length > 0) return images;
    frontier = next;
  }

  return [];
}

/** Pin explicitly selected parent images to the current user turn. */
export function selectedParentImageContext(
  excludedMessage: ContextMessage,
  messagesById: Map<Id<"messages">, ContextMessage>,
): SelectedParentImageContext {
  const partsByUserId = new Map<string, ContentPart[]>();
  const assistantMessageIds = new Set<string>();
  const sourceMessageIds = new Set<string>();

  for (const parentId of excludedMessage.parentMessageIds) {
    const currentUser = messagesById.get(parentId);
    if (!currentUser || currentUser.role !== "user") continue;

    const selectedParts: ContentPart[] = [];
    const selectedMessageIds = new Set<string>();
    for (const selectedParentId of currentUser.parentMessageIds) {
      for (const selected of nearestSelectedImages(selectedParentId, messagesById)) {
        if (selectedMessageIds.has(selected.message._id)) continue;
        selectedMessageIds.add(selected.message._id);
        sourceMessageIds.add(selected.message._id);
        selectedParts.push(...selected.parts);
        if (selected.message.role === "assistant") {
          assistantMessageIds.add(selected.message._id);
        }
      }
    }
    if (selectedParts.length > 0) {
      partsByUserId.set(currentUser._id, selectedParts);
    }
  }

  return { partsByUserId, assistantMessageIds, sourceMessageIds };
}
