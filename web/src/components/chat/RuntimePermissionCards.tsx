import { RuntimeQuestionCountdown } from "./RuntimeQuestionCountdown";
import { RuntimeInputFormCard } from "./RuntimeInputFormCard";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Layers, Loader2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { Participant } from "@/hooks/useChat";
import { convexErrorMessage } from "@/lib/convexErrors";

type VisibleDecision = "allow_once" | "allow_session" | "deny" | "cancel";

const decisionOrder: VisibleDecision[] = ["allow_once", "allow_session", "deny", "cancel"];

function decisionLabelKey(decision: VisibleDecision): string {
  if (decision === "allow_once") return "runtime_permission_allow_once";
  if (decision === "allow_session") return "runtime_permission_allow_session";
  if (decision === "cancel") return "runtime_permission_cancel_request";
  return "runtime_permission_deny";
}

function unavailableLabelKey(reason: string | undefined): string | null {
  if (!reason) return null;
  return `runtime_permission_unavailable_${reason}`;
}

function participantName(
  chatParticipantId: Id<"chatParticipants"> | undefined,
  participants: Participant[],
): string | null {
  if (!chatParticipantId) return null;
  const participant = participants.find((candidate) =>
    candidate.id === String(chatParticipantId)
  );
  return participant?.personaName?.trim()
    || participant?.modelId.split("/").pop()
    || null;
}

export function RuntimePermissionCards({
  chatId,
  participants,
}: {
  chatId: Id<"chats">;
  participants: Participant[];
}) {
  const { t } = useTranslation();
  const pending = useQuery(api.runtime_host.permissions.listMyPending, { chatId });
  const respond = useMutation(api.runtime_host.permissions.respond);
  const [busy, setBusy] = useState<{
    requestId: string;
    decision: VisibleDecision;
  } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  if (!pending || pending.length === 0) return null;

  const answer = async (requestId: Id<"runtimePermissionRequests">, decision: VisibleDecision) => {
    const key = String(requestId);
    setBusy({ requestId: key, decision });
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      await respond({ requestId, decision });
    } catch (cause) {
      setErrors((current) => ({
        ...current,
        [key]: convexErrorMessage(cause, t("runtime_permission_response_failed")),
      }));
    } finally {
      setBusy((current) => current?.requestId === key ? null : current);
    }
  };

  return (
    <aside
      className="mx-auto max-h-[40vh] w-full max-w-3xl space-y-3 overflow-y-auto px-4 py-2"
      aria-label={t("runtime_permission_requests")}
      data-ph-block
      data-ph-mask
    >
      {pending.map((request) => {
        const requestKey = String(request.requestId);
        const name = participantName(request.chatParticipantId, participants);
        const choices = decisionOrder.filter((decision) => request.choices.includes(decision));
        const isBusy = busy?.requestId === requestKey;
        const unavailableKey = unavailableLabelKey(request.unavailableReason);
        return (
          <section
            key={request.requestId}
            className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-amber-500/10 p-2 text-amber-600 dark:text-amber-300">
                <ShieldCheck size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold text-foreground">
                  {request.inputForm ? t("remote_mcp_server_needs_input") : name
                    ? t("runtime_permission_named_title", { name })
                    : t("runtime_permission_title")}
                </h2>
                {request.nativeAgent?.origin === "codex_native_agent" && (
                  <p
                    className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted"
                    title={request.nativeAgent.nativeThreadId}
                    data-testid="runtime-permission-native-agent"
                  >
                    <Layers size={12} className="shrink-0" aria-hidden="true" />
                    <span className="shrink-0">{t("runtime_permission_native_agent_origin")}</span>
                    <span aria-hidden="true">·</span>
                    <span className="min-w-0 truncate">{request.nativeAgent.label}</span>
                  </p>
                )}
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground/85">
                  {request.prompt}
                </p>
              </div>
            </div>

            <RuntimeQuestionCountdown deadline={request.automaticResponseAt} automatic={request.responseSource === "automatic"} />
            {request.inputForm && <RuntimeInputFormCard requestId={request.requestId} form={request.inputForm} canRespond={request.canRespond} />}

            {request.choices.includes("allow_session") && (
              <p className="mt-3 text-xs text-muted">
                {t("runtime_permission_allow_session_help")}
              </p>
            )}

            {request.requestedDecision ? (
              <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted">
                <Loader2 size={13} className="animate-spin" />
                {t("runtime_permission_response_pending", {
                  decision: t(decisionLabelKey(request.requestedDecision)),
                })}
              </p>
            ) : request.canRespond && choices.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {choices.map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    onClick={() => void answer(request.requestId, decision)}
                    disabled={isBusy}
                    className={decision === "deny"
                      ? "rounded-lg bg-surface-2 px-3 py-2 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
                      : decision === "cancel"
                        ? "rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted transition-colors hover:bg-surface-3 disabled:opacity-50"
                        : "rounded-lg bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"}
                  >
                    {isBusy && busy.decision === decision
                      ? t("runtime_permission_sending")
                      : t(decisionLabelKey(decision))}
                  </button>
                ))}
              </div>
            ) : null}

            {!request.canRespond && !request.requestedDecision && unavailableKey && (
              <p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-300">
                {t(unavailableKey)}
              </p>
            )}
            {errors[requestKey] && (
              <p role="alert" className="mt-3 text-xs text-destructive">
                {errors[requestKey]}
              </p>
            )}
          </section>
        );
      })}
    </aside>
  );
}
