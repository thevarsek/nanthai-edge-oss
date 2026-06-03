// web/src/components/shared/PaywallModal.tsx
// =============================================================================
// Pro paywall modal — shown when a free user taps a Pro-gated feature.
// Displays the 8-feature Pro grid and redirects to Stripe Checkout.
// =============================================================================

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  X,
  Sparkles,
  Brain,
  CalendarClock,
  Search,
  Wrench,
  FolderKanban,
  BookOpen,
  Zap,
} from "lucide-react";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/bodyScrollLock";

// ─── Pro feature list (same 8 features as iOS) ──────────────────────────────

const PRO_FEATURE_ICONS = [Sparkles, Brain, CalendarClock, Search, Wrench, FolderKanban, BookOpen, Zap] as const;

// ─── Props ───────────────────────────────────────────────────────────────────

interface PaywallModalProps {
  /** Feature name that triggered the paywall — shown in the heading */
  feature?: string;
  onClose: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PaywallModal({ feature, onClose }: PaywallModalProps) {
  const { t } = useTranslation();
  const createCheckoutSession = useAction(api.stripe.actions.createCheckoutSession);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isLaunchingCheckout = useRef(false);
  const isClosedOrUnmounted = useRef(false);
  const isMounted = useRef(false);

  useEffect(() => {
    isMounted.current = true;
    lockBodyScroll();
    closeButtonRef.current?.focus();
    return () => {
      isMounted.current = false;
      isClosedOrUnmounted.current = true;
      unlockBodyScroll();
    };
  }, []);

  function requestClose() {
    isClosedOrUnmounted.current = true;
    onClose();
  }

  const PRO_FEATURES = [
    { icon: PRO_FEATURE_ICONS[0], title: t("personas"), description: t("paywall_personas_description") },
    { icon: PRO_FEATURE_ICONS[1], title: t("memory"), description: t("paywall_memory_description") },
    { icon: PRO_FEATURE_ICONS[2], title: t("scheduled_jobs"), description: t("paywall_scheduled_jobs_description") },
    { icon: PRO_FEATURE_ICONS[3], title: t("advanced_search"), description: t("paywall_advanced_search_description") },
    { icon: PRO_FEATURE_ICONS[4], title: t("ai_tools"), description: t("paywall_ai_tools_description") },
    { icon: PRO_FEATURE_ICONS[5], title: t("ideascapes"), description: t("paywall_ideascapes_description") },
    { icon: PRO_FEATURE_ICONS[6], title: t("knowledge_base"), description: t("paywall_knowledge_base_description") },
    { icon: PRO_FEATURE_ICONS[7], title: t("provider_connections"), description: t("paywall_provider_connections_description") },
  ];

  async function handleUpgrade() {
    if (isLaunchingCheckout.current) return;
    isLaunchingCheckout.current = true;
    isClosedOrUnmounted.current = false;
    setIsLoading(true);
    setError(null);
    try {
      const { url } = await createCheckoutSession({});
      if (isClosedOrUnmounted.current) {
        isLaunchingCheckout.current = false;
        if (isMounted.current) {
          setIsLoading(false);
        }
        return;
      }
      window.location.href = url;
    } catch {
      isLaunchingCheckout.current = false;
      if (isClosedOrUnmounted.current || !isMounted.current) return;
      setError(t("checkout_failed_try_again", "Checkout could not be started. Please try again."));
      setIsLoading(false);
    }
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => !element.hasAttribute("disabled") && element.tabIndex !== -1);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeElement = document.activeElement;

    if (event.shiftKey) {
      if (activeElement === first || !dialogRef.current?.contains(activeElement)) {
        event.preventDefault();
        last.focus();
      }
    } else if (activeElement === last || !dialogRef.current?.contains(activeElement)) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    // Backdrop
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paywall-title"
      onKeyDown={handleDialogKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="relative w-full max-w-lg bg-secondary rounded-2xl shadow-2xl border border-border overflow-hidden">
        {/* Close button */}
        <button
          ref={closeButtonRef}
          type="button"
          onClick={requestClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-foreground/60 hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Close paywall"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="px-6 pt-8 pb-4 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/15 mb-4">
            <Sparkles className="w-7 h-7 text-primary" />
          </div>
          <h2
            id="paywall-title"
            className="text-xl font-semibold text-foreground"
          >
            {feature ? t("unlock_arg", { var1: feature }) : t("upgrade_to_nanthai_pro")}
          </h2>
          <p className="mt-1 text-sm text-foreground/60">
            {t("one_time_purchase")}
          </p>
        </div>

        {/* Feature grid */}
        <div className="px-6 pb-2 grid grid-cols-2 gap-3">
          {PRO_FEATURES.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="flex items-start gap-2.5 p-3 rounded-xl bg-muted border border-border"
            >
              <div className="shrink-0 mt-0.5">
                <Icon className="w-4 h-4 text-primary" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium text-foreground leading-snug">
                  {title}
                </p>
                <p className="text-[11px] text-foreground/50 leading-snug mt-0.5">
                  {description}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="px-6 pt-4 pb-6 space-y-3">
          {error && (
            <p className="text-xs text-destructive text-center" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={handleUpgrade}
            disabled={isLoading}
            className="w-full py-3 px-4 rounded-xl text-sm font-semibold bg-primary text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {isLoading ? t("redirecting_to_checkout") : t("get_nanthai_pro")}
          </button>
          <p className="text-center text-[11px] text-foreground/40">
            {t("already_purchased")}{" "}
            <button
              type="button"
              onClick={requestClose}
              className="underline hover:text-foreground/70 transition-colors"
            >
              {t("restore_purchase")}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
