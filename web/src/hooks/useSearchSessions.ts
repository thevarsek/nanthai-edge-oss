// hooks/useSearchSessions.ts
// Subscribes to all search sessions for a chat and provides a lookup map.
// Used by MessageBubble to show research progress indicators.

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SearchSessionStatus =
  | "planning" | "searching" | "analyzing" | "deepening"
  | "synthesizing" | "writing" | "completed" | "failed" | "cancelled";

export interface SearchSession {
  _id: Id<"searchSessions">;
  _creationTime: number;
  chatId: Id<"chats">;
  assistantMessageId: Id<"messages">;
  query: string;
  mode: "web" | "paper";
  complexity: number;
  status: SearchSessionStatus;
  progress: number;
  currentPhase: string;
  phaseOrder: number;
  errorMessage?: string;
  startedAt: number;
  completedAt?: number;
}

const ACTIVE_STATUSES: Set<SearchSessionStatus> = new Set([
  "planning", "searching", "analyzing", "deepening", "synthesizing", "writing",
]);

export function isSessionActive(status: SearchSessionStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function phaseLabel(status: SearchSessionStatus): string {
  switch (status) {
    case "planning": return "Planning queries...";
    case "searching": return "Searching...";
    case "analyzing": return "Analyzing results...";
    case "deepening": return "Deepening research...";
    case "synthesizing": return "Synthesizing findings...";
    case "writing": return "Writing paper...";
    case "completed": return "Completed";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/** Subscribes to all search sessions for a chat, returns a map keyed by session ID. */
export function useSearchSessions(chatId: Id<"chats"> | undefined) {
  const sessions = useQuery(
    api.search.queries.watchChatSearchSessions,
    chatId ? { chatId } : "skip",
  );

  /** Lookup by session _id. */
  const sessionMap = useMemo(() => {
    const map = new Map<string, SearchSession>();
    if (!sessions) return map;
    for (const s of sessions) {
      map.set(s._id, s as SearchSession);
    }
    return map;
  }, [sessions]);

  return { sessions: sessions ?? [], sessionMap };
}
