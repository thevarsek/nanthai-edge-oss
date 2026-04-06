// hooks/useChatCosts.ts
// Fetches per-message cost data for the Advanced Stats feature.
// Only subscribes when showAdvancedStats is enabled to avoid unnecessary queries.

import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

export interface CostBreakdown {
  responses: number;
  memory: number;
  search: number;
  other: number;
}

interface ChatCostSummary {
  totalCost: number;
  messageCosts: Record<string, number>;
  breakdown: CostBreakdown;
}

const EMPTY_BREAKDOWN: CostBreakdown = { responses: 0, memory: 0, search: 0, other: 0 };

/**
 * Subscribe to cost data for a chat. Pass `enabled: false` (when the user has
 * showAdvancedStats off) to skip the subscription entirely.
 */
export function useChatCosts(
  chatId: Id<"chats"> | undefined,
  enabled: boolean,
): { totalCost: number | null; messageCosts: Record<string, number>; breakdown: CostBreakdown | null } {
  const result = useQuery(
    api.chat.queries.getChatCostSummary,
    enabled && chatId ? { chatId } : "skip",
  ) as ChatCostSummary | null | undefined;

  return {
    totalCost: result?.totalCost ?? null,
    messageCosts: result?.messageCosts ?? {},
    breakdown: result?.breakdown ?? null,
  };
}

/**
 * Format a cost value as a dollar string with 4 decimal places.
 * e.g. 0.002345 → "$0.0023"
 */
export function formatCost(cost: number): string {
  return "$" + cost.toFixed(4);
}

/**
 * Returns true if a breakdown has any non-zero ancillary bucket (memory/search/other).
 */
export function hasAncillaryCosts(breakdown: CostBreakdown): boolean {
  return breakdown.memory > 0 || breakdown.search > 0 || breakdown.other > 0;
}

export { EMPTY_BREAKDOWN };
