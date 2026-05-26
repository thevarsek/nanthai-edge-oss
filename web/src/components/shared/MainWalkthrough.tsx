import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { useSharedData } from "@/hooks/useSharedData";
import { nextWalkthroughSelection } from "./MainWalkthrough.utils";
import {
  PenSquare,
  Star,
  PlusCircle,
  GitBranch,
  Globe,
  UserCircle,
  X,
} from "lucide-react";

const CARD_ICONS = [PenSquare, Star, PlusCircle, GitBranch, Globe, UserCircle];
const CARD_TINTS = [
  "text-[--nanth-primary] border-[--nanth-primary]/40 bg-[--nanth-primary]/10",
  "text-orange-400 border-orange-400/40 bg-orange-400/10",
  "text-[--nanth-primary] border-[--nanth-primary]/40 bg-[--nanth-primary]/10",
  "text-purple-400 border-purple-400/40 bg-purple-400/10",
  "text-green-400 border-green-400/40 bg-green-400/10",
  "text-[--nanth-primary] border-[--nanth-primary]/40 bg-[--nanth-primary]/10",
];

export function MainWalkthrough() {
  const { t } = useTranslation();
  const { prefs } = useSharedData();
  const upsertPreferences = useMutation(api.preferences.mutations.upsertPreferences);
  const [selection, setSelection] = useState(0);
  const [visible, setVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  const CARDS = [
    { title: t("walkthrough_card1_title"), body: t("walkthrough_card1_body"), tint: CARD_TINTS[0], icon: CARD_ICONS[0] },
    { title: t("walkthrough_card2_title"), body: t("walkthrough_card2_body"), tint: CARD_TINTS[1], icon: CARD_ICONS[1] },
    { title: t("walkthrough_card3_title"), body: t("walkthrough_card3_body"), tint: CARD_TINTS[2], icon: CARD_ICONS[2] },
    { title: t("walkthrough_card4_title"), body: t("walkthrough_card4_body"), tint: CARD_TINTS[3], icon: CARD_ICONS[3] },
    { title: t("walkthrough_card5_title"), body: t("walkthrough_card5_body"), tint: CARD_TINTS[4], icon: CARD_ICONS[4] },
    { title: t("walkthrough_card6_title"), body: t("walkthrough_card6_body"), tint: CARD_TINTS[5], icon: CARD_ICONS[5] },
  ];

  const typedPrefs = prefs as { hasSeenMainWalkthrough?: boolean } | undefined;

  useEffect(() => {
    if (typedPrefs === undefined) return;
    if (!typedPrefs.hasSeenMainWalkthrough) {
      // Small delay so the layout renders first.
      const timer = setTimeout(() => setVisible(true), 600);
      return () => clearTimeout(timer);
    }
  }, [typedPrefs]);

  const dismiss = useCallback(() => {
    setVisible(false);
    void upsertPreferences({ hasSeenMainWalkthrough: true });
  }, [upsertPreferences]);

  useEffect(() => {
    if (!visible) return;
    cardRef.current?.querySelector<HTMLElement>("button")?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dismiss, visible]);

  if (!visible) return null;

  const card = CARDS[selection];
  const Icon = card.icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center pb-8 md:items-center md:pb-0 pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby="main-walkthrough-title"
    >
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/20 pointer-events-auto"
        onClick={dismiss}
      />

      {/* Card */}
      <div ref={cardRef} className="relative w-[420px] max-w-[calc(100vw-2rem)] rounded-3xl border border-white/10 bg-surface-1/95 backdrop-blur-xl shadow-[0_20px_50px_rgba(0,0,0,0.28)] p-5 pointer-events-auto animate-fade-in">
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <h2 id="main-walkthrough-title" className="text-sm font-semibold flex-1">{t("walkthrough_header")}</h2>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("dismiss")}
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-surface-2"
          >
            <X size={16} />
          </button>
        </div>

        {/* Card content */}
        <div className={`rounded-2xl border p-4 min-h-[240px] ${card.tint}`}>
          {/* Icon illustration */}
          <div className="h-24 rounded-2xl mb-4 flex items-center justify-center bg-gradient-to-br from-white/10 to-black/10 relative overflow-hidden">
            <div className="absolute inset-0 opacity-40 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_45%)]" />
            <Icon size={44} className="relative opacity-65" />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              {card.title}
            </h3>
            <p className="text-sm text-muted leading-relaxed">{card.body}</p>
          </div>
        </div>

        {/* Page control + nav */}
        <div className="flex items-center gap-2 mt-4">
          <div className="flex items-center gap-2 flex-1">
            {CARDS.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setSelection(index)}
                className={`h-2 rounded-full transition-all ${
                  index === selection
                    ? "w-5 bg-[--nanth-primary]"
                    : "w-2 bg-white/20"
                }`}
                aria-label={`Go to card ${index + 1}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              selection === CARDS.length - 1
                ? dismiss()
                : setSelection((s) => nextWalkthroughSelection(s, CARDS.length))
            }
            className="text-xs font-semibold text-[--nanth-primary] hover:opacity-80"
          >
            {selection === CARDS.length - 1 ? t("done") : t("next")}
          </button>
        </div>

        <div className="mt-3 text-[11px] text-muted">
          {t("walkthrough_footer")}
        </div>
      </div>
    </div>
  );
}
