// components/chat/ChatParametersDrawer.tsx
// Slide-over panel for per-chat parameter overrides.
// Mirrors iOS ChatParametersView: temperature, max tokens, reasoning, reasoning effort.

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { X, SlidersHorizontal } from "lucide-react";
import { SegmentedControl } from "@/components/shared/SegmentedControl";
import { MenuSelect } from "@/components/shared/MenuSelect";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChatParameterOverrides {
  temperatureMode: "default" | "override";
  temperature: number;
  maxTokensMode: "default" | "override";
  maxTokens: number | undefined;
  reasoningMode: "default" | "on" | "off";
  reasoningEffort: "low" | "medium" | "high";
  autoAudioResponseMode: "default" | "on" | "off";
}

interface Props {
  overrides: ChatParameterOverrides;
  onChange: (overrides: ChatParameterOverrides) => void;
  onClose: () => void;
  /** Resolved defaults from preferences — shown in "Effective Preview" */
  defaults: {
    temperature: number;
    maxTokens: number | undefined;
    includeReasoning: boolean;
    reasoningEffort: string;
    autoAudioResponse: boolean;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function tempLabel(t: TFunction, temp: number): string {
  if (temp <= 0.3) return t("precise");
  if (temp <= 0.8) return t("balanced");
  if (temp <= 1.3) return t("creative");
  return t("wild");
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ChatParametersDrawer({ overrides, onChange, onClose, defaults }: Props) {
  const { t } = useTranslation();
  const [local, setLocal] = useState(overrides);

  // Sync in when prop changes (e.g. parent state updates)
  useEffect(() => { setLocal(overrides); }, [overrides]);

  const update = useCallback(
    (patch: Partial<ChatParameterOverrides>) => {
      const next = { ...local, ...patch };
      setLocal(next);
      onChange(next);
    },
    [local, onChange],
  );

  // Resolved effective values
  const effectiveTemp = local.temperatureMode === "override" ? local.temperature : defaults.temperature;
  const effectiveTokens = local.maxTokensMode === "override" ? local.maxTokens : defaults.maxTokens;
  const effectiveReasoning =
    local.reasoningMode === "default" ? defaults.includeReasoning : local.reasoningMode === "on";
  const effectiveEffort =
    local.reasoningMode === "default" ? defaults.reasoningEffort : local.reasoningEffort;
  const effectiveAutoAudioResponse =
    local.autoAudioResponseMode === "default"
      ? defaults.autoAudioResponse
      : local.autoAudioResponseMode === "on";

  const hasOverrides =
    local.temperatureMode === "override" ||
    local.maxTokensMode === "override" ||
    local.reasoningMode !== "default" ||
    local.autoAudioResponseMode !== "default";

  // Local text for max tokens input (allows empty field)
  const [maxTokensText, setMaxTokensText] = useState(
    local.maxTokens != null ? String(local.maxTokens) : "",
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg bg-surface-1 rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ maxHeight: "85vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={18} className="text-primary" />
            <h2 className="text-base font-semibold">{t("chat_parameters")}</h2>
            {hasOverrides && (
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

        <div className="px-5 py-4 space-y-5 overflow-y-auto" style={{ maxHeight: "calc(85vh - 4rem)" }}>
          {/* ── Temperature ──────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("temperature")}</span>
              <SegmentedControl
                value={local.temperatureMode}
                options={[
                  { value: "default" as const, label: t("chat_default") },
                  { value: "override" as const, label: t("override") },
                ]}
                onChange={(v) => update({ temperatureMode: v })}
              />
            </div>
            {local.temperatureMode === "override" && (
              <div className="space-y-1.5 pl-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">{t("temp_precise_end")}</span>
                  <span className="font-mono tabular-nums text-foreground">
                    {local.temperature.toFixed(1)} — {tempLabel(t, local.temperature)}
                  </span>
                  <span className="text-muted">{t("temp_creative_end")}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={local.temperature}
                  onChange={(e) => update({ temperature: parseFloat(e.target.value) })}
                  className="w-full h-2 cursor-pointer accent-primary"
                />
              </div>
            )}
          </section>

          {/* ── Max Tokens ───────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("max_tokens")}</span>
              <SegmentedControl
                value={local.maxTokensMode}
                options={[
                  { value: "default" as const, label: t("chat_default") },
                  { value: "override" as const, label: t("override") },
                ]}
                onChange={(v) => {
                  update({ maxTokensMode: v });
                  if (v === "default") setMaxTokensText("");
                }}
              />
            </div>
            {local.maxTokensMode === "override" && (
              <div className="pl-1">
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder={t("model_default_placeholder")}
                  value={maxTokensText}
                  onChange={(e) => {
                    const raw = e.target.value.replace(/[^0-9]/g, "");
                    setMaxTokensText(raw);
                    const parsed = raw ? parseInt(raw, 10) : undefined;
                    update({ maxTokens: parsed });
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-surface-3 border border-border/50 text-sm text-right font-mono tabular-nums focus:outline-none focus:border-primary/50 placeholder-muted"
                />
                <p className="text-xs text-muted mt-1">
                  {t("max_tokens_empty_hint")}
                </p>
              </div>
            )}
          </section>

          {/* ── Reasoning ────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("reasoning")}</span>
              <SegmentedControl
                value={local.reasoningMode}
                options={[
                  { value: "default" as const, label: t("default_label") },
                  { value: "on" as const, label: t("always_on") },
                  { value: "off" as const, label: t("always_off") },
                ]}
                onChange={(v) => update({ reasoningMode: v })}
              />
            </div>
            {(local.reasoningMode === "on" || (local.reasoningMode === "default" && defaults.includeReasoning)) && (
              <div className="flex items-center justify-between pl-1">
                <span className="text-sm text-muted">{t("reasoning_effort")}</span>
                <MenuSelect
                  value={local.reasoningMode === "default" ? defaults.reasoningEffort : local.reasoningEffort}
                  options={[
                    { value: "low", label: t("low") },
                    { value: "medium", label: t("medium") },
                    { value: "high", label: t("high") },
                  ]}
                  onChange={(v) =>
                    update({ reasoningEffort: v as "low" | "medium" | "high" })
                  }
                />
              </div>
            )}
          </section>

          {/* ── Auto Audio Reply ───────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{t("audio_auto_reply")}</span>
              <SegmentedControl
                value={local.autoAudioResponseMode}
                options={[
                  { value: "default" as const, label: t("default_label") },
                  { value: "on" as const, label: t("always_on") },
                  { value: "off" as const, label: t("always_off") },
                ]}
                onChange={(v) => update({ autoAudioResponseMode: v })}
              />
            </div>
          </section>

          {/* ── Effective Preview ─────────────────────────────── */}
          <section className="rounded-xl bg-surface-2 border border-border/30 p-4 space-y-2">
            <h3 className="text-xs font-medium text-muted uppercase tracking-wide mb-2">
              {t("effective_values")}
            </h3>
            <Row label={t("temperature")} value={effectiveTemp.toFixed(1)} />
            <Row label={t("max_tokens")} value={effectiveTokens != null ? effectiveTokens.toLocaleString() : t("model_default_placeholder")} />
            <Row label={t("include_reasoning")} value={effectiveReasoning ? t("yes") : t("no")} />
            {effectiveReasoning && (
              <Row label={t("reasoning_effort")} value={String(effectiveEffort).charAt(0).toUpperCase() + String(effectiveEffort).slice(1)} />
            )}
            <Row label={t("audio_auto_reply")} value={effectiveAutoAudioResponse ? t("yes") : t("no")} />
          </section>

          {/* Footer note */}
          <p className="text-xs text-muted">
            {t("parameters_override_note")}
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}
