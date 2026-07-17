import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { ChatRow, FolderRow } from "@/components/chat-list/SidebarSections";
import { getTimeGroup, type TimeGroup } from "@/lib/utils";

const CHAT_PAGE_SIZE = 50;

export function useSidebarChats() {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [showScheduledOnly, setShowScheduledOnly] = useState(false);
  const [chatLimit, setChatLimit] = useState(CHAT_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const activeFolderId = selectedFolderId ?? undefined;
  const chatsQueryArgs = {
    ...(activeFolderId ? { folderId: activeFolderId } : {}),
    limit: chatLimit,
    ...(debouncedSearch.trim() ? { searchQuery: debouncedSearch.trim() } : {}),
    ...(showScheduledOnly ? { source: "scheduled_job" as const } : {}),
  };
  const chatsQueryKey = JSON.stringify({
    folderId: activeFolderId ?? null,
    searchQuery: debouncedSearch.trim(),
    showScheduledOnly,
  });
  const chatsQuery = useQuery(api.chat.queries.listChats, chatsQueryArgs);
  const foldersQuery = useQuery(api.folders.queries.list);
  const [cachedChatsState, setCachedChatsState] = useState<{
    key: string;
    value: typeof chatsQuery;
  } | null>(null);

  const folders = useMemo(
    () => ((foldersQuery ?? []) as FolderRow[])
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)),
    [foldersQuery],
  );

  useEffect(() => {
    if (chatsQuery === undefined) return;
    // Preserve visible rows while a larger page or a new filter is loading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCachedChatsState({ key: chatsQueryKey, value: chatsQuery });
  }, [chatsQuery, chatsQueryKey]);

  const cachedChats = cachedChatsState?.key === chatsQueryKey ? cachedChatsState.value : null;
  const chatsRaw = chatsQuery ?? cachedChats;
  const isInitialLoad = chatsQuery === undefined && cachedChats === null;

  useEffect(() => {
    if (!searchQuery) {
      // Clearing search should immediately return to the unfiltered query.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDebouncedSearch("");
      return;
    }
    const timer = window.setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => window.clearTimeout(timer);
  }, [searchQuery]);

  const chats = useMemo<ChatRow[]>(() => {
    const folderNamesById = new Map(
      folders.map((folder) => [folder._id as string, folder.name]),
    );
    return ((chatsRaw ?? []) as ChatRow[]).map((chat) => ({
      ...chat,
      folderName: chat.folderId ? folderNamesById.get(chat.folderId) : undefined,
    }));
  }, [chatsRaw, folders]);
  const pinnedChats = useMemo(
    () => chats
      .filter((chat) => chat.isPinned)
      .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)),
    [chats],
  );
  const unpinnedChats = useMemo(() => chats.filter((chat) => !chat.isPinned), [chats]);
  const timeGroups = useMemo(() => {
    const groups: Partial<Record<TimeGroup, ChatRow[]>> = {};
    for (const chat of unpinnedChats) {
      const group = getTimeGroup(chat.updatedAt ?? chat.createdAt);
      (groups[group] ??= []).push(chat);
    }
    return groups;
  }, [unpinnedChats]);
  const hasMoreChats = unpinnedChats.length >= chatLimit;

  useEffect(() => {
    // Pagination is scoped to the active filter tuple.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChatLimit(CHAT_PAGE_SIZE);
  }, [showScheduledOnly, activeFolderId, debouncedSearch]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container || !hasMoreChats) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setChatLimit((previous) => previous + CHAT_PAGE_SIZE);
        }
      },
      { root: container, rootMargin: "200px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreChats]);

  const selectAll = useCallback(() => {
    setSelectedFolderId(null);
    setShowScheduledOnly(false);
  }, []);
  const toggleScheduled = useCallback(() => {
    setSelectedFolderId(null);
    setShowScheduledOnly((previous) => !previous);
  }, []);
  const selectFolder = useCallback((folderId: string) => {
    setSelectedFolderId(folderId);
    setShowScheduledOnly(false);
  }, []);
  const setFolderFromManager = useCallback((folderId: string | null) => {
    setSelectedFolderId(folderId);
  }, []);
  const clearDeletedFolder = useCallback((folderId: string) => {
    setSelectedFolderId((current) => (current === folderId ? null : current));
  }, []);

  return {
    activeFolderId,
    chats,
    clearDeletedFolder,
    folders,
    hasMoreChats,
    isInitialLoad,
    isSearching: Boolean(debouncedSearch),
    pinnedChats,
    scrollContainerRef,
    searchQuery,
    selectAll,
    selectedFolderId,
    selectFolder,
    sentinelRef,
    setFolderFromManager,
    setSearchQuery,
    showScheduledOnly,
    timeGroups,
    toggleScheduled,
    unpinnedChats,
  };
}
