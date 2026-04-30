export type SidebarSearchChat = {
  title?: string;
  lastMessagePreview?: string;
  folderName?: string;
};

export function sidebarChatMatchesSearch(chat: SidebarSearchChat, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  return (
    (chat.title ?? "New Chat").toLowerCase().includes(normalized) ||
    (chat.lastMessagePreview ?? "").toLowerCase().includes(normalized) ||
    (chat.folderName ?? "").toLowerCase().includes(normalized)
  );
}
