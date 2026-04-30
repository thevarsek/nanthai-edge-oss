// Sidebar.tsx
// Full chat-list panel matching iOS ChatListView:
//   Top:    "NanthAi: Edge" title + settings icon
//   Middle: Favorites strip, chat list with pinned/time sections
//   Bottom: Filter menu + search + compose button
//   Modes:  browse, edit/multi-select, search, folder manager
//
// Max 300 lines — sub-components in chat-list/SidebarSections.tsx.

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useNavigate, useParams } from "react-router-dom";
import { Settings, SquarePen, Search, X, Loader2, PanelLeftClose, MessageSquare } from "lucide-react";
import { useSharedData } from "@/hooks/useSharedData";
import { FavoritesStrip } from "@/components/chat-list/FavoritesStrip";
import { BrandWordmark } from "@/components/shared/BrandWordmark";
import { EmptyState } from "@/components/shared/EmptyState";
import { useToast } from "@/components/shared/Toast.context";
import { getTimeGroup, debounce } from "@/lib/utils";
import { buildDefaultParticipants, launchChat, type PersonaLike } from "@/lib/chatLaunch";
import { sidebarChatMatchesSearch } from "@/lib/sidebarSearch";
import { Defaults } from "@/lib/constants";
import type { TimeGroup } from "@/lib/utils";
import type { Id } from "@convex/_generated/dataModel";
import {
  PinnedSection, TimeGroupSection, FilterMenu, NewFolderDialog,
  RenameChatDialog, FolderManagerDialog, EditModeBar,
} from "@/components/chat-list/SidebarSections";
import type { ChatRow, FolderRow } from "@/components/chat-list/SidebarSections";

const TIME_GROUP_ORDER: TimeGroup[] = ["Today", "Yesterday", "Last 7 Days", "Last 30 Days", "Older"];
const CHAT_PAGE_SIZE = 50;

interface SidebarProps {
  onToggleCollapse?: () => void;
}

export function Sidebar({ onToggleCollapse }: SidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { chatId: selectedChatId } = useParams<{ chatId: string }>();
  const { favorites, prefs, personas } = useSharedData();

  // ── State ────────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [showScheduledOnly, setShowScheduledOnly] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showFolderManager, setShowFolderManager] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [isPinnedReorderMode, setIsPinnedReorderMode] = useState(false);
  const [chatLimit, setChatLimit] = useState(CHAT_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ── Mutations ────────────────────────────────────────────────────────────
  const createChat = useMutation(api.chat.mutations.createChat);
  const deleteChat = useMutation(api.chat.manage.deleteChat);
  const updateChat = useMutation(api.chat.manage.updateChat);
  const moveChat = useMutation(api.folders.mutations.moveChat);
  const createFolder = useMutation(api.folders.mutations.create);
  const renameFolder = useMutation(api.folders.mutations.update);
  const deleteFolder = useMutation(api.folders.mutations.remove);
  const duplicateChat = useMutation(api.chat.manage.duplicateChat);
  const bulkDeleteChats = useMutation(api.chat.manage.bulkDeleteChats);
  const bulkMoveChats = useMutation(api.chat.manage.bulkMoveChats);
  const reorderPinnedChats = useMutation(api.chat.manage.reorderPinnedChats);

  // ── Queries ──────────────────────────────────────────────────────────────
  const activeFolderId = selectedFolderId ?? undefined;
  const chatsQuery = useQuery(api.chat.queries.listChats,
    activeFolderId ? { folderId: activeFolderId, limit: chatLimit } : { limit: chatLimit },
  );
  const foldersQuery = useQuery(api.folders.queries.list);
  const folders = useMemo(
    () => ((foldersQuery ?? []) as FolderRow[])
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [foldersQuery],
  );

  // Keep the previous chat data visible while loading more (prevents scroll reset).
  // Only show skeleton on true initial load (prevChatsRef is still null).
  const prevChatsRef = useRef<typeof chatsQuery>(null);
  if (chatsQuery !== undefined) prevChatsRef.current = chatsQuery;
  const chatsRaw = chatsQuery ?? prevChatsRef.current;
  const isInitialLoad = chatsQuery === undefined && prevChatsRef.current === null;

  const debouncedSetSearch = useMemo(() => debounce((v: string) => setDebouncedSearch(v), 300), []);

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    setSearchQuery(e.target.value);
    debouncedSetSearch(e.target.value);
  }

  // ── Derived data ─────────────────────────────────────────────────────────
  const chats: ChatRow[] = useMemo(() => {
    let all = (chatsRaw ?? []) as ChatRow[];
    const folderNamesById = new Map(folders.map((folder) => [folder._id as string, folder.name]));
    all = all.map((chat) => ({
      ...chat,
      folderName: chat.folderId ? folderNamesById.get(chat.folderId) : undefined,
    }));
    if (showScheduledOnly) {
      all = all.filter((c) => c.source === "scheduled_job");
    }
    if (!debouncedSearch.trim()) return all;
    return all.filter((c) => sidebarChatMatchesSearch(c, debouncedSearch));
  }, [chatsRaw, debouncedSearch, folders, showScheduledOnly]);

  const pinnedChats = useMemo(
    () => chats.filter((c) => c.isPinned).sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)),
    [chats],
  );
  const unpinnedChats = useMemo(() => chats.filter((c) => !c.isPinned), [chats]);

  const timeGroups = useMemo(() => {
    const groups: Partial<Record<TimeGroup, ChatRow[]>> = {};
    for (const chat of unpinnedChats) {
      const group = getTimeGroup(chat.updatedAt ?? chat.createdAt);
      (groups[group] ??= []).push(chat);
    }
    return groups;
  }, [unpinnedChats]);

  // Matches iOS: hasMore when unpinned count >= limit
  const hasMoreChats = unpinnedChats.length >= chatLimit;

  // Reset chatLimit when filter changes so we don't over-fetch for a new filter
  useEffect(() => {
    setChatLimit(CHAT_PAGE_SIZE);
  }, [showScheduledOnly, activeFolderId]);

  // IntersectionObserver — auto-load more when sentinel at bottom enters viewport
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container || !hasMoreChats) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setChatLimit((prev) => prev + CHAT_PAGE_SIZE);
        }
      },
      { root: container, rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreChats]);

  // ── Callbacks ────────────────────────────────────────────────────────────
  const handleNewChat = useCallback(async () => {
    try {
      const participants = buildDefaultParticipants({
        prefs: prefs as { defaultModelId?: string; defaultPersonaId?: string } | undefined,
        personas: (personas ?? []) as PersonaLike[],
        fallbackModelId: Defaults.model,
      });
      const chatId = await launchChat({
        createChat,
        participants,
        folderId: activeFolderId,
      });
      navigate(`/app/chat/${chatId}`);
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : t("something_went_wrong"),
        variant: "error",
      });
    }
  }, [activeFolderId, createChat, navigate, personas, prefs, t, toast]);

  const handleSelectChat = useCallback((id: string) => navigate(`/app/chat/${id}`), [navigate]);

  const handlePin = useCallback(async (id: string, currentlyPinned: boolean) => {
    await updateChat({ chatId: id as Id<"chats">, isPinned: !currentlyPinned });
  }, [updateChat]);

  const handleDelete = useCallback(async (id: string) => {
    if (selectedChatId === id) navigate("/app");
    await deleteChat({ chatId: id as Id<"chats"> });
  }, [deleteChat, navigate, selectedChatId]);

  const handleMoveToFolder = useCallback(async (id: string, folderId: string | undefined) => {
    await moveChat({ chatId: id as Id<"chats">, folderId: folderId as Id<"folders"> | undefined });
  }, [moveChat]);

  const handleCreateFolder = useCallback(async (name: string) => {
    await createFolder({ name });
  }, [createFolder]);

  const handleRenameFolder = useCallback(async (id: string, name: string) => {
    await renameFolder({ folderId: id as Id<"folders">, name });
  }, [renameFolder]);

  const handleDeleteFolder = useCallback(async (id: string) => {
    await deleteFolder({ folderId: id as Id<"folders"> });
    // Reset filter if we deleted the active folder
    if (selectedFolderId === id) setSelectedFolderId(null);
  }, [deleteFolder, selectedFolderId]);

  const handleDuplicate = useCallback(async (id: string) => {
    const newChatId = await duplicateChat({ chatId: id as Id<"chats"> });
    navigate(`/app/chat/${newChatId}`);
  }, [duplicateChat, navigate]);

  const handleStartRename = useCallback((id: string) => {
    const chat = chats.find((c) => (c._id as string) === id);
    setRenamingChatId(id);
    setRenamingTitle(chat?.title ?? t("new_chat"));
  }, [chats, t]);

  const handleRename = useCallback(async (newTitle: string) => {
    if (renamingChatId) {
      await updateChat({ chatId: renamingChatId as Id<"chats">, title: newTitle });
    }
  }, [updateChat, renamingChatId]);

  const handleToggleCheck = useCallback((id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleBulkDelete = useCallback(async () => {
    if (checkedIds.size === 0) return;
    await bulkDeleteChats({ chatIds: Array.from(checkedIds) as Id<"chats">[] });
    if (selectedChatId && checkedIds.has(selectedChatId)) navigate("/app");
    setCheckedIds(new Set());
    setIsEditMode(false);
  }, [bulkDeleteChats, checkedIds, selectedChatId, navigate]);

  const handleBulkMove = useCallback(async (folderId: string | undefined) => {
    if (checkedIds.size === 0) return;
    await bulkMoveChats({ chatIds: Array.from(checkedIds) as Id<"chats">[], folderId });
    setCheckedIds(new Set());
    setIsEditMode(false);
  }, [bulkMoveChats, checkedIds]);

  const handleReorderPinned = useCallback(async (orderedIds: Id<"chats">[]) => {
    await reorderPinnedChats({ orderedChatIds: orderedIds });
  }, [reorderPinnedChats]);

  const enterEditMode = useCallback(() => {
    setIsEditMode(true);
    setCheckedIds(new Set());
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "n" && !e.shiftKey) {
        e.preventDefault();
        void handleNewChat();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleNewChat]);

  const hasFavorites = (favorites ?? []).length > 0;
  const isSearching = !!debouncedSearch;

  // ── Shared section props ─────────────────────────────────────────────────
  const sectionProps = {
    selectedChatId: selectedChatId ?? null,
    folders,
    isEditMode,
    checkedIds,
    onSelect: handleSelectChat,
    onPin: handlePin,
    onDelete: handleDelete,
    onMoveToFolder: handleMoveToFolder,
    onRename: handleStartRename,
    onDuplicate: handleDuplicate,
    onEnterEditMode: enterEditMode,
    onToggleCheck: handleToggleCheck,
  };

  return (
    <>
        <div className="w-full h-full bg-background md:bg-muted border-r-0 md:border md:border-border/70 md:rounded-[2rem] md:shadow-lg dark:md:shadow-2xl flex-shrink-0 flex flex-col overflow-hidden">
        {/* ── Top bar ── */}
        <div className="flex-shrink-0 flex items-center justify-between px-4 pt-5 pb-3">
          <div className="flex items-center gap-2 min-w-0">
            {onToggleCollapse && (
              <button
                onClick={onToggleCollapse}
                className="p-1.5 rounded-lg hover:bg-foreground/6 text-muted hover:text-foreground active:scale-95 transition-all flex-shrink-0"
                title={t("collapse_sidebar")}
              >
                <PanelLeftClose size={16} />
              </button>
            )}
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

        {/* ── Favorites strip ── */}
        {hasFavorites && !isSearching && !isEditMode && <FavoritesStrip />}

        {/* ── Chat list ── */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-1.5 pb-2 min-h-0">
          {isInitialLoad ? (
            <div className="flex flex-col gap-2 px-2 pt-2">
              {[65, 45, 72, 55, 38, 60].map((w, i) => (
                <div key={i} className="h-14 rounded-xl bg-foreground/4 animate-pulse" style={{ width: `${w}%` }} />
              ))}
            </div>
          ) : chats.length === 0 ? (
            <EmptyState
              icon={<MessageSquare size={28} />}
              title={isSearching ? t("no_chats_match_search") : showScheduledOnly ? t("no_scheduled_chats") : t("no_chats_yet")}
              className="h-40"
            />
          ) : (
            <div className="flex flex-col gap-1">
              {pinnedChats.length > 0 && (
                <PinnedSection
                  {...sectionProps}
                  chats={pinnedChats}
                  isReorderMode={isPinnedReorderMode}
                  onToggleReorder={() => setIsPinnedReorderMode((v) => !v)}
                  onReorderPinned={handleReorderPinned}
                />
              )}
              {unpinnedChats.length > 0 && pinnedChats.length > 0 && (
                <div className="px-3 py-1">
                  <span className="text-xs font-semibold text-foreground/40 uppercase tracking-wide">{t("chats")}</span>
                </div>
              )}
              {TIME_GROUP_ORDER.map((group) => {
                const groupChats = timeGroups[group];
                if (!groupChats?.length) return null;
                return <TimeGroupSection key={group} {...sectionProps} label={group} chats={groupChats} />;
              })}

              {/* Load more sentinel — triggers IntersectionObserver */}
              {hasMoreChats && (
                <div ref={sentinelRef} className="flex items-center justify-center py-3">
                  <Loader2 size={16} className="animate-spin text-foreground/30" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Bottom toolbar ── */}
        {isEditMode ? (
          <EditModeBar
            selectedCount={checkedIds.size}
            folders={folders}
            onMoveToFolder={handleBulkMove}
            onDelete={() => void handleBulkDelete()}
            onDone={() => { setIsEditMode(false); setCheckedIds(new Set()); }}
          />
        ) : (
          <div className="flex-shrink-0 border-t border-border px-3 py-2 flex items-center gap-2">
            <FilterMenu
              folders={folders}
              selectedFolderId={selectedFolderId}
              showScheduledOnly={showScheduledOnly}
              onSelectAll={() => {
                setSelectedFolderId(null);
                setShowScheduledOnly(false);
              }}
              onToggleScheduled={() => setShowScheduledOnly((prev) => !prev)}
              onSelectFolder={setSelectedFolderId}
              onManageFolders={() => setShowFolderManager(true)}
            />
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                id="chat-search-input"
                type="search"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder={t("search_placeholder")}
                className="w-full bg-input border border-transparent rounded-xl pl-8 pr-7 py-1.5 text-sm placeholder:text-muted outline-none focus:border-primary/30 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(""); setDebouncedSearch(""); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <button
              onClick={() => void handleNewChat()}
              className="p-2 rounded-xl hover:bg-primary/12 text-primary active:scale-95 transition-all flex-shrink-0"
              title={t("new_chat_shortcut")}
            >
            <SquarePen size={18} />
          </button>
          </div>
        )}
      </div>

      <NewFolderDialog isOpen={showNewFolder} onClose={() => setShowNewFolder(false)} onCreate={handleCreateFolder} />
      <RenameChatDialog
        isOpen={!!renamingChatId}
        currentTitle={renamingTitle}
        onClose={() => setRenamingChatId(null)}
        onRename={(t) => void handleRename(t)}
      />
      <FolderManagerDialog
        isOpen={showFolderManager}
        folders={folders}
        activeFolderId={activeFolderId ?? null}
        onClose={() => setShowFolderManager(false)}
        onSelectFolder={setSelectedFolderId}
        onCreateFolder={(n) => void handleCreateFolder(n)}
        onRenameFolder={(id, n) => void handleRenameFolder(id, n)}
        onDeleteFolder={(id) => void handleDeleteFolder(id)}
      />
    </>
  );
}
