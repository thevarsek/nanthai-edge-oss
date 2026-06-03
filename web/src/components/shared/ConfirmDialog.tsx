import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/bodyScrollLock";

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmVariant?: "destructive" | "default";
  errorMessage?: string | null;
}

const dialogStack: symbol[] = [];

function pushDialog(id: symbol) {
  dialogStack.push(id);
}

function removeDialog(id: symbol) {
  const index = dialogStack.lastIndexOf(id);
  if (index >= 0) {
    dialogStack.splice(index, 1);
  }
}

function isTopDialog(id: symbol): boolean {
  return dialogStack[dialogStack.length - 1] === id;
}

/**
 * A modal confirmation dialog with keyboard support and a semi-transparent
 * backdrop.
 */
export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  confirmVariant = "destructive",
  errorMessage,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t("delete");
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const describedBy = errorMessage ? `${descriptionId} ${errorId}` : descriptionId;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const stackId = useRef(Symbol("ConfirmDialog"));

  useEffect(() => {
    if (!isOpen) return;
    const id = stackId.current;
    pushDialog(id);
    return () => removeDialog(id);
  }, [isOpen]);

  // Keyboard handling
  useEffect(() => {
    if (!isOpen) return;

    function handleKey(e: KeyboardEvent) {
      if (!isTopDialog(stackId.current)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable || focusable.length === 0) return;
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [isOpen]);

  // Prevent body scroll while open
  useEffect(() => {
    if (!isOpen) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      aria-modal="true"
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={describedBy}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div ref={panelRef} className="relative z-10 w-full max-w-sm mx-4 rounded-xl bg-surface-1 border border-border/20 shadow-2xl p-6 space-y-4">
        <h2
          id={titleId}
          className="text-base font-semibold text-foreground"
        >
          {title}
        </h2>

        <p id={descriptionId} className="text-sm text-muted leading-relaxed">
          {description}
        </p>

        {errorMessage && (
          <p id={errorId} role="alert" className="text-sm text-red-400 leading-relaxed">
            {errorMessage}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-secondary hover:bg-foreground/5 transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={cn(
              "px-4 py-2 text-sm rounded-lg font-medium transition-colors",
              confirmVariant === "destructive"
                ? "bg-destructive hover:bg-destructive/90 text-white"
                : "bg-primary hover:bg-primary/90 text-primary-foreground",
            )}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
