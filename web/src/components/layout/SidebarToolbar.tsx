import { Search, SquarePen, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  EditModeBar,
  FilterMenu,
  type FolderRow,
} from "@/components/chat-list/SidebarSections";

interface SidebarToolbarProps {
  folders: FolderRow[];
  isCreatingChat: boolean;
  isEditMode: boolean;
  onDeleteSelected: () => void;
  onDoneEditing: () => void;
  onManageFolders: () => void;
  onMoveSelected: (folderId: string | undefined) => void;
  onNewChat: () => void;
  onSearchChange: (value: string) => void;
  onSelectAll: () => void;
  onSelectFolder: (folderId: string) => void;
  onToggleScheduled: () => void;
  searchQuery: string;
  selectedCount: number;
  selectedFolderId: string | null;
  showScheduledOnly: boolean;
}

export function SidebarToolbar({
  folders,
  isCreatingChat,
  isEditMode,
  onDeleteSelected,
  onDoneEditing,
  onManageFolders,
  onMoveSelected,
  onNewChat,
  onSearchChange,
  onSelectAll,
  onSelectFolder,
  onToggleScheduled,
  searchQuery,
  selectedCount,
  selectedFolderId,
  showScheduledOnly,
}: SidebarToolbarProps) {
  const { t } = useTranslation();

  if (isEditMode) {
    return (
      <EditModeBar
        selectedCount={selectedCount}
        folders={folders}
        onMoveToFolder={onMoveSelected}
        onDelete={onDeleteSelected}
        onDone={onDoneEditing}
      />
    );
  }

  return (
    <div className="flex-shrink-0 border-t border-border px-3 py-2 flex items-center gap-2">
      <FilterMenu
        folders={folders}
        selectedFolderId={selectedFolderId}
        showScheduledOnly={showScheduledOnly}
        onSelectAll={onSelectAll}
        onToggleScheduled={onToggleScheduled}
        onSelectFolder={onSelectFolder}
        onManageFolders={onManageFolders}
      />
      <div className="relative flex-1">
        <Search
          size={14}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
        />
        <input
          id="chat-search-input"
          type="search"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("search_placeholder")}
          className="w-full bg-input border border-transparent rounded-xl pl-8 pr-7 py-1.5 text-sm placeholder:text-muted outline-none focus:border-primary/30 transition-colors"
        />
        {searchQuery ? (
          <button
            type="button"
            aria-label={t("clear_search")}
            onClick={() => onSearchChange("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
      <button
        onClick={onNewChat}
        disabled={isCreatingChat}
        aria-busy={isCreatingChat}
        aria-label={t("new_chat_shortcut")}
        className="p-2 rounded-xl hover:bg-primary/12 text-primary active:scale-95 transition-all flex-shrink-0 disabled:pointer-events-none disabled:opacity-60"
        title={t("new_chat_shortcut")}
      >
        <SquarePen size={18} />
      </button>
    </div>
  );
}
