// components/chat/ChatSubagentsDrawer.tsx
// Three-option radio picker for per-chat subagent override.
// Mirrors iOS ChatSubagentsSheet: inherit / enabled / disabled.

import { useCallback } from "react";
import { X, Bot, CircleCheck, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";

// ─── Types ──────────────────────────────────────────────────────────────────

export type SubagentOverride = "inherit" | "enabled" | "disabled";

interface Props {
  selectedOverride: SubagentOverride;
  /** Whether subagents are effectively enabled (resolved from override + prefs) */
  isEffectivelyEnabled: boolean;
  isPro: boolean;
  onSelect: (override: SubagentOverride) => void;
  onClose: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ChatSubagentsDrawer({
  selectedOverride,
  isEffectivelyEnabled,
  isPro,
  onSelect,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const handleSelect = useCallback(
    (value: SubagentOverride) => {
      onSelect(value);
      onClose();
    },
    [onSelect, onClose],
  );

  const options: Array<{ value: SubagentOverride; title: string; subtitle: string }> = [
    { value: "inherit", title: t("use_chat_defaults"), subtitle: t("use_chat_defaults_subtitle") },
    { value: "enabled", title: t("always_on_in_this_chat"), subtitle: t("always_on_subagents_subtitle") },
    { value: "disabled", title: t("always_off_in_this_chat"), subtitle: t("always_off_subagents_subtitle") },
  ];

  const title = isEffectivelyEnabled ? t("subagents_on") : t("subagents");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg bg-surface-1 rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ maxHeight: "85vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Bot size={18} className="text-primary" />
            <h2 className="text-base font-semibold">{title}</h2>
            {isEffectivelyEnabled && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                {t("active")}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-3 text-muted hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Options */}
        <div className="px-5 py-4 space-y-1">
          {options.map((option) => {
            const isSelected = selectedOverride === option.value;
            const isProRequired = option.value === "enabled" && !isPro;

            return (
              <button
                key={option.value}
                onClick={() => {
                  if (isProRequired) return;
                  handleSelect(option.value);
                }}
                disabled={isProRequired}
                className={`w-full flex items-start gap-3 px-3 py-3 rounded-xl text-left transition-colors ${
                  isProRequired
                    ? "opacity-40 cursor-not-allowed"
                    : "hover:bg-surface-2 cursor-pointer"
                }`}
              >
                {isSelected ? (
                  <CircleCheck size={20} className="text-primary mt-0.5 shrink-0" />
                ) : (
                  <Circle size={20} className="text-muted mt-0.5 shrink-0" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {option.title}
                    {isProRequired && (
                      <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-500 font-medium">
                        Pro
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted mt-0.5">{option.subtitle}</div>
                </div>
              </button>
            );
          })}

          {/* Footer */}
          <p className="text-xs text-muted pt-3 px-3">
            {t("subagents_chat_wide_note")}
          </p>
        </div>
      </div>
    </div>
  );
}
