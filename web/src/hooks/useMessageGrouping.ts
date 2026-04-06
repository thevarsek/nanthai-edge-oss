// hooks/useMessageGrouping.ts
// Groups active-path messages for display: multi-model responses with the
// same `multiModelGroupId` are collapsed into a single group entry.
// Mirrors iOS ChatViewModel+Display.computeGroupedMessages().

import { useMemo } from "react";
import type { Message } from "./useChat";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MessageGroup =
  | { type: "single"; message: Message }
  | { type: "multi"; groupId: string; messages: Message[] };

/** Stable key for React rendering. */
export function messageGroupKey(group: MessageGroup): string {
  return group.type === "single"
    ? group.message._id
    : `group-${group.groupId}`;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Takes the visible (active-path) messages and groups consecutive multi-model
 * responses sharing the same `multiModelGroupId` into `{ type: 'multi' }` entries.
 * Non-multi-model messages remain as `{ type: 'single' }`.
 */
export function useMessageGrouping(visibleMessages: Message[]): MessageGroup[] {
  return useMemo(() => groupMessages(visibleMessages), [visibleMessages]);
}

// ─── Pure logic (testable) ────────────────────────────────────────────────────

export function groupMessages(messages: Message[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  const seenGroupIds = new Set<string>();

  for (const message of messages) {
    const groupId = message.multiModelGroupId;

    if (groupId && message.isMultiModelResponse) {
      // Already processed this multi-model group
      if (seenGroupIds.has(groupId)) continue;
      seenGroupIds.add(groupId);

      // Collect all messages in this group from the visible list
      const grouped = messages.filter(
        (m) => m.multiModelGroupId === groupId && m.isMultiModelResponse,
      );
      groups.push({ type: "multi", groupId, messages: grouped });
    } else {
      groups.push({ type: "single", message });
    }
  }

  return groups;
}
