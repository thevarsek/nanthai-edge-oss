// hooks/useMentionAutocomplete.ts
// Detects @mention trigger in textarea text, extracts partial query,
// filters participant list, and provides insertion logic.
// Matches iOS MentionSuggestion behavior: @Name_With_Underscores + trailing space.

import { useState, useCallback, useMemo, type RefObject } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MentionSuggestion {
  /** Display name (persona name or model short name). */
  displayName: string;
  /** Subtitle text (model ID for personas, provider for bare models). */
  subtitle: string;
  /** Whether this is a persona-backed participant. */
  isPersona: boolean;
  /** Avatar emoji (personas only). */
  avatarEmoji?: string | null;
  /** Model ID of the participant. */
  modelId: string;
}

export interface MentionTrigger {
  /** The partial query string after @ (empty string means just typed @). */
  query: string;
  /** Character index where @ was typed. */
  atIndex: number;
}

export interface UseMentionAutocompleteReturn {
  /** Active mention trigger, or null if not active. */
  trigger: MentionTrigger | null;
  /** Filtered suggestions based on partial query. */
  suggestions: MentionSuggestion[];
  /** Whether the popover should be shown. */
  isActive: boolean;
  /** Call when textarea text changes — detects @ trigger. */
  onTextChange: (text: string, cursorPos: number) => void;
  /** Insert a selected mention, replacing @partial with @Name_Underscored. */
  insertMention: (
    suggestion: MentionSuggestion,
    text: string,
    setText: (v: string) => void,
    textareaRef: RefObject<HTMLTextAreaElement | null>,
  ) => void;
  /** Dismiss the autocomplete popover. */
  dismiss: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Find active @ trigger at cursor position.
 * Rules (matching iOS): @ must be at start of text or preceded by whitespace/newline.
 * Everything from @ to the cursor (stopping at whitespace) is the partial query.
 */
function findTrigger(text: string, cursorPos: number): MentionTrigger | null {
  // Walk backwards from cursor to find @
  let i = cursorPos - 1;
  while (i >= 0) {
    const ch = text[i];
    // Stop at whitespace — no @ trigger spans across spaces
    if (ch === " " || ch === "\n" || ch === "\t") return null;
    if (ch === "@") {
      // @ must be at start of text or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1])) {
        const query = text.slice(i + 1, cursorPos);
        return { query, atIndex: i };
      }
      return null;
    }
    i--;
  }
  return null;
}

/** Replace spaces with underscores for mention token (matches iOS). */
function mentionToken(displayName: string): string {
  return displayName.replace(/\s+/g, "_");
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useMentionAutocomplete(
  allSuggestions: MentionSuggestion[],
): UseMentionAutocompleteReturn {
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);

  const onTextChange = useCallback((text: string, cursorPos: number) => {
    setTrigger(findTrigger(text, cursorPos));
  }, []);

  const dismiss = useCallback(() => setTrigger(null), []);

  // Filter suggestions by partial query (case-insensitive contains)
  const suggestions = useMemo<MentionSuggestion[]>(() => {
    if (!trigger) return [];
    const q = trigger.query.toLowerCase();
    if (q === "") return allSuggestions; // show all on bare @
    return allSuggestions.filter(
      (s) =>
        s.displayName.toLowerCase().includes(q) ||
        s.subtitle.toLowerCase().includes(q),
    );
  }, [trigger, allSuggestions]);

  const isActive = trigger !== null && suggestions.length > 0;

  const insertMention = useCallback(
    (
      suggestion: MentionSuggestion,
      text: string,
      setText: (v: string) => void,
      textareaRef: RefObject<HTMLTextAreaElement | null>,
    ) => {
      if (!trigger) return;

      const token = `@${mentionToken(suggestion.displayName)} `;
      const before = text.slice(0, trigger.atIndex);
      const after = text.slice(trigger.atIndex + 1 + trigger.query.length);
      const newText = before + token + after;
      setText(newText);

      // Set cursor after the inserted mention
      const newCursor = before.length + token.length;
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.setSelectionRange(newCursor, newCursor);
          el.focus();
        }
      });

      setTrigger(null);
    },
    [trigger],
  );

  return {
    trigger,
    suggestions,
    isActive,
    onTextChange,
    insertMention,
    dismiss,
  };
}
