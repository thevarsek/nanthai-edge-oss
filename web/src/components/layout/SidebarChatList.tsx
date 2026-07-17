import { Loader2, MessageSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RefObject } from "react";
import type { Id } from "@convex/_generated/dataModel";
import {
  PinnedSection,
  TimeGroupSection,
  type ChatRow,
  type FolderRow,
} from "@/components/chat-list/SidebarSections";
import { EmptyState } from "@/components/shared/EmptyState";
import type { TimeGroup } from "@/lib/utils";

const TIME_GROUP_ORDER: TimeGroup[] = [
  "Today",
  "Yesterday",
  "Last 7 Days",
  "Last 30 Days",
  "Older",
];

interface SidebarSectionActions {
  checkedIds: Set<string>;
  isEditMode: boolean;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onEnterEditMode: () => void;
  onMoveToFolder: (id: string, folderId: string | undefined) => void;
  onPin: (id: string, isPinned: boolean) => void;
  onRename: (id: string) => void;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string) => void;
  selectedChatId: string | null;
}

interface SidebarChatListProps {
  chats: ChatRow[];
  folders: FolderRow[];
  hasMoreChats: boolean;
  isInitialLoad: boolean;
  isPinnedReorderMode: boolean;
  isSearching: boolean;
  onReorderPinned: (orderedIds: Id<"chats">[]) => void;
  onTogglePinnedReorder: () => void;
  pinnedChats: ChatRow[];
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  sectionActions: SidebarSectionActions;
  sentinelRef: RefObject<HTMLDivElement | null>;
  showScheduledOnly: boolean;
  timeGroups: Partial<Record<TimeGroup, ChatRow[]>>;
  unpinnedChats: ChatRow[];
}

export function SidebarChatList({
  chats,
  folders,
  hasMoreChats,
  isInitialLoad,
  isPinnedReorderMode,
  isSearching,
  onReorderPinned,
  onTogglePinnedReorder,
  pinnedChats,
  scrollContainerRef,
  sectionActions,
  sentinelRef,
  showScheduledOnly,
  timeGroups,
  unpinnedChats,
}: SidebarChatListProps) {
  const { t } = useTranslation();
  const sectionProps = { ...sectionActions, folders };

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-1.5 pb-2 min-h-0">
      {isInitialLoad ? (
        <div className="flex flex-col gap-2 px-2 pt-2">
          {[65, 45, 72, 55, 38, 60].map((width, index) => (
            <div
              key={index}
              className="h-14 rounded-xl bg-foreground/4 animate-pulse"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      ) : chats.length === 0 ? (
        <EmptyState
          icon={<MessageSquare size={28} />}
          title={
            isSearching
              ? t("no_chats_match_search")
              : showScheduledOnly
                ? t("no_scheduled_chats")
                : t("no_chats_yet")
          }
          className="h-40"
        />
      ) : (
        <div className="flex flex-col gap-1">
          {pinnedChats.length > 0 ? (
            <PinnedSection
              {...sectionProps}
              chats={pinnedChats}
              isReorderMode={isPinnedReorderMode}
              onToggleReorder={onTogglePinnedReorder}
              onReorderPinned={onReorderPinned}
            />
          ) : null}
          {unpinnedChats.length > 0 && pinnedChats.length > 0 ? (
            <div className="px-3 py-1">
              <span className="text-xs font-semibold text-foreground/40 uppercase tracking-wide">
                {t("chats")}
              </span>
            </div>
          ) : null}
          {TIME_GROUP_ORDER.map((group) => {
            const groupChats = timeGroups[group];
            if (!groupChats?.length) return null;
            return (
              <TimeGroupSection
                key={group}
                {...sectionProps}
                label={group}
                chats={groupChats}
              />
            );
          })}
          {hasMoreChats ? (
            <div ref={sentinelRef} className="flex items-center justify-center py-3">
              <Loader2 size={16} className="animate-spin text-foreground/30" />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
