import { PanelLeftClose, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { FavoritesStrip } from "@/components/chat-list/FavoritesStrip";
import {
  FolderManagerDialog,
  NewFolderDialog,
  RenameChatDialog,
} from "@/components/chat-list/SidebarSections";
import { BrandWordmark } from "@/components/shared/BrandWordmark";
import { SidebarChatList } from "./SidebarChatList";
import { SidebarToolbar } from "./SidebarToolbar";
import { useSidebarActions } from "./useSidebarActions";
import { useSidebarChats } from "./useSidebarChats";

interface SidebarProps {
  onToggleCollapse?: () => void;
}

export function Sidebar({ onToggleCollapse }: SidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const chatData = useSidebarChats();
  const actions = useSidebarActions({
    activeFolderId: chatData.activeFolderId,
    chats: chatData.chats,
    clearDeletedFolder: chatData.clearDeletedFolder,
  });

  return (
    <>
      <div className="w-full h-full bg-background md:bg-muted border-r-0 md:border md:border-border/70 md:rounded-[2rem] md:shadow-lg dark:md:shadow-2xl flex-shrink-0 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 flex items-center justify-between px-4 pt-5 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            {onToggleCollapse ? (
              <button
                onClick={onToggleCollapse}
                className="p-1.5 rounded-lg hover:bg-foreground/6 text-muted hover:text-foreground active:scale-95 transition-all flex-shrink-0"
                title={t("collapse_sidebar")}
              >
                <PanelLeftClose size={16} />
              </button>
            ) : null}
            <BrandWordmark size="md" />
          </div>
          <button
            onClick={() => navigate("/app/settings")}
            className="p-1.5 rounded-lg hover:bg-foreground/6 text-muted hover:text-foreground active:scale-95 transition-all"
            title={t("settings")}
          >
            <Settings size={17} />
          </button>
        </div>
        {actions.hasFavorites && !chatData.isSearching && !actions.isEditMode ? (
          <FavoritesStrip />
        ) : null}

        <SidebarChatList
          chats={chatData.chats}
          pinnedChats={chatData.pinnedChats}
          unpinnedChats={chatData.unpinnedChats}
          timeGroups={chatData.timeGroups}
          isInitialLoad={chatData.isInitialLoad}
          isSearching={chatData.isSearching}
          showScheduledOnly={chatData.showScheduledOnly}
          hasMoreChats={chatData.hasMoreChats}
          scrollContainerRef={chatData.scrollContainerRef}
          sentinelRef={chatData.sentinelRef}
          folders={chatData.folders}
          sectionActions={actions.sectionActions}
          isPinnedReorderMode={actions.isPinnedReorderMode}
          onTogglePinnedReorder={actions.togglePinnedReorder}
          onReorderPinned={actions.reorderPinned}
        />

        <SidebarToolbar
          folders={chatData.folders}
          selectedFolderId={chatData.selectedFolderId}
          showScheduledOnly={chatData.showScheduledOnly}
          searchQuery={chatData.searchQuery}
          isEditMode={actions.isEditMode}
          selectedCount={actions.checkedIds.size}
          isCreatingChat={actions.isCreatingChat}
          onSelectAll={chatData.selectAll}
          onToggleScheduled={chatData.toggleScheduled}
          onSelectFolder={chatData.selectFolder}
          onManageFolders={actions.openFolderManager}
          onSearchChange={chatData.setSearchQuery}
          onNewChat={actions.createNewChat}
          onMoveSelected={actions.bulkMove}
          onDeleteSelected={actions.bulkDelete}
          onDoneEditing={actions.finishEditing}
        />
      </div>

      <NewFolderDialog
        isOpen={actions.isNewFolderOpen}
        onClose={actions.closeNewFolder}
        onCreate={(name) => void actions.createFolder(name)}
      />
      <RenameChatDialog
        isOpen={actions.isRenameOpen}
        currentTitle={actions.renamingTitle}
        onClose={actions.closeRename}
        onRename={(title) => void actions.renameChat(title)}
      />
      <FolderManagerDialog
        isOpen={actions.isFolderManagerOpen}
        folders={chatData.folders}
        activeFolderId={chatData.activeFolderId ?? null}
        onClose={actions.closeFolderManager}
        onSelectFolder={chatData.setFolderFromManager}
        onCreateFolder={(name) => void actions.createFolder(name)}
        onRenameFolder={(id, name) => void actions.renameFolder(id, name)}
        onDeleteFolder={(id) => void actions.deleteFolder(id)}
      />
    </>
  );
}
