import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { convexErrorMessage } from "@/lib/convexErrors";

export type GroupBehavior = "parallel" | "collaboration";
export type CollaborationStatus =
  | "queued"
  | "scheduling"
  | "dispatching"
  | "waiting"
  | "silent"
  | "completed"
  | "limit_reached"
  | "stopped"
  | "failed";

export interface CollaborationChatState {
  behavior: GroupBehavior;
  exchange: {
    id: Id<"collaborationExchanges">;
    status: CollaborationStatus;
    currentWave: number;
    maxWaves: number;
    activeSpeakers: Array<{
      displayName: string;
    }>;
    pendingInputCount: number;
    terminalReason?: string;
    error?: string;
    completedAt?: number;
  } | null;
}

const ACTIVE_STATUSES = new Set<CollaborationStatus>([
  "queued",
  "scheduling",
  "dispatching",
  "waiting",
]);

export function useCollaboration(chatId?: Id<"chats">) {
  const state = useQuery(
    api.collaboration.queries.getChatState,
    chatId ? { chatId } : "skip",
  ) as CollaborationChatState | null | undefined;
  const setBehaviorMutation = useMutation(
    api.collaboration.mutations.setGroupBehavior,
  );
  const stopMutation = useMutation(api.collaboration.mutations.stopExchange);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isActive = Boolean(
    state?.exchange && ACTIVE_STATUSES.has(state.exchange.status),
  );
  const setBehavior = async (behavior: GroupBehavior) => {
    if (!chatId) return false;
    if (state?.behavior === behavior) return true;
    setIsUpdating(true);
    setError(null);
    try {
      await setBehaviorMutation({ chatId, behavior });
      return true;
    } catch (caught) {
      setError(convexErrorMessage(caught, "Could not change the group response mode."));
      return false;
    } finally {
      setIsUpdating(false);
    }
  };
  const stop = async () => {
    if (!state?.exchange || !isActive) return;
    setIsUpdating(true);
    setError(null);
    try {
      await stopMutation({ exchangeId: state.exchange.id });
    } catch (caught) {
      setError(convexErrorMessage(caught, "Could not stop Collaboration."));
    } finally {
      setIsUpdating(false);
    }
  };
  return {
    state,
    behavior: state?.behavior ?? "parallel",
    isActive,
    isLoading: state === undefined,
    isUpdating,
    error,
    setBehavior,
    stop,
  };
}

export type UseCollaborationReturn = ReturnType<typeof useCollaboration>;
