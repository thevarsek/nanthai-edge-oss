// ChatDefaultsSection.tsx
// Settings section for chat defaults: participant, generation params, search,
// delegation, behaviour, audio, title model, and quick launch.
// Sub-components extracted to ChatDefaultsSection.helpers.tsx and
// ChatDefaultsSection.ParticipantPicker.tsx to stay under 300 lines.

import { useState, useEffect, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  ChevronRight, Globe, Star, Type, AudioLines,
  Search as SearchIcon, Layers, Play, Square, Loader2, Video,
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
import { useOptimistic, shortModelName, VOICE_OPTIONS } from "./ChatDefaultsSection.utils";
import { ParticipantPicker } from "./ChatDefaultsSection.ParticipantPicker";

const VIDEO_DURATION_OPTIONS = [4, 5, 6, 8, 10, 12, 15, 20].map((value) => ({
  value,
  label: `${value}s`,
}));
const VIDEO_RESOLUTION_OPTIONS = ["480p", "720p", "1080p", "4K"].map((value) => ({
  value,
  label: value,
}));

// ─── Component ─────────────────────────────────────────────────────────────

export function ChatDefaultsSection() {
  const { t } = useTranslation();
  const { prefs, personas } = useSharedData();
  const modelSummaries = useModelSummaries();
  const { updatePreference, updatePreferenceImmediate } = usePreferenceBuffer();
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

  const includeReasoning = prefs?.includeReasoning ?? false;
  const autoAudioResponse = prefs?.autoAudioResponse ?? false;
  const webSearchEnabled = prefs?.webSearchEnabledByDefault ?? true;
  const subagentsEnabled = prefs?.subagentsEnabledByDefault ?? false;

  // Local optimistic state
  const [localTemp, setLocalTemp] = useOptimistic(prefs?.defaultTemperature ?? 0.7);
  const [localMaxTokens, setLocalMaxTokens] = useOptimistic<number | undefined>(prefs?.defaultMaxTokens ?? undefined);
  const [localEffort, setLocalEffort] = useOptimistic((prefs?.reasoningEffort as string | undefined) ?? "medium");
  const [localVoice, setLocalVoice] = useOptimistic((prefs?.preferredVoice as string | undefined) ?? "nova");
  const [localAudioSpeed, setLocalAudioSpeed] = useOptimistic((prefs?.defaultAudioSpeed as number | undefined) ?? 1);
  const [localSearchMode, setLocalSearchMode] = useOptimistic((prefs?.defaultSearchMode as string | undefined) ?? "basic");
  const [localSearchComplexity, setLocalSearchComplexity] = useOptimistic((prefs?.defaultSearchComplexity as number | undefined) ?? 1);
  const [localVideoAspect, setLocalVideoAspect] = useOptimistic((prefs?.defaultVideoAspectRatio as string | undefined) ?? "16:9");
  const [localVideoDuration, setLocalVideoDuration] = useOptimistic((prefs?.defaultVideoDuration as number | undefined) ?? 5);
  const [localVideoResolution, setLocalVideoResolution] = useOptimistic((prefs?.defaultVideoResolution as string | undefined) ?? "720p");
  const [localVideoAudio, setLocalVideoAudio] = useOptimistic((prefs?.defaultVideoGenerateAudio as boolean | undefined) ?? true);

  // ── Voice preview ──
  const previewVoice = useAction(api.chat.actions.previewVoice);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stopPreview = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; audioRef.current = null; }
    setPreviewPlaying(null);
    setPreviewLoading(null);
  }, []);

  const handlePreviewVoice = useCallback(async (voice: string) => {
    if (previewPlaying === voice) { stopPreview(); return; }
    stopPreview();
    setPreviewLoading(voice);
    try {
      const result = await previewVoice({ voice });
      if (!result?.audioBase64) return;
      const audio = new Audio(`data:${result.mimeType ?? "audio/wav"};base64,${result.audioBase64}`);
      audioRef.current = audio;
      audio.addEventListener("ended", () => { setPreviewPlaying(null); audioRef.current = null; });
      audio.addEventListener("error", () => { setPreviewPlaying(null); audioRef.current = null; });
      setPreviewPlaying(voice);
      setPreviewLoading(null);
      await audio.play();
    } catch { setPreviewLoading(null); }
  }, [previewVoice, previewPlaying, stopPreview]);

  useEffect(() => () => { if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; } }, []);

  // ── Handlers ──
  const handleSelectDefaultModel = useCallback((modelId: string) => {
    updatePreferenceImmediate({ defaultModelId: modelId, defaultPersonaId: null });
  }, [updatePreferenceImmediate]);

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
        <button onClick={() => setShowParticipantPicker(true)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left">
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
      <SectionHeader>{t("title_model")}</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden">
        <button onClick={() => setShowTitleModelPicker(true)} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left">
          <Type size={16} className="flex-shrink-0 text-muted" /><span className="flex-1 text-sm">{t("title_model")}</span><span className="text-xs text-muted truncate max-w-32">{titleModelLabel}</span><ChevronRight size={14} className="text-muted flex-shrink-0" />
        </button>
      </div>
      <SectionFooter>{t("generates_automatic_chat_titles_after_your_first_message")}</SectionFooter>

      {/* ── Generation Values ── */}
      <SectionHeader>Generation Values</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        {/* Temperature */}
        <div className="px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-sm">{t("temperature")}</label>
            <span className="text-sm font-mono tabular-nums text-muted min-w-[2.5rem] text-right">{localTemp.toFixed(1)}</span>
          </div>
          <input type="range" min="0" max="2" step="0.1" value={localTemp} onChange={(e) => { const v = parseFloat(e.target.value); setLocalTemp(v); updatePreference({ defaultTemperature: v }); }} className="w-full h-2 cursor-pointer" />
          <div className="flex justify-between text-[11px] text-muted">
            <span>0 — {t("precise")}</span><span>1 — {t("balanced")}</span><span>{t("creative")} — 2</span>
          </div>
        </div>
        {/* Max Tokens */}
        <div className="flex items-center justify-between gap-6 px-4 py-3">
          <div className="flex-1 w-40 shrink-0">
            <label className="text-sm">{t("max_tokens")}</label>
            <p className="text-[11px] text-muted mt-0.5">{t("max_tokens_empty_hint")}</p>
          </div>
          <input type="text" inputMode="numeric" placeholder={t("model_default_placeholder")} value={localMaxTokens != null ? String(localMaxTokens) : ""} onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ""); const val = raw ? parseInt(raw, 10) : undefined; setLocalMaxTokens(val); updatePreference({ defaultMaxTokens: val ?? null }); }} className="w-28 px-2.5 py-1.5 rounded-lg bg-surface-3 text-sm text-right border border-border/50 focus:outline-none focus:border-accent font-mono tabular-nums placeholder-muted" />
        </div>
        {/* Include Reasoning */}
        <div className="flex items-center justify-between px-4 py-3">
          <label className="text-sm">{t("include_reasoning")}</label>
          <Toggle checked={includeReasoning} onChange={(v) => updatePreferenceImmediate({ includeReasoning: v })} />
        </div>
        {/* Reasoning Effort */}
        {includeReasoning && (
          <div className="flex items-center justify-between gap-6 px-4 py-3">
            <label className={settingsLabelClass}>{t("reasoning_effort")}</label>
            <MenuSelect value={localEffort} options={[{ value: "low", label: t("low") }, { value: "medium", label: t("medium") }, { value: "high", label: t("high") }]} onChange={(v) => { setLocalEffort(v); updatePreferenceImmediate({ reasoningEffort: v }); }} />
          </div>
        )}
      </div>

      {/* ── Search ── */}
      <SectionHeader>{t("search")}</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2"><Globe size={16} className="flex-shrink-0 text-muted" /><label className="text-sm">{t("internet_search")}</label></div>
          <Toggle checked={webSearchEnabled} onChange={(v) => updatePreferenceImmediate({ webSearchEnabledByDefault: v })} />
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

      {/* ── Audio ── */}
      <SectionHeader>{t("audio_section_header")}</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <div className="flex items-center justify-between px-4 py-3">
          <div className={settingsIconLabelClass}><AudioLines size={16} className="flex-shrink-0 text-muted" /><label className="text-sm">{t("audio_auto_reply")}</label></div>
          <Toggle checked={autoAudioResponse} onChange={(v) => updatePreferenceImmediate({ autoAudioResponse: v })} />
        </div>
        <div className="flex items-center justify-between gap-6 px-4 py-3">
          <label className={settingsLabelClass}>{t("voice")}</label>
          <MenuSelect value={localVoice} options={VOICE_OPTIONS.map((v) => ({ value: v, label: v.charAt(0).toUpperCase() + v.slice(1) }))} onChange={(v) => { stopPreview(); setLocalVoice(v); updatePreferenceImmediate({ preferredVoice: v }); }} />
        </div>
        <div className="flex items-center gap-6 px-4 py-3">
          <label className={settingsLabelClass}>{t("playback_speed")}</label>
          <div className={settingsControlClass}>
            <SegmentedControl value={localAudioSpeed} options={[{ value: 1, label: "1x" }, { value: 1.5, label: "1.5x" }, { value: 2, label: "2x" }]} onChange={(v) => { setLocalAudioSpeed(v); updatePreferenceImmediate({ defaultAudioSpeed: v }); }} />
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <label className="text-sm">{t("preview")}</label>
          <button onClick={() => void handlePreviewVoice(localVoice)} disabled={previewLoading !== null} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-accent hover:bg-accent/10 disabled:opacity-50 transition-colors">
            {previewLoading === localVoice ? (<><Loader2 size={14} className="animate-spin" />{t("audio_loading")}&hellip;</>) : previewPlaying === localVoice ? (<><Square size={14} />{t("audio_stop_preview")}</>) : (<><Play size={14} />{t("audio_preview_voice")}</>)}
          </button>
        </div>
      </div>
      <SectionFooter>{t("audio_section_footer")}</SectionFooter>

      {/* ── Video Generation ── */}
      <SectionHeader><div className="flex items-center gap-1.5"><Video size={14} />{t("video_generation")}</div></SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <div className="flex items-center gap-6 px-4 py-3">
          <label className={settingsLabelClass}>{t("video_config_aspect_ratio")}</label>
          <div className={settingsControlClass}>
            <SegmentedControl value={localVideoAspect} options={[{ value: "16:9", label: "16:9" }, { value: "9:16", label: "9:16" }, { value: "1:1", label: "1:1" }]} onChange={(v) => { setLocalVideoAspect(v); updatePreferenceImmediate({ defaultVideoAspectRatio: v }); }} />
          </div>
        </div>
        <div className="flex items-center gap-6 px-4 py-3">
          <label className={settingsLabelClass}>{t("video_config_resolution")}</label>
          <div className={settingsControlClass}>
            <SegmentedControl value={localVideoResolution} options={VIDEO_RESOLUTION_OPTIONS} onChange={(v) => { setLocalVideoResolution(v); updatePreferenceImmediate({ defaultVideoResolution: v }); }} />
          </div>
        </div>
        <div className="flex items-center gap-6 px-4 py-3">
          <label className={settingsLabelClass}>{t("video_config_duration")}</label>
          <div className={settingsControlClass}>
            <SegmentedControl value={localVideoDuration} options={VIDEO_DURATION_OPTIONS} onChange={(v) => { setLocalVideoDuration(v); updatePreferenceImmediate({ defaultVideoDuration: v }); }} />
          </div>
        </div>
        <div className="flex items-center justify-between gap-6 px-4 py-3">
          <label className={settingsLabelClass}>{t("video_config_audio")}</label>
          <Toggle checked={localVideoAudio} onChange={(v) => { setLocalVideoAudio(v); updatePreferenceImmediate({ defaultVideoGenerateAudio: v }); }} />
        </div>
      </div>
      <SectionFooter>{t("video_config_snap_hint")}</SectionFooter>

      {/* ── Data Privacy ── */}
      <SectionHeader>{t("zdr_section_header")}</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <label className="text-sm">{t("zdr_toggle_label")}</label>
          <Toggle checked={prefs?.zdrEnabled ?? false} onChange={(v) => updatePreferenceImmediate({ zdrEnabled: v })} />
        </div>
      </div>
      <SectionFooter>{t("zdr_section_footer")}</SectionFooter>

      {/* ── Behaviour ── */}
      <SectionHeader>{t("behaviour")}</SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <div className="flex items-center justify-between px-4 py-3">
          <div><p className="text-sm">{t("send_on_enter")}</p><p className="text-xs text-muted mt-0.5">{t("shift_enter_newline")}</p></div>
          <Toggle checked={prefs?.sendOnEnter ?? true} onChange={(v) => updatePreferenceImmediate({ sendOnEnter: v })} />
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
            <ModelPicker selectedModelId={titleModelId} onSelect={handleSelectTitleModel} onClose={() => setShowTitleModelPicker(false)} />
          </div>
        </div>
      )}
      {paywallFeature && <PaywallModal feature={paywallFeature} onClose={() => setPaywallFeature(null)} />}
    </div>
  );
}
