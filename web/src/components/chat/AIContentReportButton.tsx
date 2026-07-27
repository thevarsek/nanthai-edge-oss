import { useEffect, useId, useRef, useState } from "react";
import { Check, Flag, Loader2 } from "lucide-react";
import { useMutation } from "convex/react";
import type { Id } from "@convex/_generated/dataModel";
import { api } from "@convex/_generated/api";
import { IconButton } from "@/components/shared/IconButton";
import { useToast } from "@/components/shared/Toast.context";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/bodyScrollLock";
import { convexErrorMessage } from "@/lib/convexErrors";
import { captureFeatureUsage } from "@/lib/featureAnalytics";
import { useTranslation } from "react-i18next";

const reportReasons = [
  "hate_or_harassment",
  "sexual_content",
  "violence_or_self_harm",
  "child_safety",
  "dangerous_or_illegal",
  "deceptive_or_misleading",
  "other",
] as const;

type ReportReason = (typeof reportReasons)[number];

interface AIContentReportButtonProps {
  messageId: Id<"messages">;
}

export function AIContentReportButton({ messageId }: AIContentReportButtonProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const submitReport = useMutation(api.content_reports.mutations.submit);
  const [isOpen, setIsOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReported, setIsReported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    lockBodyScroll();
    panelRef.current?.querySelector<HTMLElement>("input")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) {
        setIsOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unlockBodyScroll();
    };
  }, [isOpen, isSubmitting]);

  function closeDialog() {
    if (isSubmitting) return;
    setIsOpen(false);
    setError(null);
  }

  async function handleSubmit() {
    if (!reason || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await submitReport({
        messageId,
        reason,
        details: details.trim() || undefined,
        platform: "web",
        appVersion: import.meta.env.VITE_APP_VERSION,
      });
      captureFeatureUsage({
        feature_area: "safety",
        feature: "ai_content_reporting",
        action: "submitted",
        reason,
        message_id: messageId,
      });
      setIsReported(true);
      setIsOpen(false);
      toast({
        message: t(result.alreadyReported ? "ai_report_already_submitted" : "ai_report_submitted"),
        variant: "success",
      });
    } catch (caught) {
      setError(convexErrorMessage(caught, t("ai_report_failed")));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <IconButton
        label={isReported ? t("ai_report_submitted") : t("report_ai_content")}
        variant="ghost"
        size="xs"
        disabled={isReported}
        onClick={() => setIsOpen(true)}
      >
        {isReported ? <Check size={13} /> : <Flag size={13} />}
      </IconButton>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
        >
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-black/65 backdrop-blur-sm"
            aria-label={t("cancel")}
            onClick={closeDialog}
          />
          <div
            ref={panelRef}
            className="relative z-10 w-full max-w-md space-y-5 rounded-2xl border border-border/30 bg-surface-1 p-5 shadow-2xl"
          >
            <div className="space-y-1.5">
              <h2 id={titleId} className="text-base font-semibold text-foreground">
                {t("report_ai_content")}
              </h2>
              <p id={descriptionId} className="text-sm leading-relaxed text-muted">
                {t("ai_report_description")}
              </p>
            </div>

            <fieldset className="space-y-1">
              <legend className="sr-only">{t("ai_report_choose_reason")}</legend>
              {reportReasons.map((item) => (
                <label
                  key={item}
                  className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-foreground/[0.05]"
                >
                  <input
                    type="radio"
                    name="ai-content-report-reason"
                    value={item}
                    checked={reason === item}
                    onChange={() => setReason(item)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>{t(`ai_report_reason_${item}`)}</span>
                </label>
              ))}
            </fieldset>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">
                {t("ai_report_details_optional")}
              </span>
              <textarea
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                maxLength={1_000}
                rows={3}
                placeholder={t("ai_report_details_placeholder")}
                className="w-full resize-none rounded-xl border border-border/40 bg-background/60 px-3 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted/70 focus:border-primary/60"
              />
            </label>

            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDialog}
                disabled={isSubmitting}
                className="rounded-lg px-4 py-2 text-sm text-muted transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!reason || isSubmitting}
                className="inline-flex min-w-28 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting && <Loader2 size={14} className="animate-spin" />}
                {t("submit_report")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
