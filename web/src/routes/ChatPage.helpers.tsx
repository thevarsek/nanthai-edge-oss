// routes/ChatPage.helpers.tsx
// Extracted hooks for ChatPage: scroll, search wiring, mentions, search mode, subagent override.
// Components (ChatHeader, EmptyChatState, ChatModalPanels) are in ChatPage.header.tsx.

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import type { Chat, Participant, UseChatReturn } from "@/hooks/useChat";
import type { MentionSuggestion } from "@/hooks/useMentionAutocomplete";
import type { SubagentOverride } from "@/components/chat/ChatSubagentsDrawer";
import type { Id } from "@convex/_generated/dataModel";
import type { ChatSearchContextValue } from "@/components/chat/ChatSearchContext";
import { useChatSearch, type ChatSearchState, type ChatSearchActions } from "@/hooks/useChatSearch";
import type { Message } from "@/hooks/useChat";
import type { SearchModeState, SearchComplexity } from "@/components/chat/SearchModePanel";

// ─── Auto-scroll hook ─────────────────────────────────────────────────────────
export function useChatScroll(
  endRef: RefObject<HTMLDivElement | null>, messageCount: number,
  isGenerating: boolean, chatId: string | undefined,
) {
  useEffect(() => {
    if (!isGenerating) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messageCount, isGenerating, endRef]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "instant" }); }, [chatId, endRef]);
}

// ─── In-chat search wiring ────────────────────────────────────────────────────

export interface ChatSearchWiring extends ChatSearchState, ChatSearchActions {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  searchCtx: ChatSearchContextValue;
}

export function useChatSearchWiring(
  visibleMessages: Message[],
  chatId: string | undefined,
): ChatSearchWiring {
  const {
    isOpen,
    query,
    matches,
    currentIndex,
    currentMessageId,
    open,
    close,
    setQuery,
    next,
    prev,
  } = useChatSearch(visibleMessages);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        if (isOpen) close();
        else open();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, close, open]);

  useEffect(() => { close(); }, [chatId, close]);

  useEffect(() => {
    if (!currentMessageId || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current.querySelector(
      `[data-message-id="${currentMessageId}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentMessageId, currentIndex]);

  const searchCtx = useMemo<ChatSearchContextValue>(() => ({
    query,
    queryLength: query.trim().length,
    matches,
    focusedGlobalIndex: matches[currentIndex]?.globalIndex ?? -1,
  }), [query, matches, currentIndex]);

  return {
    isOpen,
    query,
    matches,
    currentIndex,
    currentMessageId,
    open,
    close,
    setQuery,
    next,
    prev,
    scrollContainerRef,
    searchCtx,
  };
}

// ─── Mention suggestions hook ─────────────────────────────────────────────────

export function useMentionSuggestions(participants: Participant[]): MentionSuggestion[] {
  return useMemo<MentionSuggestion[]>(
    () => participants.map((p) => ({
      displayName: p.personaName ?? p.modelId.split("/").pop() ?? p.modelId,
      subtitle: p.personaName ? p.modelId.split("/").pop() ?? p.modelId : p.modelId.split("/")[0] ?? "",
      isPersona: !!p.personaId,
      avatarEmoji: p.personaEmoji,
      modelId: p.modelId,
    })),
    [participants],
  );
}

// ─── Search mode resolution ───────────────────────────────────────────────────
// Mirrors iOS ChatViewModel+Preferences: per-chat overrides → user pref defaults.
// Tracks full search mode state: mode (none/basic/web/paper) + complexity (1-3).

interface UseSearchModeArgs {
  chat: Chat | null | undefined;
  chatId: Id<"chats"> | undefined;
  updateChat: UseChatReturn["updateChat"];
  webSearchEnabledByDefault: boolean;
  defaultSearchMode?: string | null;
  defaultSearchComplexity?: number | null;
}

export interface SearchModeResult {
  searchMode: SearchModeState;
  toggleSearch: () => Promise<void>;
  setSearchMode: (state: SearchModeState) => Promise<void>;
  globeColor: "muted" | "green" | "blue" | "orange";
}

export function useSearchMode({
  chat, chatId, updateChat,
  webSearchEnabledByDefault, defaultSearchMode, defaultSearchComplexity,
}: UseSearchModeArgs): SearchModeResult {
  const searchMode = useMemo<SearchModeState>(() => {
    if (chat?.searchModeOverride) {
      const mode = chat.searchModeOverride as "basic" | "web" | "paper";
      const complexity = (chat.searchComplexityOverride ?? 1) as SearchComplexity;
      return { mode, complexity };
    }
    if (chat?.webSearchOverride === false) return { mode: "none", complexity: 1 };
    if (chat?.webSearchOverride === true) {
      const mode = (defaultSearchMode ?? "basic") as "basic" | "web" | "paper";
      const complexity = (defaultSearchComplexity ?? 1) as SearchComplexity;
      return { mode, complexity };
    }
    if (webSearchEnabledByDefault) {
      const mode = (defaultSearchMode ?? "basic") as "basic" | "web" | "paper";
      const complexity = (defaultSearchComplexity ?? 1) as SearchComplexity;
      return { mode, complexity };
    }
    return { mode: "none", complexity: 1 };
  }, [chat, webSearchEnabledByDefault, defaultSearchMode, defaultSearchComplexity]);

  const toggleSearch = useCallback(async () => {
    if (!chatId) return;
    if (searchMode.mode === "none") {
      const mode = (defaultSearchMode ?? "basic") as "basic" | "web" | "paper";
      const complexity = (defaultSearchComplexity ?? 1) as SearchComplexity;
      await updateChat({
        chatId, webSearchOverride: true,
        searchModeOverride: mode, searchComplexityOverride: complexity,
      } as Parameters<typeof updateChat>[0]);
    } else {
      await updateChat({
        chatId, webSearchOverride: false,
        searchModeOverride: null, searchComplexityOverride: null,
      } as unknown as Parameters<typeof updateChat>[0]);
    }
  }, [chatId, searchMode, defaultSearchMode, defaultSearchComplexity, updateChat]);

  const setSearchMode = useCallback(async (state: SearchModeState) => {
    if (!chatId) return;
    if (state.mode === "none") {
      await updateChat({
        chatId, webSearchOverride: false,
        searchModeOverride: null, searchComplexityOverride: null,
      } as unknown as Parameters<typeof updateChat>[0]);
    } else {
      await updateChat({
        chatId, webSearchOverride: true,
        searchModeOverride: state.mode, searchComplexityOverride: state.complexity,
      } as Parameters<typeof updateChat>[0]);
    }
  }, [chatId, updateChat]);

  const globeColor = useMemo<"muted" | "green" | "blue" | "orange">(() => {
    switch (searchMode.mode) {
      case "none": return "muted";
      case "basic": return "green";
      case "web": return "blue";
      case "paper": return "orange";
    }
  }, [searchMode.mode]);

  return { searchMode, toggleSearch, setSearchMode, globeColor };
}

// ─── Subagent override resolution ─────────────────────────────────────────────

interface UseSubagentOverrideArgs {
  chat: Chat | null | undefined; participantCount: number; isPro: boolean;
  subagentsEnabledByDefault: boolean; chatId: Id<"chats"> | undefined;
  updateChat: UseChatReturn["updateChat"];
}

export interface SubagentOverrideResult {
  subagentOverride: SubagentOverride;
  effectiveSubagentsEnabled: boolean;
  handleSubagentOverrideChange: (override: SubagentOverride) => Promise<void>;
}

export function useSubagentOverride({
  chat, participantCount, isPro, subagentsEnabledByDefault, chatId, updateChat,
}: UseSubagentOverrideArgs): SubagentOverrideResult {
  const subagentOverride: SubagentOverride = chat?.subagentOverride ?? "inherit";

  const effectiveSubagentsEnabled = useMemo(() => {
    if (participantCount !== 1) return false;
    if (!isPro) return false;
    switch (subagentOverride) {
      case "enabled": return true;
      case "disabled": return false;
      case "inherit": return subagentsEnabledByDefault;
    }
  }, [participantCount, isPro, subagentOverride, subagentsEnabledByDefault]);

  const handleSubagentOverrideChange = useCallback(
    async (override: SubagentOverride) => {
      if (!chatId) return;
      await updateChat({
        chatId,
        subagentOverride: override === "inherit" ? undefined : override,
      } as Parameters<typeof updateChat>[0]);
    },
    [chatId, updateChat],
  );

  return { subagentOverride, effectiveSubagentsEnabled, handleSubagentOverrideChange };
}
