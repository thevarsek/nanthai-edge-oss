// components/chat/SearchSessionContext.tsx
// React context for sharing search session data with message bubbles.
// Avoids prop-drilling through MultiModelResponseGroup.

import { createContext, useContext } from "react";
import type { SearchSession } from "@/hooks/useSearchSessions";

export interface SearchSessionContextValue {
  sessionMap: Map<string, SearchSession>;
  onCancel: (sessionId: string) => void;
  onRegenerate: (sessionId: string) => void;
}

const defaultValue: SearchSessionContextValue = {
  sessionMap: new Map(),
  onCancel: () => {},
  onRegenerate: () => {},
};

export const SearchSessionContext = createContext<SearchSessionContextValue>(defaultValue);

export function useSearchSessionContext(): SearchSessionContextValue {
  return useContext(SearchSessionContext);
}
