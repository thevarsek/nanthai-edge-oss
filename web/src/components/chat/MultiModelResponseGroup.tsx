// components/chat/MultiModelResponseGroup.tsx
// Renders 2–3 concurrent assistant responses that share a multiModelGroupId.
// Vertically stacked with a group header, dividers, and subtle card background.
// Mirrors iOS MultiModelResponseView.swift.

import { memo } from "react";
import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Id } from "@convex/_generated/dataModel";
import type { Message, Participant } from "@/hooks/useChat";
import { MessageBubble } from "./MessageBubble";
import { formatCost } from "@/hooks/useChatCosts";

// ─── Props ────────────────────────────────────────────────────────────────────

interface MultiModelResponseGroupProps {
  groupId: string;
  messages: Message[];
  isStreaming: boolean;
  participants: Participant[];
  onRetry: (messageId: Id<"messages">) => void;
  onFork: (messageId: Id<"messages">) => void;
  onRetryWithDifferentModel?: (messageId: Id<"messages">) => void;
  messageCosts?: Record<string, number>;
  showAdvancedStats?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const MultiModelResponseGroup = memo(function MultiModelResponseGroup({
  messages,
  isStreaming,
  participants,
  onRetry,
  onFork,
  onRetryWithDifferentModel,
  messageCosts,
  showAdvancedStats,
}: MultiModelResponseGroupProps) {
  const { t } = useTranslation();
  const groupTotal = showAdvancedStats
    ? messages.reduce((sum, m) => sum + (messageCosts?.[m._id] ?? 0), 0)
    : 0;

  return (
    <div className="space-y-0">
      {/* Group header — mirrors iOS groupHeader */}
      <div className="flex items-center gap-1.5 pl-11 pb-1">
        <Users size={11} className="text-muted" />
        <span className="text-[10px] font-medium text-muted">
          {messages.length === 1 ? t("n_responses", { count: messages.length }) : t("n_responses", { count: messages.length })}
        </span>
      </div>

      {/* Grouped card with stacked responses */}
      <div className="rounded-xl bg-surface-2/30 border border-border/20 py-2 px-2">
        {messages.map((message, index) => (
          <div key={message._id}>
            {index > 0 && (
              <div className="ml-11 my-1.5 border-t border-border/20" />
            )}
            <MessageBubble
              message={message}
              isStreaming={isStreaming && message.status === "streaming"}
              participants={participants}
              onRetry={onRetry}
              onFork={onFork}
              onRetryWithDifferentModel={onRetryWithDifferentModel}
              messageCost={messageCosts?.[message._id]}
              showAdvancedStats={showAdvancedStats}
            />
          </div>
        ))}
        {showAdvancedStats && (
          <div className="flex justify-end px-2 pt-1">
            <span className="text-[10px] font-mono text-muted">
              {t("total_label")}: {formatCost(groupTotal)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
});
