import { TeamWorkBoard } from "./TeamWorkBoard";
import type { Id } from "@convex/_generated/dataModel";
import { useState, type ReactNode } from "react";
import { Circle, CircleCheck, MessagesSquare, Users, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GroupBehavior } from "@/hooks/useCollaboration";

interface ConversationModeDrawerProps {
  chatId?: Id<"chats">;
  behavior: GroupBehavior;
  autonomousActive: boolean;
  hasMessages: boolean;
  isPro: boolean;
  isUpdating: boolean;
  error: string | null;
  onSelectBehavior: (behavior: GroupBehavior) => Promise<boolean>;
  autonomousControls: ReactNode;
  onClose: () => void;
}

export function ConversationModeDrawer({
  chatId,
  behavior,
  autonomousActive,
  hasMessages,
  isPro,
  isUpdating,
  error,
  onSelectBehavior,
  autonomousControls,
  onClose,
}: ConversationModeDrawerProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState<GroupBehavior | null>(null);
  const [selection, setSelection] = useState<GroupBehavior | "autonomous">(autonomousActive ? "autonomous" : behavior);
  const behaviorLocked = isUpdating || saving !== null;

  const selectBehavior = async (next: GroupBehavior) => {
    if (behaviorLocked || autonomousActive) return;
    setSaving(next);
    const changed = await onSelectBehavior(next);
    setSaving(null);
    if (changed) onClose();
  };


  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-3xl max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-surface-1 sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
          <div className="flex items-center gap-2">
            <MessagesSquare size={18} className="text-primary" />
            <h2 className="text-base font-semibold">{t("conversation_mode")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-2 px-5 py-4 sm:grid-cols-3" role="radiogroup" aria-label={t("conversation_mode")}>
          <BehaviorRow
            icon={<Users size={19} />}
            title={t("parallel_label")}
            description={t("parallel_description")}
            selected={selection === "parallel"}
            disabled={behaviorLocked}
            onClick={() => setSelection("parallel")}
          />
          <BehaviorRow
            icon={<MessagesSquare size={19} />}
            title={t("collaboration_label")}
            description={t("collaboration_description")}
            selected={selection === "collaboration"}
            disabled={behaviorLocked}
            onClick={() => setSelection("collaboration")}
          />
          <BehaviorRow
            icon={<Zap size={19} />}
            title={t("autonomous_discussion")}
            description={t("autonomous_mode_description")}
            selected={selection === "autonomous"}
            disabled={behaviorLocked}
            onClick={() => setSelection("autonomous")}
            suffix={!isPro ? "PRO" : undefined}
          />

          {autonomousActive && (
            <p className="sm:col-span-3 px-3 pt-2 text-xs text-muted">{t("conversation_mode_locked_autonomous")}</p>
          )}
          {error && <p className="sm:col-span-3 px-3 pt-2 text-xs text-destructive" role="alert">{error}</p>}
        </div>
        {selection === "collaboration" && chatId && <div className="px-5 py-4"><TeamWorkBoard chatId={chatId} embedded onStarted={onClose} /></div>}
        {selection === "autonomous" && isPro && !autonomousActive && autonomousControls}
        {selection === "autonomous" && !hasMessages && !isPro && <p className="px-5 pb-3 text-xs text-muted">{t("send_first_message_topic")}</p>}
        {selection !== "autonomous" && <div className="border-t border-border/50 px-5 py-4">
          <button type="button" disabled={behaviorLocked || autonomousActive} onClick={() => void selectBehavior(selection)} className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-40">{t("use_conversation_mode")}</button>
        </div>}
      </div>
    </div>
  );
}

function BehaviorRow({
  icon,
  title,
  description,
  selected,
  disabled,
  suffix,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  selected: boolean;
  disabled: boolean;
  suffix?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="mt-0.5 text-muted">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          {title}
          {suffix && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
              {suffix}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span>
      </span>
      {selected
        ? <CircleCheck size={19} className="mt-0.5 shrink-0 text-primary" />
        : <Circle size={19} className="mt-0.5 shrink-0 text-muted" />}
    </button>
  );
}
