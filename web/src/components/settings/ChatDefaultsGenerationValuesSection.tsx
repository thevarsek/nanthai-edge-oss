import { useTranslation } from "react-i18next";
import { MenuSelect } from "@/components/shared/MenuSelect";
import { Toggle } from "@/components/shared/Toggle";
import { SectionHeader } from "./ChatDefaultsSection.helpers";
import { useOptimistic } from "./ChatDefaultsSection.utils";

interface Preferences {
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  includeReasoning?: boolean;
  reasoningEffort?: string;
}

interface Props {
  prefs?: Preferences | null;
  updatePreference: (patch: Record<string, unknown>) => void;
  updatePreferenceImmediate: (patch: Record<string, unknown>) => void;
}

export function ChatDefaultsGenerationValuesSection({
  prefs,
  updatePreference,
  updatePreferenceImmediate,
}: Props) {
  const { t } = useTranslation();
  const [temperature, setTemperature] = useOptimistic(prefs?.defaultTemperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useOptimistic<number | undefined>(prefs?.defaultMaxTokens);
  const [reasoningEffort, setReasoningEffort] = useOptimistic(prefs?.reasoningEffort ?? "medium");

  return (
    <>
      <SectionHeader>Generation Values</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm">{t("temperature")}</label>
            <span className="text-sm font-mono tabular-nums text-muted min-w-[2.5rem] text-right">{temperature.toFixed(1)}</span>
          </div>
          <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(event) => {
            const value = Number.parseFloat(event.target.value);
            setTemperature(value);
            updatePreference({ defaultTemperature: value });
          }} className="w-full h-2 cursor-pointer" />
          <div className="flex justify-between text-[11px] text-muted">
            <span>0 — {t("precise")}</span><span>1 — {t("balanced")}</span><span>{t("creative")} — 2</span>
          </div>
        </div>
        <div className="flex items-center justify-between gap-6 px-4 py-3">
          <div className="flex-1 w-40 shrink-0">
            <label className="text-sm">{t("max_tokens")}</label>
            <p className="text-[11px] text-muted mt-0.5">{t("max_tokens_empty_hint")}</p>
          </div>
          <input type="text" inputMode="numeric" placeholder={t("model_default_placeholder")} value={maxTokens == null ? "" : String(maxTokens)} onChange={(event) => {
            const raw = event.target.value.replace(/[^0-9]/g, "");
            const value = raw ? Number.parseInt(raw, 10) : undefined;
            setMaxTokens(value);
            updatePreference({ defaultMaxTokens: value ?? null });
          }} className="w-28 px-2.5 py-1.5 rounded-lg bg-surface-3 text-sm text-right border border-border/50 focus:outline-none focus:border-accent font-mono tabular-nums placeholder-muted" />
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <label className="text-sm">{t("include_reasoning")}</label>
          <Toggle checked={prefs?.includeReasoning ?? false} onChange={(value) => updatePreferenceImmediate({ includeReasoning: value })} />
        </div>
        {prefs?.includeReasoning && (
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <label className="text-sm w-40 shrink-0">{t("reasoning_effort")}</label>
            <MenuSelect value={reasoningEffort} options={[{ value: "low", label: t("low") }, { value: "medium", label: t("medium") }, { value: "high", label: t("high") }]} onChange={(value) => {
              setReasoningEffort(value);
              updatePreferenceImmediate({ reasoningEffort: value });
            }} />
          </div>
        )}
      </div>
    </>
  );
}
