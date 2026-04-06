// components/chat/MentionAutocompletePopover.tsx
// Popover positioned above the textarea showing filtered @mention suggestions.
// Supports keyboard navigation (ArrowUp/Down/Enter/Escape).
// Renders avatar + displayName + subtitle for each suggestion.

import { useCallback, useEffect, useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import type { MentionSuggestion } from "@/hooks/useMentionAutocomplete";

// ─── Props ──────────────────────────────────────────────────────────────────

interface Props {
  suggestions: MentionSuggestion[];
  onSelect: (suggestion: MentionSuggestion) => void;
  onDismiss: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MentionAutocompletePopover({
  suggestions,
  onSelect,
  onDismiss,
}: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const visibleActiveIndex = suggestions[activeIndex] ? activeIndex : 0;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((i) => (i + 1) % suggestions.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          if (suggestions[visibleActiveIndex]) onSelect(suggestions[visibleActiveIndex]);
          break;
        case "Escape":
          e.preventDefault();
          onDismiss();
          break;
      }
    },
    [suggestions, visibleActiveIndex, onSelect, onDismiss],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [handleKeyDown]);

  if (suggestions.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto rounded-xl bg-surface-1 border border-border/50 shadow-xl z-50">
      {suggestions.map((s, i) => (
        <button
          key={`${s.modelId}-${s.displayName}`}
          onMouseDown={(e) => {
            e.preventDefault(); // keep textarea focus
            onSelect(s);
          }}
          onMouseEnter={() => setActiveIndex(i)}
          className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
            i === visibleActiveIndex ? "bg-primary/10" : "hover:bg-surface-2"
          }`}
        >
          <span className="text-base w-5 text-center shrink-0">
            {s.avatarEmoji ?? (s.isPersona ? (
              <Sparkles size={14} className="text-primary mx-auto" />
            ) : (
              <Bot size={14} className="text-muted mx-auto" />
            ))}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{s.displayName}</div>
            <div className="text-xs text-muted truncate">{s.subtitle}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
