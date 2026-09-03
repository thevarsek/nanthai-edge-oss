// ChatDefaultsSection.tsx
// Settings section for chat defaults: participant, generation params, search,
// delegation, behaviour, audio, title model, and quick launch.
// Sub-components extracted to ChatDefaultsSection.helpers.tsx and
// ChatDefaultsSection.ParticipantPicker.tsx to stay under 300 lines.

import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  ChevronRight, Globe, Star, Type,
  Search as SearchIcon, Layers,
} from "lucide-react";
import { useModelSummaries, useSharedData } from "@/hooks/useSharedData";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";
import { ProviderLogo } from "@/components/shared/ProviderLogo";
import { usePreferenceBuffer } from "@/hooks/usePreferenceBuffer";
import { useProGate } from "@/hooks/useProGate.hook";
import { ModelPicker } from "@/components/shared/ModelPicker";
import { MenuSelect } from "@/components/shared/MenuSelect";
import { SegmentedControl } from "@/components/shared/SegmentedControl";
import { ProBadge } from "@/components/shared/ProBadge";
import { Toggle } from "@/components/shared/Toggle";
import { PaywallModal } from "@/components/shared/PaywallModal";
import { SectionHeader, SectionFooter } from "./ChatDefaultsSection.helpers";
import { useOptimistic, shortModelName } from "./ChatDefaultsSection.utils";
import { ParticipantPicker } from "./ChatDefaultsSection.ParticipantPicker";
import { ChatDefaultsImageGenerationSection } from "./ChatDefaultsImageGenerationSection";
import { ChatDefaultsAudioSection } from "./ChatDefaultsAudioSection";
import { ChatDefaultsVideoGenerationSection } from "./ChatDefaultsVideoGenerationSection";
import { ChatDefaultsGenerationValuesSection } from "./ChatDefaultsGenerationValuesSection";
import { captureSettingChanged } from "@/lib/featureAnalytics";
import {
  CHAT_DEFAULT_SETTING_AREAS,
  type SettingArea,
} from "./ChatDefaultsSection.analytics";

// ─── Component ─────────────────────────────────────────────────────────────

export function ChatDefaultsSection() {
  const { t } = useTranslation();
  const { prefs, personas } = useSharedData();
  const modelSummaries = useModelSummaries();
  const { isPro } = useProGate();
  const [showParticipantPicker, setShowParticipantPicker] = useState(false);
  const [showTitleModelPicker, setShowTitleModelPicker] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState<string | null>(null);

  // ── Derived values ──

  const defaultModelId = prefs?.defaultModelId ?? "";
  const defaultModel = modelSummaries?.find((m) => m.modelId === defaultModelId) ?? null;
  const defaultPersonaId = (prefs?.defaultPersonaId as string | undefined) ?? null;
  const defaultPersona = defaultPersonaId
    ? personas?.find((p) => p._id === defaultPersonaId)
    : null;

  const participantLabel = defaultPersona
    ? (defaultPersona.displayName ?? "Persona")
    : (defaultModel?.name ?? (defaultModelId ? shortModelName(defaultModelId) : "Not set"));

  const titleModelId = (prefs?.titleModelId as string | undefined) ?? "";
  const titleModel = modelSummaries?.find((m) => m.modelId === titleModelId) ?? null;
  const titleModelLabel = titleModel?.name ?? (titleModelId ? shortModelName(titleModelId) : "Default");

  const webSearchEnabled = prefs?.webSearchEnabledByDefault ?? true;
  const subagentsEnabled = prefs?.subagentsEnabledByDefault ?? false;

  // Local optimistic state
  const [localSearchMode, setLocalSearchMode] = useOptimistic((prefs?.defaultSearchMode as string | undefined) ?? "basic");
  const [localSearchComplexity, setLocalSearchComplexity] = useOptimistic((prefs?.defaultSearchComplexity as number | undefined) ?? 1);

  // ── Handlers ──
  const capturePreferenceChange = useCallback((
    settingKey: string,
    settingArea: SettingArea,
    value: unknown,
  ) => {
    captureSettingChanged({
      setting_key: settingKey,
      setting_area: settingArea,
      value_type: value === null
        ? "null"
        : typeof value === "boolean"
          ? "boolean"
          : typeof value === "number"
            ? "number"
            : "string",
      });
  }, []);

  const capturePersistedPreferenceChanges = useCallback((patch: Record<string, unknown>) => {
    for (const [settingKey, value] of Object.entries(patch)) {
      const settingArea = CHAT_DEFAULT_SETTING_AREAS[settingKey];
      if (settingArea) {
        capturePreferenceChange(settingKey, settingArea, value);
      }
    }
  }, [capturePreferenceChange]);

  const { updatePreference, updatePreferenceImmediate } = usePreferenceBuffer({
    onPersistedPatch: capturePersistedPreferenceChanges,
  });

  const handleSelectDefaultModel = useCallback((modelId: string) => {
    updatePreferenceImmediate(
      defaultPersonaId === null
        ? { defaultModelId: modelId }
        : { defaultModelId: modelId, defaultPersonaId: null },
    );
  }, [defaultPersonaId, updatePreferenceImmediate]);

  const handleSelectDefaultPersona = useCallback((personaId: string) => {
    const persona = personas?.find((candidate) => candidate._id === personaId);
    updatePreferenceImmediate({
      defaultModelId: persona?.modelId ?? defaultModelId,
      defaultPersonaId: personaId,
    });
  }, [defaultModelId, personas, updatePreferenceImmediate]);

  const handleSelectTitleModel = useCallback((modelId: string) => {
    updatePreferenceImmediate({ titleModelId: modelId });
    setShowTitleModelPicker(false);
  }, [updatePreferenceImmediate]);

  // ── Search tier description ──
  const complexityLabel = (c: number) => c === 1 ? t("quick") : c === 2 ? t("thorough") : c === 3 ? t("comprehensive") : "";
  const searchTierDescription = (() => {
    if (localSearchMode === "web") return t("web_search_arg", { var1: complexityLabel(localSearchComplexity) });
    if (localSearchMode === "paper") return t("research_paper_arg", { var1: complexityLabel(localSearchComplexity) });
    return t("basic_search");
  })();

  const settingsLabelClass = "text-sm w-40 shrink-0";
  const settingsIconLabelClass = "flex items-center gap-2 w-40 shrink-0";
  const settingsControlClass = "flex-1 min-w-0";

  return (
    <div className="space-y-3">
      {/* ── Participant ── */}
      <SectionHeader>{t("default_participant")}</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden">
        <button type="button" onClick={() => setShowParticipantPicker(true)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left">
          {defaultPersona ? (
            <PersonaAvatar
              personaId={defaultPersonaId ?? undefined}
              personaName={defaultPersona.displayName ?? undefined}
              personaEmoji={defaultPersona.avatarEmoji ?? undefined}
              personaAvatarImageUrl={defaultPersona.avatarImageUrl ?? undefined}
              className="w-7 h-7"
              emojiClass="text-sm"
              initialClass="text-xs"
              iconSize={14}
            />
          ) : defaultModelId ? (
            <ProviderLogo modelId={defaultModelId} size={28} />
          ) : (
            <ProviderLogo modelId="" size={28} />
          )}
          <span className="flex-1 text-sm">{t("default_participant")}</span>
          <span className="text-xs text-muted truncate max-w-[10rem]">{participantLabel}</span>
          <ChevronRight size={14} className="text-muted flex-shrink-0" />
        </button>
      </div>
      <SectionFooter>{t("new_chats_start_with_this_participant_persona_and_per_model")}</SectionFooter>

      {/* ── Manage Favorites ── */}
      <SectionHeader>{t("quick_launch")}</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden">
        <Link to="/app/settings/favorites" className="flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors">
          <Star size={16} className="flex-shrink-0 text-muted" /><span className="flex-1 text-sm">{t("manage_favorites")}</span><ChevronRight size={14} className="text-muted flex-shrink-0" />
        </Link>
      </div>
      <SectionFooter>{t("quick_launch_footer")}</SectionFooter>

      {/* ── Title Model ── */}
      <SectionHeader><div className="flex items-center gap-1.5"><Type size={14} />{t("title_model")}</div></SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden">
        <button type="button" onClick={() => setShowTitleModelPicker(true)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left">
          <span className="flex-1 text-sm">{t("default_model")}</span><span className="text-xs text-muted truncate max-w-32">{titleModelLabel}</span><ChevronRight size={14} className="text-muted flex-shrink-0" />
        </button>
      </div>
      <SectionFooter>{t("generates_automatic_chat_titles_after_your_first_message")}</SectionFooter>

      <ChatDefaultsGenerationValuesSection
        prefs={prefs}
        updatePreference={updatePreference}
        updatePreferenceImmediate={updatePreferenceImmediate}
      />

      {/* ── Search ── */}
      <SectionHeader>{t("search")}</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2"><Globe size={16} className="flex-shrink-0 text-muted" /><label className="text-sm">{t("internet_search")}</label></div>
          <Toggle checked={webSearchEnabled} onChange={(v) => { updatePreferenceImmediate({ webSearchEnabledByDefault: v }); }} />
        </div>
        {webSearchEnabled && (
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <div className={settingsIconLabelClass}><SearchIcon size={16} className="flex-shrink-0 text-muted" /><label className="text-sm">{t("default_tier")}</label></div>
            <MenuSelect value={localSearchMode} options={[{ value: "basic", label: t("basic") }, { value: "web", label: `${t("web_search")}${!isPro ? ` (${t("pro_2")})` : ""}` }, { value: "paper", label: `${t("research_paper")}${!isPro ? ` (${t("pro_2")})` : ""}` }]} onChange={(mode) => { if (!isPro && (mode === "web" || mode === "paper")) { setPaywallFeature("Advanced Search"); return; } setLocalSearchMode(mode); updatePreferenceImmediate({ defaultSearchMode: mode }); }} />
          </div>
        )}
        {webSearchEnabled && localSearchMode !== "basic" && (
          <div className="flex items-center gap-6 px-4 py-3">
            <label className={settingsLabelClass}>{t("complexity")}</label>
            <div className={settingsControlClass}>
              <SegmentedControl value={localSearchComplexity} options={[{ value: 1, label: t("quick") }, { value: 2, label: t("thorough") }, { value: 3, label: t("comprehensive") }]} onChange={(v) => { setLocalSearchComplexity(v); updatePreferenceImmediate({ defaultSearchComplexity: v }); }} />
            </div>
          </div>
        )}
      </div>
      {webSearchEnabled && <SectionFooter>{t("new_chats_start_with_arg_active_globe_tap_toggles_this_defau", { var1: searchTierDescription })}</SectionFooter>}

      {/* ── Delegation ── */}
      <SectionHeader>{t("delegation")}</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <div className={settingsIconLabelClass}><Layers size={16} className="flex-shrink-0 text-muted" /><label className="text-sm">{t("subagents")}</label>{!isPro && <ProBadge size="sm" />}</div>
          <Toggle checked={subagentsEnabled === true} onChange={(v) => { if (v && !isPro) { setPaywallFeature("Subagents"); return; } updatePreferenceImmediate({ subagentsEnabledByDefault: v }); }} />
        </div>
      </div>
      <SectionFooter>{t("single_model_chats_can_delegate_up_to_three_focused_helper_t")}</SectionFooter>

      <ChatDefaultsAudioSection
        prefs={prefs}
        onChange={updatePreferenceImmediate}
        onBufferedChange={updatePreference}
      />

      <ChatDefaultsImageGenerationSection
        prefs={prefs}
        onChange={updatePreferenceImmediate}
      />

      <ChatDefaultsVideoGenerationSection prefs={prefs} onChange={updatePreferenceImmediate} />

      {/* ── Data Privacy ── */}
      <SectionHeader>{t("zdr_section_header")}</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <label className="text-sm">{t("zdr_toggle_label")}</label>
          <Toggle checked={prefs?.zdrEnabled ?? false} onChange={(v) => { updatePreferenceImmediate({ zdrEnabled: v }); }} />
        </div>
      </div>
      <SectionFooter>{t("zdr_section_footer")}</SectionFooter>

      {/* ── Behaviour ── */}
      <SectionHeader>{t("behaviour")}</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <div className="flex items-center justify-between px-4 py-3">
          <div><p className="text-sm">{t("send_on_enter")}</p><p className="text-xs text-muted mt-0.5">{t("shift_enter_newline")}</p></div>
          <Toggle checked={prefs?.sendOnEnter ?? true} onChange={(v) => { updatePreferenceImmediate({ sendOnEnter: v }); }} />
        </div>
      </div>

      {/* ── Modals ── */}
      {showParticipantPicker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={(e) => { if (e.target === e.currentTarget) setShowParticipantPicker(false); }}>
          <div className="w-full max-w-2xl bg-surface-1 rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ maxHeight: "80vh" }}>
            <ParticipantPicker selectedPersonaId={defaultPersonaId} selectedModelId={defaultModelId} onSelectPersona={handleSelectDefaultPersona} onSelectModel={handleSelectDefaultModel} onClose={() => setShowParticipantPicker(false)} />
          </div>
        </div>
      )}
      {showTitleModelPicker && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60" onClick={(e) => { if (e.target === e.currentTarget) setShowTitleModelPicker(false); }}>
          <div className="w-full max-w-2xl bg-surface-1 rounded-t-2xl sm:rounded-2xl overflow-hidden" style={{ maxHeight: "80vh" }}>
            <ModelPicker
              selectedModelId={titleModelId}
              onSelect={handleSelectTitleModel}
              onClose={() => setShowTitleModelPicker(false)}
              textOutputOnly
            />
          </div>
        </div>
      )}
      {paywallFeature && <PaywallModal feature={paywallFeature} onClose={() => setPaywallFeature(null)} />}
    </div>
  );
}
