import { ArrowUp, Pencil, X } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  text: string;
  isSendingNow?: boolean;
  actionsDisabled?: boolean;
  onEdit: () => void;
  onSendNow: () => void;
  onRemove: () => void;
}

export function PendingFollowUpCard({
  text,
  isSendingNow = false,
  actionsDisabled = false,
  onEdit,
  onSendNow,
  onRemove,
}: Props) {
  const { t } = useTranslation();
  const areActionsDisabled = isSendingNow || actionsDisabled;

  return (
    <div className="mb-2 flex items-center gap-3 rounded-2xl border border-border/40 bg-surface-2/70 px-3 py-2.5 backdrop-blur-sm">
      <p className="min-w-0 flex-1 text-sm text-foreground line-clamp-2">
        {text}
      </p>
      <button
        type="button"
        onClick={onEdit}
        disabled={areActionsDisabled}
        className="shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={t("edit_queued_message")}
        title={t("edit_queued_message")}
      >
        <Pencil size={16} />
      </button>
      <button
        type="button"
        onClick={onSendNow}
        disabled={areActionsDisabled}
        className="shrink-0 rounded-full p-1.5 text-accent transition-colors hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={t("send_now")}
        title={t("send_now")}
      >
        <ArrowUp size={16} />
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-surface-3 hover:text-foreground"
        aria-label={t("dismiss_queued_message")}
        title={t("dismiss_queued_message")}
      >
        <X size={16} />
      </button>
    </div>
  );
}
