import { useTranslation } from "react-i18next";
import { Mic, Upload, X } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import type { VoiceCloningRequest } from "@/types/voiceCloning";
import type { AttachmentPreview } from "./MessageInput.attachments.types";
import { useModelSummaries } from "@/hooks/useSharedData";
import { MenuSelect } from "@/components/shared/MenuSelect";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/bodyScrollLock";

type Props = {
  onClose: () => void;
  attachments: AttachmentPreview[];
  value?: VoiceCloningRequest;
  onChange: (value: VoiceCloningRequest | undefined) => void;
  onChoose: () => void;
  onRecord: () => void;
  disabled: boolean;
  requireZdr: boolean;
};

export function VoiceCloningComposer(props: Props) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    lockBodyScroll();
    return () => { unlockBodyScroll(); previousFocus?.focus(); };
  }, []);
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // A nested model menu owns Escape while the drawer contains the full focus cycle.
    if (event.key === "Escape" && (event.target as HTMLElement).closest("[data-menu-select-popup]")) return;
    if (event.key === "Escape") { event.preventDefault(); props.onClose(); return; }
    if (event.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center"
    onClick={event => { if (event.target === event.currentTarget) props.onClose(); }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={t("vc_title")} onKeyDown={handleKeyDown}
      className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface-1 sm:rounded-2xl">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <h2 className="text-base font-semibold">{t("vc_title")}</h2>
        <button ref={closeRef} type="button" aria-label={t("close")} onClick={props.onClose} className="rounded-lg p-1.5 text-muted hover:bg-surface-3"><X size={18} /></button>
      </div>
      <div className="overflow-y-auto px-5 py-4"><VoiceReferenceFields {...props} /></div>
      <div className="border-t border-border/50 px-5 py-4"><button type="button" onClick={props.onClose} className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground">{t("done")}</button></div>
    </div>
  </div>;
}

function VoiceReferenceFields({ attachments, value, onChange, onChoose, onRecord, disabled, requireZdr }: Props) {
  const { t } = useTranslation();
  const models = useModelSummaries({ includeGenerationModels: true, voiceCloning: { requireZdr } });
  const speechModels = models ?? [];
  const selected = speechModels.find((model) => model.modelId === value?.modelId);
  const capability = selected?.mediaCapabilities.speech;
  const maximum = requireZdr ? capability?.maxZdrAudioReferences : capability?.maxAudioReferences;
  const recordings = attachments.filter((attachment) => attachment.storageId && attachment.mimeType.startsWith("audio/"));
  const update = (next: VoiceCloningRequest) => onChange({ ...next, permissionConfirmed: false });
  return <div className="space-y-4 text-sm">
      <p className="text-sm leading-relaxed text-muted">{t("vc_description")}</p>
      <div className="space-y-2 rounded-xl bg-surface-2 px-4 py-3"><span className="block font-medium">{t("vc_model")}</span>
        <MenuSelect searchable ariaLabel={t("vc_model")} disabled={disabled} value={value?.modelId ?? ""}
          options={[{value: "", label: t("vc_none")}, ...speechModels.map(model => ({value: model.modelId, label: model.name}))]}
          onChange={modelId => modelId ? update({ modelId, permissionConfirmed: false, references: [] }) : onChange(undefined)} />
      </div>
      {value && !maximum && <p role="status" className="text-xs text-muted">{requireZdr ? t("vc_unsupported_zdr") : t("vc_unsupported")}</p>}
      {value && !!maximum && <>
        <div className="space-y-3 border-t border-border/50 pt-4">
        <p className="text-xs leading-relaxed text-muted">{t("vc_limits", {count: maximum})}{value.modelId.startsWith("bytedance-seed/") && maximum > 1 ? " " + t("vc_seed") : ""}</p>
        <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-surface-2">
          <button type="button" className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-3 disabled:opacity-40" disabled={disabled} onClick={onChoose}><Upload size={18} className="shrink-0 text-primary" aria-hidden="true" />{t("vc_choose_recordings")}</button>
          <button type="button" className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-3 disabled:opacity-40" disabled={disabled} onClick={onRecord}><Mic size={18} className="shrink-0 text-primary" aria-hidden="true" />{t("vc_record")}</button>
        </div>
        {recordings.map((attachment) => {
          const reference = value.references.find((item) => item.storageId === attachment.storageId);
          return <div key={attachment.storageId} className="overflow-hidden rounded-xl bg-surface-2">
            <label className="flex min-h-12 cursor-pointer items-center gap-3 px-4 py-3"><input type="checkbox" className="h-4 w-4 shrink-0 accent-primary" checked={!!reference}
              disabled={disabled || (!reference && value.references.length >= maximum)}
              onChange={() => update({ ...value, references: reference ? value.references.filter((item) => item !== reference)
                : [...value.references, { storageId: attachment.storageId! }] })} /><span className="min-w-0 break-words">{attachment.name}{reference ? ` · @Audio${value.references.indexOf(reference) + 1}` : ""}</span></label>
            {reference && <label className="block px-4 pb-4 text-xs text-muted">{t("vc_transcript")}<input aria-label={t("vc_transcript_for", {name: attachment.name})} placeholder={t("vc_transcript")} value={reference.transcript ?? ""} maxLength={10_000}
              disabled={disabled} className="mt-2 block w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm text-foreground"
              onChange={(event) => update({ ...value, references: value.references.map((item) => item === reference ? { ...item, transcript: event.target.value } : item) })} /></label>}
          </div>;
        })}
        </div>
        <div className="space-y-3 border-t border-border/50 pt-4">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-surface-2 px-4 py-3 leading-relaxed"><input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-primary" disabled={disabled || value.references.length === 0}
          checked={value.permissionConfirmed} onChange={(event) => onChange({ ...value, permissionConfirmed: event.target.checked })} />
          {t("vc_permission")}
        </label>
        <button type="button" disabled={disabled} onClick={() => onChange(undefined)} className="px-1 py-2 text-sm text-muted hover:text-foreground disabled:opacity-40">{t("vc_remove")}</button>
        </div>
      </>}
  </div>;
}
