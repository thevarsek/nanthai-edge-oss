// components/chat/SearchHighlight.tsx
// Inline text rendering with search match highlights.
// Used for user messages (plain text) and any non-markdown content.
// For markdown content, highlight is applied via CSS mark element.

import { useChatSearchContext } from "./ChatSearchContext";
import { getMatchesForMessage, splitTextByMatches } from "@/hooks/useChatSearch";
import type { Id } from "@convex/_generated/dataModel";

interface SearchHighlightProps {
  messageId: Id<"messages">;
  text: string;
}

/**
 * Renders text with highlighted search matches.
 * Active match gets a brighter highlight; other matches get a dimmer one.
 */
export function SearchHighlight({ messageId, text }: SearchHighlightProps) {
  const { query, queryLength, matches, focusedGlobalIndex } = useChatSearchContext();

  if (!query || queryLength === 0) {
    return <>{text}</>;
  }

  const messageMatches = getMatchesForMessage(messageId, matches);
  if (messageMatches.length === 0) {
    return <>{text}</>;
  }

  const segments = splitTextByMatches(text, messageMatches, queryLength);

  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.isMatch) return <span key={i}>{seg.text}</span>;
        const isFocused = seg.globalIndex === focusedGlobalIndex;
        return (
          <mark
            key={i}
            data-search-match={seg.globalIndex}
            className={
              isFocused
                ? "bg-primary text-white rounded-sm px-0.5"
                : "bg-primary/30 text-foreground rounded-sm px-0.5"
            }
          >
            {seg.text}
          </mark>
        );
      })}
    </>
  );
}
