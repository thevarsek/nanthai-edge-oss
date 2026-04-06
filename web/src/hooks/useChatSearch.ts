// hooks/useChatSearch.ts
// Client-side search within chat messages.
// Provides query state, match list with message IDs and offsets,
// current match index, and navigation (next/prev/close).

import { useState, useMemo, useCallback } from "react";
import type { Id } from "@convex/_generated/dataModel";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single highlighted match inside a message. */
export interface SearchMatch {
  messageId: Id<"messages">;
  /** Character offset within message.content where the match starts. */
  startOffset: number;
  /** Global index across all matches (0-based). */
  globalIndex: number;
}

export interface ChatSearchState {
  /** Whether the search bar is visible. */
  isOpen: boolean;
  /** Current search query string. */
  query: string;
  /** All matches across visible messages. */
  matches: SearchMatch[];
  /** Index of the currently focused match (0-based, -1 if none). */
  currentIndex: number;
  /** The message ID of the currently focused match, for scroll-into-view. */
  currentMessageId: Id<"messages"> | null;
}

export interface ChatSearchActions {
  /** Open the search bar (and optionally set initial query). */
  open: (initialQuery?: string) => void;
  /** Close the search bar and clear state. */
  close: () => void;
  /** Update the search query. */
  setQuery: (query: string) => void;
  /** Navigate to the next match. */
  next: () => void;
  /** Navigate to the previous match. */
  prev: () => void;
}

interface MessageLike {
  _id: Id<"messages">;
  content: string;
  role: string;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useChatSearch(messages: MessageLike[]): ChatSearchState & ChatSearchActions {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQueryRaw] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  // Compute matches whenever query or messages change.
  const matches = useMemo<SearchMatch[]>(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) return [];

    const needle = trimmed.toLowerCase();
    const results: SearchMatch[] = [];
    let globalIdx = 0;

    for (const msg of messages) {
      // Search both user and assistant content
      if (msg.role !== "user" && msg.role !== "assistant") continue;
      const haystack = msg.content.toLowerCase();
      let pos = 0;
      while (pos < haystack.length) {
        const found = haystack.indexOf(needle, pos);
        if (found === -1) break;
        results.push({
          messageId: msg._id,
          startOffset: found,
          globalIndex: globalIdx++,
        });
        pos = found + 1; // advance past this match start for overlapping
      }
    }
    return results;
  }, [query, messages]);

  const boundedCurrentIndex =
    matches.length === 0 ? 0 : Math.min(currentIndex, matches.length - 1);
  const currentMatch = matches[boundedCurrentIndex] ?? null;
  const currentMessageId = currentMatch?.messageId ?? null;

  const open = useCallback((initialQuery?: string) => {
    setIsOpen(true);
    if (initialQuery !== undefined) setQueryRaw(initialQuery);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQueryRaw("");
    setCurrentIndex(0);
  }, []);

  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    setCurrentIndex(0); // reset to first match on new query
  }, []);

  const next = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const prev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  return {
    isOpen, query, matches, currentIndex: boundedCurrentIndex, currentMessageId,
    open, close, setQuery, next, prev,
  };
}

// ─── Highlight utility ────────────────────────────────────────────────────────

/**
 * Returns the set of match indices (globalIndex) for a given message,
 * plus the currently focused globalIndex for styling the active match.
 */
export function getMatchesForMessage(
  messageId: Id<"messages">,
  matches: SearchMatch[],
): SearchMatch[] {
  return matches.filter((m) => m.messageId === messageId);
}

/**
 * Splits text into segments: plain spans and highlighted spans.
 * Used by MessageBubble to render inline search highlights on plain text content.
 * For markdown content, we use a CSS-based approach instead.
 */
export interface TextSegment {
  text: string;
  isMatch: boolean;
  /** If isMatch, this is the globalIndex of the match. */
  globalIndex?: number;
}

export function splitTextByMatches(
  content: string,
  messageMatches: SearchMatch[],
  queryLength: number,
): TextSegment[] {
  if (messageMatches.length === 0 || queryLength === 0) {
    return [{ text: content, isMatch: false }];
  }

  // Sort matches by startOffset
  const sorted = [...messageMatches].sort((a, b) => a.startOffset - b.startOffset);
  const segments: TextSegment[] = [];
  let cursor = 0;

  for (const match of sorted) {
    if (match.startOffset > cursor) {
      segments.push({ text: content.slice(cursor, match.startOffset), isMatch: false });
    }
    segments.push({
      text: content.slice(match.startOffset, match.startOffset + queryLength),
      isMatch: true,
      globalIndex: match.globalIndex,
    });
    cursor = match.startOffset + queryLength;
  }

  if (cursor < content.length) {
    segments.push({ text: content.slice(cursor), isMatch: false });
  }

  return segments;
}
