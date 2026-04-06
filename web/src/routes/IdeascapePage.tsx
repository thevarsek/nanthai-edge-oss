// routes/IdeascapePage.tsx
// Ideascape page — reads :chatId from URL, shows canvas or chat picker.

import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { CanvasView } from "@/routes/IdeascapePage.canvas";

// ─── Chat picker (fallback when no chatId in URL) ───────────────────────────

function ChatPicker({ onSelect }: { onSelect: (chatId: Id<"chats">) => void }) {
  const { t } = useTranslation();
  const chats = useQuery(api.chat.queries.listChats, {});

  if (!chats) {
    return <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>;
  }

  if (chats.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
        <div className="text-4xl">🧠</div>
        <h2 className="text-lg font-semibold">{t("no_chats_yet_ideascape")}</h2>
        <p className="text-sm text-muted max-w-xs">
          {t("start_chat_first")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-lg mx-auto p-4 space-y-3">
        <h2 className="text-sm font-semibold text-muted uppercase tracking-wide px-1">
          {t("choose_a_chat")}
        </h2>
        <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
          {chats.map((chat) => (
            <button
              key={chat._id}
              onClick={() => onSelect(chat._id)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-accent/15 flex items-center justify-center text-base flex-shrink-0">
                🧠
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{chat.title ?? t("untitled")}</p>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted flex-shrink-0">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function IdeascapePage() {
  const { chatId: urlChatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [pickedChatId, setPickedChatId] = useState<Id<"chats"> | null>(null);
  const activeChatId = useMemo<Id<"chats"> | null>(
    () => (urlChatId ? (urlChatId as Id<"chats">) : pickedChatId),
    [urlChatId, pickedChatId],
  );

  if (!activeChatId) {
    return (
      <div className="flex-1 flex flex-col h-full">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
          <h1 className="text-lg font-semibold">{t("ideascape")}</h1>
        </div>
        <ChatPicker onSelect={(id) => {
          setPickedChatId(id);
          navigate(`/app/ideascape/${id}`, { replace: true });
        }} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/50">
        <button
          onClick={() => navigate(`/app/chat/${activeChatId}`)}
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors text-muted"
          title={t("back_to_chat")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="text-xs text-muted">{t("back_to_chat_label")}</span>
      </div>
      <CanvasView chatId={activeChatId} />
    </div>
  );
}
