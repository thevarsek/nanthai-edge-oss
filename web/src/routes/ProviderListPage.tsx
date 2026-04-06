import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { ChevronLeft, Search } from "lucide-react";
import { useModelSummaries, useSharedData } from "@/hooks/useSharedData";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { Toggle } from "@/components/shared/Toggle";
import { ProviderLogo } from "@/components/shared/ProviderLogo";
import { Defaults } from "@/lib/constants";
import { DEFAULT_MEMORY_EXTRACTION_MODEL_ID, TITLE_GENERATION_MODEL_ID } from "@/lib/modelDefaults";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ProviderInfo {
  id: string;
  displayName: string;
  modelCount: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatProviderName(slug: string): string {
  const uppercaseAbbreviations = new Set(["ai", "ibm", "nvidia"]);
  return slug
    .split("-")
    .map((word) => {
      const lower = word.toLowerCase();
      if (uppercaseAbbreviations.has(lower)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

// ─── Conflict Dialog ─────────────────────────────────────────────────────────

function ConflictDialog({
  conflicts,
  onConfirm,
  onCancel,
}: {
  conflicts: string[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onCancel}
      />
      <div className="relative bg-surface-1 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-xl">
        <h3 className="text-base font-semibold">{t("conflict_dialog_heading")}</h3>
        <ul className="space-y-1">
          {conflicts.map((c, i) => (
            <li key={i} className="text-sm text-muted">
              • {c}
            </li>
          ))}
        </ul>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm bg-surface-2 hover:bg-surface-3 transition-colors"
          >
            {t("cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm bg-red-500 text-white hover:bg-red-600 transition-colors"
          >
            {t("disable_anyway")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function ProviderListPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { prefs, personas } = useSharedData();
  const modelSummaries = useModelSummaries();
  const updatePrefs = useMutation(api.preferences.mutations.upsertPreferences);

  const [search, setSearch] = useState("");
  const [pendingDisable, setPendingDisable] = useState<{
    providerId: string;
    conflicts: string[];
  } | null>(null);

  const disabledProviders: string[] = useMemo(
    () => (prefs?.disabledProviders as string[] | undefined) ?? [],
    [prefs],
  );

  // Build provider list from model summaries
  const allProviders: ProviderInfo[] = useMemo(() => {
    if (!modelSummaries) return [];
    const counts = new Map<string, number>();
    for (const m of modelSummaries) {
      const p =
        (m.provider as string | undefined) ||
        (typeof m.modelId === "string" && m.modelId.includes("/") ? m.modelId.split("/")[0] : "");
      if (!p) continue;
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([id, modelCount]) => ({
        id,
        displayName: formatProviderName(id),
        modelCount,
      }))
      .sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, {
          sensitivity: "base",
        }),
      );
  }, [modelSummaries]);

  const filteredProviders = useMemo(() => {
    if (!search) return allProviders;
    const q = search.toLowerCase();
    return allProviders.filter(
      (p) =>
        p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
    );
  }, [allProviders, search]);

  const enabledCount = useMemo(() => {
    const knownIds = new Set(allProviders.map((p) => p.id));
    const disabledKnown = disabledProviders.filter((id) => knownIds.has(id));
    return allProviders.length - disabledKnown.length;
  }, [allProviders, disabledProviders]);

  // Check if disabling a provider would conflict with current settings
  function checkConflicts(providerId: string): string[] {
    const reasons: string[] = [];

    const providerOf = (modelId: string | undefined | null): string | null => {
      if (!modelId) return null;
      const found = modelSummaries?.find((m) => m.modelId === modelId);
      if (found?.provider) return found.provider as string;
      const slash = modelId.indexOf("/");
      return slash > 0 ? modelId.substring(0, slash) : null;
    };

    const defaultModelId = (prefs?.defaultModelId as string | undefined) ?? Defaults.model;
    if (providerOf(defaultModelId) === providerId) {
      reasons.push(t("conflict_default_model"));
    }

    const titleModelId = (prefs?.titleModelId as string | undefined) ?? TITLE_GENERATION_MODEL_ID;
    if (providerOf(titleModelId) === providerId) {
      reasons.push(t("conflict_title_model"));
    }

    const memoryExtractionModelId =
      (prefs?.memoryExtractionModelId as string | undefined) ?? DEFAULT_MEMORY_EXTRACTION_MODEL_ID;
    if (providerOf(memoryExtractionModelId) === providerId) {
      reasons.push(t("conflict_memory_model"));
    }

    // Check persona model references
    if (personas) {
      const affectedPersonas = personas.filter(
        (p) => p.modelId && providerOf(p.modelId as string) === providerId,
      );
      if (affectedPersonas.length === 1) {
        const name = (affectedPersonas[0].displayName as string) || "a persona";
        reasons.push(t("conflict_one_persona", { name }));
      } else if (affectedPersonas.length > 1) {
        reasons.push(t("conflict_n_personas", { count: affectedPersonas.length }));
      }
    }

    return reasons;
  }

  const handleToggle = (providerId: string, wantsEnabled: boolean) => {
    if (!wantsEnabled) {
      // Disabling — check conflicts first
      const conflicts = checkConflicts(providerId);
      if (conflicts.length > 0) {
        setPendingDisable({ providerId, conflicts });
        return;
      }
      commitDisable(providerId);
    } else {
      // Enabling — remove from disabled list
      const next = disabledProviders.filter((id) => id !== providerId);
      void updatePrefs({ disabledProviders: next });
    }
  };

  const commitDisable = (providerId: string) => {
    const next = [...disabledProviders.filter((id) => id !== providerId), providerId];
    void updatePrefs({ disabledProviders: next });
    setPendingDisable(null);
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-border/50">
        <button
          onClick={() => navigate("/app/settings")}
          className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <h1 className="text-lg font-semibold flex-1">{t("providers")}</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              placeholder={t("search_providers_placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl bg-surface-2 text-sm border border-border/50 focus:outline-none focus:border-accent"
            />
          </div>

          {/* Provider list */}
          {modelSummaries === undefined ? (
            <div className="flex justify-center py-8">
              <LoadingSpinner />
            </div>
          ) : (
            <>
              <p className="text-xs text-muted px-1">
                {t("num_of_num_providers_enabled", { var1: enabledCount, var2: allProviders.length })}
              </p>
              <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
                {filteredProviders.map((provider) => {
                  const isEnabled = !disabledProviders.includes(provider.id);
                  return (
                    <div
                      key={provider.id}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <ProviderLogo slug={provider.id} size={32} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{provider.displayName}</p>
                        <p className="text-xs text-muted">
                          {t("model_count", { count: provider.modelCount })}
                        </p>
                      </div>
                      <Toggle
                        checked={isEnabled}
                        onChange={(wantsEnabled) =>
                          handleToggle(provider.id, wantsEnabled)
                        }
                      />
                    </div>
                  );
                })}
                  {filteredProviders.length === 0 && (
                    <div className="px-4 py-8 text-center text-sm text-muted">
                      {search ? t("no_providers_match") : t("no_providers_found")}
                    </div>
                  )}
              </div>
              <p className="text-xs text-muted px-1">
                {t("disabled_providers_footer")}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Conflict dialog */}
      {pendingDisable && (
        <ConflictDialog
          conflicts={pendingDisable.conflicts}
          onConfirm={() => commitDisable(pendingDisable.providerId)}
          onCancel={() => setPendingDisable(null)}
        />
      )}
    </div>
  );
}
