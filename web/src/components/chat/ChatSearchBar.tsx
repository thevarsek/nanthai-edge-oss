// components/chat/ChatSearchBar.tsx
// Overlay search bar for in-chat message search.
// Shows at the top of the chat area with input, match counter,
// navigation arrows (up/down), and close button.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";

interface ChatSearchBarProps {
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  currentIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export function ChatSearchBar({
  query,
  onQueryChange,
  matchCount,
  currentIndex,
  onNext,
  onPrev,
  onClose,
}: ChatSearchBarProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    }
  };

  const hasMatches = matchCount > 0;
  const hasQuery = query.trim().length >= 2;

  return (
    <div className="absolute top-0 left-0 right-0 z-20 px-4 py-2 bg-background/95 backdrop-blur-sm border-b border-border/30 animate-in slide-in-from-top-2 duration-150">
      <div className="flex items-center gap-2 max-w-2xl mx-auto">
        {/* Search icon */}
        <Search size={16} className="shrink-0 text-muted" />

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("search_in_chat")}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-foreground/40 outline-none min-w-0"
          autoComplete="off"
          spellCheck={false}
        />

        {/* Match counter */}
        {hasQuery && (
          <span className="shrink-0 text-xs text-muted tabular-nums">
            {hasMatches ? `${currentIndex + 1} / ${matchCount}` : t("no_matches")}
          </span>
        )}

        {/* Navigation arrows */}
        <div className="flex items-center shrink-0">
          <button
            onClick={onPrev}
            disabled={!hasMatches}
            className="p-1 rounded hover:bg-surface-3 text-muted hover:text-foreground disabled:opacity-30 disabled:cursor-default transition-colors"
            title={t("previous_match")}
          >
            <ChevronUp size={16} />
          </button>
          <button
            onClick={onNext}
            disabled={!hasMatches}
            className="p-1 rounded hover:bg-surface-3 text-muted hover:text-foreground disabled:opacity-30 disabled:cursor-default transition-colors"
            title={t("next_match")}
          >
            <ChevronDown size={16} />
          </button>
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-3 text-muted hover:text-foreground transition-colors"
            title={t("close_escape")}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
