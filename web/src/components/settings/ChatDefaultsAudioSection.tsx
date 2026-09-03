import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { useTranslation } from "react-i18next";
import { AudioLines, Loader2, Play, Square } from "lucide-react";
import { api } from "@convex/_generated/api";
import { MenuSelect } from "@/components/shared/MenuSelect";
import { SegmentedControl } from "@/components/shared/SegmentedControl";
import { Toggle } from "@/components/shared/Toggle";
import type { ModelSummary } from "@/components/shared/ModelPickerHelpers";
import { useModelSummaries } from "@/hooks/useSharedData";
import { SectionFooter, SectionHeader } from "./ChatDefaultsSection.helpers";
import { isOwnedVoicePreview, useOptimistic } from "./ChatDefaultsSection.utils";
import { ChatDefaultsMediaModelPickerRow } from "./ChatDefaultsMediaModelPickerRow";

export interface AudioGenerationPreferenceSource {
  defaultMusicGenerationModelId?: string;
  defaultSpeechGenerationModelId?: string;
  autoAudioResponse?: boolean;
  preferredVoice?: string;
  defaultAudioSpeed?: number;
  defaultSpeechSpeed?: number | null;
  defaultSpeechOutputFormat?: string | null;
  defaultSpeechInstructions?: string | null;
  defaultSpeechStyle?: string | null;
  defaultSpeechStyleDegree?: number | null;
  zdrEnabled?: boolean;
}

interface Props {
  prefs?: AudioGenerationPreferenceSource | null;
  onChange: (patch: Record<string, unknown>) => void;
  onBufferedChange: (patch: Record<string, unknown>) => void;
}

function ControlRow({ label, supported, children }: {
  label: string;
  supported: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className={`px-4 py-3 ${supported ? "" : "opacity-50"}`}>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <label className="w-full text-sm sm:w-40 sm:shrink-0">{label}</label>
        <div className="flex min-w-0 flex-1 justify-start sm:justify-end">{children}</div>
      </div>
      {!supported && <p className="text-[10px] text-muted mt-1">{t("speech_setting_unsupported")}</p>}
    </div>
  );
}

export function ChatDefaultsAudioSection({ prefs, onChange, onBufferedChange }: Props) {
  const { t } = useTranslation();
  const summaries = useModelSummaries({ includeGenerationModels: true }) as ModelSummary[] | undefined;
  const speechModel = summaries?.find((model) => model.modelId === prefs?.defaultSpeechGenerationModelId);
  const capabilities = speechModel?.mediaCapabilities?.speech;
  const voices = capabilities?.voices ?? [];
  const [voice, setVoice] = useOptimistic(prefs?.preferredVoice ?? "");
  const [playbackSpeed, setPlaybackSpeed] = useOptimistic(prefs?.defaultAudioSpeed ?? 1);
  const [speechSpeed, setSpeechSpeed] = useOptimistic(
    prefs?.defaultSpeechSpeed == null ? "" : String(prefs.defaultSpeechSpeed),
  );
  const [outputFormat, setOutputFormat] = useOptimistic(prefs?.defaultSpeechOutputFormat ?? "mp3");
  const [instructions, setInstructions] = useOptimistic(prefs?.defaultSpeechInstructions ?? "");
  const [style, setStyle] = useOptimistic(prefs?.defaultSpeechStyle ?? "");
  const [styleDegree, setStyleDegree] = useOptimistic(
    prefs?.defaultSpeechStyleDegree == null ? "" : String(prefs.defaultSpeechStyleDegree),
  );
  const effectiveVoice = voices.length === 0
    ? voice.trim()
    : voices.includes(voice) ? voice : voices[0];
  const voiceUnavailable = voices.length > 0 && voice.length > 0 && !voices.includes(voice);
  const voiceOptions = (
    voices.length > 0
      ? voices.map((value) => ({ value, label: value }))
      : []
  );

  const previewVoice = useAction(api.chat.actions.previewVoice);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewRequestIdRef = useRef(0);
  const stopPreview = useCallback(() => {
    previewRequestIdRef.current += 1;
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.src = "";
    audioRef.current = null;
    setPreviewPlaying(false);
    setPreviewLoading(false);
  }, []);
  const handleSpeechModelChange = useCallback((patch: Record<string, unknown>) => {
    const nextModelId = patch.defaultSpeechGenerationModelId;
    if (
      typeof nextModelId === "string"
      && nextModelId !== prefs?.defaultSpeechGenerationModelId
    ) {
      stopPreview();
      setVoice("");
      onChange({ ...patch, preferredVoice: null });
      return;
    }
    onChange(patch);
  }, [onChange, prefs?.defaultSpeechGenerationModelId, setVoice, stopPreview]);
  const handlePreview = useCallback(async () => {
    if (previewPlaying) { stopPreview(); return; }
    stopPreview();
    const requestId = previewRequestIdRef.current;
    setPreviewLoading(true);
    try {
      const result = await previewVoice({ voice: effectiveVoice });
      if (requestId !== previewRequestIdRef.current || !result?.audioBase64) return;
      const audio = new Audio(`data:${result.mimeType ?? "audio/mpeg"};base64,${result.audioBase64}`);
      audioRef.current = audio;
      const clearOwnedPreview = () => {
        if (!isOwnedVoicePreview(requestId, previewRequestIdRef.current, audio, audioRef.current)) return;
        setPreviewPlaying(false);
        audioRef.current = null;
      };
      audio.addEventListener("ended", clearOwnedPreview);
      audio.addEventListener("error", clearOwnedPreview);
      setPreviewPlaying(true);
      try {
        await audio.play();
      } catch {
        clearOwnedPreview();
      }
    } finally {
      if (requestId === previewRequestIdRef.current) setPreviewLoading(false);
    }
  }, [effectiveVoice, previewPlaying, previewVoice, stopPreview]);
  useEffect(() => stopPreview, [stopPreview]);

  const speedSupported = capabilities?.supportsSpeed === true;
  const instructionsSupported = capabilities?.supportsInstructions === true;
  const styleSupported = capabilities?.supportsStyle === true;
  const speedMin = capabilities?.speedMin ?? 0.25;
  const speedMax = capabilities?.speedMax ?? 4;
  const styleMin = capabilities?.styleDegreeMin ?? 0.01;
  const styleMax = capabilities?.styleDegreeMax ?? 2;

  return (
    <>
      <SectionHeader><div className="flex items-center gap-1.5"><AudioLines size={14} />{t("audio_section_header")}</div></SectionHeader>
      <div className="rounded-2xl bg-surface-2 overflow-hidden divide-y divide-border/50">
        <ChatDefaultsMediaModelPickerRow generationKind="music" preferenceKey="defaultMusicGenerationModelId" selectedModelId={prefs?.defaultMusicGenerationModelId} label={t("default_music_model")} zdrEnabled={prefs?.zdrEnabled === true} onChange={onChange} />
        <ChatDefaultsMediaModelPickerRow generationKind="speech" preferenceKey="defaultSpeechGenerationModelId" selectedModelId={prefs?.defaultSpeechGenerationModelId} label={t("default_voice_model")} zdrEnabled={prefs?.zdrEnabled === true} onChange={handleSpeechModelChange} />
        <div className="flex items-center justify-between px-4 py-3">
          <label className="text-sm">{t("audio_auto_reply")}</label>
          <Toggle checked={prefs?.autoAudioResponse === true} onChange={(value) => onChange({ autoAudioResponse: value })} />
        </div>
        <ControlRow label={t("voice")} supported={capabilities !== undefined}>
          {voices.length > 0 ? (
            <MenuSelect disabled={capabilities === undefined} value={effectiveVoice} options={voiceOptions} ariaLabel={t("voice")} onChange={(value) => { stopPreview(); setVoice(value); onChange({ preferredVoice: value || null }); }} />
          ) : (
            <input aria-label={t("voice")} aria-invalid={voice.trim().length === 0} required disabled={capabilities === undefined} value={voice} maxLength={160} placeholder={t("speech_voice_id_placeholder")} onChange={(event) => { stopPreview(); const value = event.currentTarget.value; setVoice(value); onBufferedChange({ preferredVoice: value.trim() || null }); }} onBlur={() => { const canonical = voice.trim(); setVoice(canonical); onBufferedChange({ preferredVoice: canonical || null }); }} className="w-full rounded-lg border border-border/50 bg-surface-3 px-2.5 py-1 text-sm disabled:cursor-not-allowed sm:max-w-xs" />
          )}
        </ControlRow>
        {capabilities !== undefined && voices.length === 0 && <p className="px-4 pb-3 text-[10px] text-muted">{t("speech_custom_voice_hint")}</p>}
        {voiceUnavailable && <p className="px-4 pb-3 text-[10px] text-warning">{t("speech_voice_unavailable")}</p>}
        <ControlRow label={t("speech_synthesis_speed")} supported={speedSupported}>
          <input type="number" aria-label={t("speech_synthesis_speed")} disabled={!speedSupported} min={speedMin} max={speedMax} step={0.05} value={speechSpeed} placeholder={t("model_default_placeholder")} onChange={(event) => { const value = event.currentTarget.value; setSpeechSpeed(value); if (event.currentTarget.checkValidity()) onBufferedChange({ defaultSpeechSpeed: value === "" ? null : Number(value) }); }} onBlur={(event) => { if (!event.currentTarget.checkValidity()) return; const canonical = event.currentTarget.value === "" ? "" : String(Number(event.currentTarget.value)); setSpeechSpeed(canonical); onBufferedChange({ defaultSpeechSpeed: canonical === "" ? null : Number(canonical) }); }} className="w-full rounded-lg border border-border/50 bg-surface-3 px-2.5 py-1 text-right text-sm disabled:cursor-not-allowed sm:w-28" />
        </ControlRow>
        <ControlRow label={t("speech_output_format")} supported={capabilities !== undefined}>
          <MenuSelect disabled={capabilities === undefined} value={outputFormat} options={(capabilities?.outputFormats ?? ["mp3", "pcm"]).map((value) => ({ value, label: value.toUpperCase() }))} ariaLabel={t("speech_output_format")} onChange={(value) => { setOutputFormat(value); onChange({ defaultSpeechOutputFormat: value }); }} />
        </ControlRow>
        <ControlRow label={t("speech_instructions")} supported={instructionsSupported}>
          <textarea aria-label={t("speech_instructions")} disabled={!instructionsSupported} value={instructions} maxLength={1000} rows={2} onChange={(event) => { const value = event.currentTarget.value; setInstructions(value); onBufferedChange({ defaultSpeechInstructions: value.trim() || null }); }} onBlur={() => { const canonical = instructions.trim(); setInstructions(canonical); onBufferedChange({ defaultSpeechInstructions: canonical || null }); }} className="w-full rounded-lg border border-border/50 bg-surface-3 px-2.5 py-1.5 text-sm resize-y disabled:cursor-not-allowed" />
        </ControlRow>
        <ControlRow label={t("speech_style")} supported={styleSupported}>
          <input aria-label={t("speech_style")} disabled={!styleSupported} value={style} maxLength={80} onChange={(event) => { const value = event.currentTarget.value; setStyle(value); onBufferedChange({ defaultSpeechStyle: value.trim() || null }); }} onBlur={() => { const canonical = style.trim(); setStyle(canonical); onBufferedChange({ defaultSpeechStyle: canonical || null }); }} className="w-full rounded-lg border border-border/50 bg-surface-3 px-2.5 py-1 text-sm disabled:cursor-not-allowed" />
        </ControlRow>
        <ControlRow label={t("speech_style_intensity")} supported={styleSupported}>
          <input type="number" aria-label={t("speech_style_intensity")} disabled={!styleSupported} min={styleMin} max={styleMax} step={0.01} value={styleDegree} placeholder={t("model_default_placeholder")} onChange={(event) => { const value = event.currentTarget.value; setStyleDegree(value); if (event.currentTarget.checkValidity()) onBufferedChange({ defaultSpeechStyleDegree: value === "" ? null : Number(value) }); }} onBlur={(event) => { if (!event.currentTarget.checkValidity()) return; const canonical = event.currentTarget.value === "" ? "" : String(Number(event.currentTarget.value)); setStyleDegree(canonical); onBufferedChange({ defaultSpeechStyleDegree: canonical === "" ? null : Number(canonical) }); }} className="w-full rounded-lg border border-border/50 bg-surface-3 px-2.5 py-1 text-right text-sm disabled:cursor-not-allowed sm:w-28" />
        </ControlRow>
        <div className="flex flex-col items-stretch gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-6">
          <label className="w-full text-sm sm:w-40 sm:shrink-0">{t("playback_speed")}</label>
          <div className="flex-1 min-w-0"><SegmentedControl value={playbackSpeed} options={[{ value: 1, label: "1x" }, { value: 1.5, label: "1.5x" }, { value: 2, label: "2x" }]} onChange={(value) => { setPlaybackSpeed(value); onChange({ defaultAudioSpeed: value }); }} /></div>
        </div>
        <div className="flex items-center justify-between px-4 py-3">
          <label className="text-sm">{t("preview")}</label>
          <button type="button" onClick={() => void handlePreview()} disabled={previewLoading || capabilities === undefined || effectiveVoice.length === 0} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-accent hover:bg-accent/10 disabled:opacity-50 transition-colors">
            {previewLoading ? <><Loader2 size={14} className="animate-spin" />{t("audio_loading")}&hellip;</> : previewPlaying ? <><Square size={14} />{t("audio_stop_preview")}</> : <><Play size={14} />{t("audio_preview_voice")}</>}
          </button>
        </div>
      </div>
      <SectionFooter>{t("audio_generation_models_footer")} {t("speech_options_footer")} {t("audio_section_footer")}</SectionFooter>
    </>
  );
}
