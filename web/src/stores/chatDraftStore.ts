// In-memory per-chat composer draft store.
//
// Survives navigation within a session (module-scoped Map) but not a page
// reload. Keyed by chatId. Matches the iOS `DraftStore` and Android
// `ChatDraftRepository` so composer state behaves consistently across
// platforms: typing in a chat, navigating away, and coming back restores
// both text and staged attachments. Cleared per-chat after a successful send.
//
// Kept dependency-free (plain Map + subscriber set) — no Zustand, no Context.
// The only consumer is MessageInput, which reads once on mount and writes
// through on every change.

import type { AttachmentPreview } from "@/components/chat/MessageInput.attachments.types";

export interface ChatDraft {
  text: string;
  attachments: AttachmentPreview[];
}

const drafts = new Map<string, ChatDraft>();

function isEmpty(draft: ChatDraft): boolean {
  return draft.text.length === 0 && draft.attachments.length === 0;
}

export function getChatDraft(chatId: string): ChatDraft {
  const draft = drafts.get(chatId);
  return draft ? cloneDraft(draft) : { text: "", attachments: [] };
}

export function setChatDraft(chatId: string, draft: ChatDraft): void {
  if (isEmpty(draft)) {
    drafts.delete(chatId);
  } else {
    drafts.set(chatId, cloneDraft(draft));
  }
}

export function clearChatDraft(chatId: string): void {
  drafts.delete(chatId);
}

function cloneDraft(draft: ChatDraft): ChatDraft {
  return {
    text: draft.text,
    attachments: draft.attachments.map((attachment) => ({ ...attachment })),
  };
}
