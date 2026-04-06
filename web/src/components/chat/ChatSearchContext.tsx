// components/chat/ChatSearchContext.tsx
// Lightweight React context for search highlight state.
// Avoids prop-drilling search state through MessageBubble -> MarkdownRenderer.

import { createContext, useContext } from "react";
import type { SearchMatch } from "@/hooks/useChatSearch";

export interface ChatSearchContextValue {
  /** The active search query (empty = no search active). */
  query: string;
  /** Length of the search query for highlight spans. */
  queryLength: number;
  /** All matches across all messages. */
  matches: SearchMatch[];
  /** The global index of the currently focused match (-1 = none). */
  focusedGlobalIndex: number;
}

const defaultValue: ChatSearchContextValue = {
  query: "",
  queryLength: 0,
  matches: [],
  focusedGlobalIndex: -1,
};

export const ChatSearchContext = createContext<ChatSearchContextValue>(defaultValue);

export function useChatSearchContext() {
  return useContext(ChatSearchContext);
}
