import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import { useSharedData } from "@/hooks/useSharedData";

export function ModelSettingsEditor({ modelId }: { modelId: string }) {
  const { t } = useTranslation();
  const { modelSettings } = useSharedData();
  const upsertModelSettings = useMutation(api.preferences.mutations.upsertModelSettings);
  const deleteModelSettings = useMutation(api.preferences.mutations.deleteModelSettings);
  const existing = useMemo(
    () => modelSettings?.find((setting) => setting.openRouterId === modelId) ?? null,
    [modelId, modelSettings],
  );

  const [hasCustomSettings, setHasCustomSettings] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokensText, setMaxTokensText] = useState("");
  const [includeReasoning, setIncludeReasoning] = useState(true);
  const [reasoningEffort, setReasoningEffort] = useState("medium");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHasCustomSettings(existing != null);
    setTemperature(existing?.temperature ?? 0.7);
    setMaxTokensText(existing?.maxTokens != null ? String(existing.maxTokens) : "");
    setIncludeReasoning(existing?.includeReasoning ?? true);
    setReasoningEffort(existing?.reasoningEffort ?? "medium");
    setError(null);
  }, [existing, modelId]);

  async function handleSave() {
    if (isSaving) return;
    if (maxTokensText && !/^\d+$/.test(maxTokensText)) {
      setError("Max tokens must be a whole number.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      if (!hasCustomSettings) {
        if (existing) {
          await deleteModelSettings({ openRouterId: modelId });
        }
        return;
      }

      await upsertModelSettings({
        openRouterId: modelId,
        temperature,
        maxTokens: maxTokensText ? parseInt(maxTokensText, 10) : null,
        includeReasoning,
        reasoningEffort,
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t("something_went_wrong"));
    } finally {
      setIsSaving(false);
    }
  }

  function resetDraft() {
    setHasCustomSettings(existing != null);
    setTemperature(existing?.temperature ?? 0.7);
    setMaxTokensText(existing?.maxTokens != null ? String(existing.maxTokens) : "");
    setIncludeReasoning(existing?.includeReasoning ?? true);
    setReasoningEffort(existing?.reasoningEffort ?? "medium");
    setError(null);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-xs font-medium text-muted uppercase tracking-wide">
            Model Settings
          </h3>
          <p className="mt-1 text-xs text-muted">
            Save defaults for this model across web and mobile.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={hasCustomSettings}
            onChange={(event) => setHasCustomSettings(event.target.checked)}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
          />
          <span>Custom</span>
        </label>
      </div>

      {hasCustomSettings && (
        <div className="rounded-xl bg-surface-2 border border-border/40 p-3 space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span>{t("temperature")}</span>
              <span className="font-mono tabular-nums text-muted">{temperature.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="2"
              step="0.1"
              value={temperature}
              onChange={(event) => setTemperature(parseFloat(event.target.value))}
              className="w-full h-2 cursor-pointer accent-accent"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm" htmlFor={`model-max-tokens-${modelId}`}>
              {t("max_tokens")}
            </label>
            <input
              id={`model-max-tokens-${modelId}`}
              type="text"
              inputMode="numeric"
              placeholder={t("default_label")}
              value={maxTokensText}
              onChange={(event) => setMaxTokensText(event.target.value.replace(/[^0-9]/g, ""))}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border/50 text-sm text-right font-mono tabular-nums focus:outline-none focus:border-accent"
            />
          </div>

          <label className="flex items-center justify-between gap-3 text-sm">
            <span>{t("include_reasoning")}</span>
            <input
              type="checkbox"
              checked={includeReasoning}
              onChange={(event) => setIncludeReasoning(event.target.checked)}
              className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
            />
          </label>

          {includeReasoning && (
            <div className="space-y-1.5">
              <label className="text-sm" htmlFor={`reasoning-effort-${modelId}`}>
                {t("reasoning_effort")}
              </label>
              <select
                id={`reasoning-effort-${modelId}`}
                value={reasoningEffort}
                onChange={(event) => setReasoningEffort(event.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-background border border-border/50 text-sm focus:outline-none focus:border-accent"
              >
                <option value="low">{t("low")}</option>
                <option value="medium">{t("medium")}</option>
                <option value="high">{t("high")}</option>
              </select>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={resetDraft}
          className="px-3 py-1.5 rounded-lg text-sm text-muted hover:text-foreground hover:bg-surface-2 transition-colors"
        >
          {t("reset")}
        </button>
        <button
          type="button"
          onClick={() => { void handleSave(); }}
          disabled={isSaving}
          className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90 disabled:opacity-60 transition-colors"
        >
          {isSaving ? `${t("save")}...` : t("save")}
        </button>
      </div>
    </div>
  );
}
