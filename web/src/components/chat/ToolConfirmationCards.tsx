import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { ExecutionProjection } from "@/hooks/useChat";
import { convexErrorMessage } from "@/lib/convexErrors";
import { formatConfirmationCountdown, pendingToolConfirmations } from "./toolConfirmationProjection";

type Decision = "approve" | "deny";

function Countdown({ expiresAt }: { expiresAt: number }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <p className="mt-2 text-xs text-muted">
      {t("tool_confirmation_countdown", { time: formatConfirmationCountdown(expiresAt, now) })}
    </p>
  );
}

function ChipList({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="mt-2">
      <p className="text-xs font-medium text-muted">{label}</p>
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {values.map((value) => (
          <li key={value} className="max-w-full truncate rounded-md bg-surface-2 px-2 py-0.5 text-xs text-foreground">
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Native Approve / Deny for consequential tool calls paused by the server. */
export function ToolConfirmationCards({ runs }: { runs: ExecutionProjection[] }) {
  const { t } = useTranslation();
  const respond = useMutation(api.tool_confirmations.mutations.respond);
  const [busy, setBusy] = useState<{ id: string; decision: Decision } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = pendingToolConfirmations(runs);
  if (pending.length === 0) return null;

  const answer = async (confirmationId: string, decision: Decision) => {
    setBusy({ id: confirmationId, decision });
    setErrors((current) => {
      const next = { ...current };
      delete next[confirmationId];
      return next;
    });
    try {
      await respond({ confirmationId: confirmationId as Id<"toolConfirmationRequests">, decision });
    } catch (cause) {
      setErrors((current) => ({
        ...current,
        [confirmationId]: convexErrorMessage(cause, t("tool_confirmation_response_failed")),
      }));
    } finally {
      setBusy((current) => current?.id === confirmationId ? null : current);
    }
  };

  return (
    <aside
      className="mx-auto max-h-[40vh] w-full max-w-3xl space-y-3 overflow-y-auto px-4 py-2"
      aria-label={t("tool_confirmation_requests")}
      data-ph-block
      data-ph-mask
    >
      {pending.map((request) => {
        const isBusy = busy?.id === request.confirmationId;
        const access = request.integrations.map((id) => id === "web_search" ? t("tool_confirmation_web_search") : id);
        return (
          <section
            key={request.confirmationId}
            className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4"
            data-testid="tool-confirmation-card"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-amber-500/10 p-2 text-amber-600 dark:text-amber-300">
                <ShieldCheck size={18} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-foreground">{t(`tool_confirmation_title_${request.kind}`)}</h2>
                <p className="mt-1 text-xs text-muted">{t(`tool_confirmation_help_${request.kind}`)}</p>
                <p className="mt-2 break-words text-sm font-medium text-foreground">{request.summary}</p>
                {request.detail && (
                  <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-sm text-foreground/85">{request.detail}</p>
                )}
                <ChipList label={t("tool_confirmation_recipients")} values={request.recipients} />
                <ChipList label={t("tool_confirmation_access")} values={access} />
                <p className="mt-2 font-mono text-[11px] text-muted">{request.toolName}</p>
              </div>
            </div>
            <Countdown expiresAt={request.expiresAt} />
            <div className="mt-3 flex flex-wrap gap-2">
              {(["approve", "deny"] as const).map((decision) => (
                <button
                  key={decision}
                  type="button"
                  onClick={() => void answer(request.confirmationId, decision)}
                  disabled={isBusy}
                  className={decision === "deny"
                    ? "rounded-lg bg-surface-2 px-3 py-2 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                    : "rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"}
                >
                  {isBusy && busy.decision === decision ? t("tool_confirmation_sending") : t(`tool_confirmation_${decision}`)}
                </button>
              ))}
            </div>
            {errors[request.confirmationId] && (
              <p role="alert" className="mt-3 text-xs text-destructive">{errors[request.confirmationId]}</p>
            )}
          </section>
        );
      })}
    </aside>
  );
}
