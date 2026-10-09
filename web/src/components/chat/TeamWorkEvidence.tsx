import { useEffect, useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MarkdownRenderer } from "./MarkdownRenderer";

export function TeamWorkEvidence({ messageId, onClose }: { messageId: Id<"messages">; onClose: () => void }) {
  const { t } = useTranslation();
  const message = useQuery(api.chat.queries.getMessage, { messageId });
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    return () => { previousFocus?.focus(); };
  }, []);
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter(element => !element.hasAttribute("disabled") && element.tabIndex !== -1);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }
  return <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("cw_evidence")} onKeyDown={handleKeyDown} className="fixed inset-4 z-50 overflow-auto rounded-xl border border-border bg-background p-5 shadow-xl">
    <button ref={closeRef} type="button" className="float-right" onClick={onClose}>{t("cw_close_evidence")}</button>
    <h2 className="mb-4 font-semibold">{t("cw_evidence")}</h2>
    {message === undefined ? <p>{t("cw_loading_evidence")}</p> : message
      ? <MarkdownRenderer content={message.content} /> : <p>{t("cw_unavailable_evidence")}</p>}
  </div>;
}
