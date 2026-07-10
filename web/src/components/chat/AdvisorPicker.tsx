import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Globe2, Info, Search, ShieldAlert, Sparkles, X } from "lucide-react";
import type { Id } from "@convex/_generated/dataModel";
import type { AdvisorEligibilityReason } from "@/advisors/types";
import type { AdvisorComposerOwner } from "@/hooks/useAdvisorComposer";
import type { PersonaItem } from "@/components/chat/ChatParticipantPicker.helpers";
import { PersonaAvatar } from "@/components/shared/PersonaAvatar";
import { PersonaInfoSheet } from "@/components/shared/PersonaInfoSheet";

function eligibilityKey(reason: AdvisorEligibilityReason | undefined): string | null {
  switch (reason) {
    case "not_pro": return "advisor_unavailable_pro";
    case "zdr_enabled": return "advisor_unavailable_zdr";
    case "google_protected": return "advisor_unavailable_google";
    case "media_output_turn": return "advisor_unavailable_media";
    case "participant_conflict": return "advisor_unavailable_conflict";
    case "unsupported_turn": return "advisor_unavailable_turn";
    case "no_capacity": return "advisor_unavailable_capacity";
    default: return null;
  }
}

function Toggle({ checked, label, onChange, disabled }: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-xs">
      <span className="text-muted">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-primary"
      />
    </label>
  );
}

interface AdvisorPickerProps {
  owner: AdvisorComposerOwner;
  personas: readonly PersonaItem[];
}

export function AdvisorPicker({ owner, personas }: AdvisorPickerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [infoPersona, setInfoPersona] = useState<PersonaItem | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const infoDialogRef = useRef<HTMLDivElement>(null);
  const infoTriggerRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closePicker = owner.close;
  const selectedMap = useMemo(
    () => new Map(owner.state.selections.map((selection) => [String(selection.personaId), selection])),
    [owner.state.selections],
  );
  const filteredPersonas = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...personas]
      .filter((persona) => !query || persona.displayName.toLocaleLowerCase().includes(query))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [personas, search]);
  const maxAdvisors = owner.eligibility?.maxAdvisors ?? 3;
  const reasonKey = eligibilityKey(owner.eligibility?.reasonCode);
  const additionsBlocked = owner.eligibility?.isAvailable === false &&
    owner.eligibility.reasonCode !== "no_capacity";
  const conflictIds = new Set([
    ...(owner.eligibility?.conflictingPersonaIds ?? []),
    ...owner.participantPersonaIds,
  ]);
  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    searchRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);
  useEffect(() => {
    if (!infoPersona) return;
    const previousFocus = infoTriggerRef.current ?? (
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    );
    infoDialogRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    return () => {
      previousFocus?.focus();
      infoTriggerRef.current = null;
    };
  }, [infoPersona]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (infoPersona) setInfoPersona(null);
        else closePicker();
        return;
      }
      if (event.key !== "Tab") return;
      const activeDialog = infoPersona ? infoDialogRef.current : dialogRef.current;
      if (!activeDialog) return;
      const focusable = Array.from(activeDialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closePicker, infoPersona]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 sm:items-center" onClick={owner.close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="advisor-picker-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border/50 bg-surface-1 shadow-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-border/30 px-4 py-3">
          <Sparkles size={18} className="text-primary" />
          <div className="min-w-0 flex-1">
            <h2 id="advisor-picker-title" className="text-base font-semibold">{t("advisors")}</h2>
            <p className="text-[11px] text-muted">
              {owner.participantCount > 1
                ? t("advisor_picker_subtitle_multi", { count: owner.participantCount })
                : t("advisor_picker_subtitle")}
            </p>
          </div>
          <span className="text-xs font-medium text-muted">{owner.state.selections.length}/{maxAdvisors}</span>
          <button type="button" onClick={owner.close} aria-label={t("close")} className="rounded p-1 text-muted hover:bg-surface-2">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-3 border-b border-border/30 px-4 py-3">
          {reasonKey && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-200">
              <ShieldAlert size={15} className="mt-0.5 shrink-0" />
              <span>{t(reasonKey)}</span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
            <Toggle
              checked={owner.state.defaultAllowWebSearch}
              label={t("advisor_default_internet")}
              onChange={owner.setDefaultAllowWebSearch}
              disabled={!owner.isHydrated}
            />
            <Toggle
              checked={owner.state.defaultKeepAvailable}
              label={t("advisor_default_keep")}
              onChange={owner.setDefaultKeepAvailable}
              disabled={!owner.isHydrated}
            />
          </div>
          <p className="text-[10px] leading-relaxed text-muted">{t("advisor_defaults_hint")}</p>
          <label className="block space-y-1">
            <span className="text-xs font-medium">{t("advisor_brief_optional")}</span>
            <textarea
              value={owner.state.brief}
              onChange={(event) => owner.setBrief(event.target.value)}
              rows={2}
              maxLength={2000}
              disabled={!owner.isHydrated || owner.state.selections.length === 0}
              placeholder={t("advisor_brief_placeholder")}
              className="w-full resize-none rounded-xl border border-border/40 bg-surface-2 px-3 py-2 text-sm placeholder:text-muted focus:border-primary/50 focus:outline-none"
            />
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              ref={searchRef}
              aria-label={t("search_personas")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("search_personas")}
              className="w-full rounded-xl border border-border/40 bg-surface-2 py-2 pl-8 pr-3 text-sm placeholder:text-muted focus:border-primary/50 focus:outline-none"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {filteredPersonas.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted">{t("no_personas_match")}</p>
          )}
          {filteredPersonas.map((persona) => {
            const selection = selectedMap.get(String(persona._id));
            const isSelected = selection !== undefined;
            const atLimit = owner.state.selections.length >= maxAdvisors;
            const isConflict = conflictIds.has(String(persona._id));
            const isUnavailable = owner.unavailablePersonaIds.has(String(persona._id));
            const disabled = !owner.isHydrated || (
              !isSelected && (additionsBlocked || atLimit || isConflict || isUnavailable)
            );
            return (
              <div key={persona._id} className={`border-b border-border/20 px-4 py-2.5 ${isSelected ? "bg-primary/5" : ""}`}>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => owner.togglePersona(persona._id as Id<"personas">)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-not-allowed disabled:opacity-40"
                    aria-pressed={isSelected}
                  >
                    <PersonaAvatar
                      personaId={persona._id}
                      personaName={persona.displayName}
                      personaEmoji={persona.avatarEmoji}
                      personaAvatarImageUrl={persona.avatarImageUrl}
                      className="h-9 w-9"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{persona.displayName}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {isConflict
                          ? t("advisor_already_participant")
                          : isUnavailable
                            ? t("advisor_model_unavailable")
                            : persona.personaDescription ?? t("private_advice")}
                      </span>
                    </span>
                    {isSelected && <Check size={16} className="shrink-0 text-primary" />}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      infoTriggerRef.current = event.currentTarget;
                      setInfoPersona(persona);
                    }}
                    aria-label={t("persona_info")}
                    className="rounded-full p-1 text-muted hover:bg-surface-2 hover:text-foreground"
                  >
                    <Info size={14} />
                  </button>
                </div>
                {selection && (
                  <div className="ml-12 mt-2 grid grid-cols-1 gap-x-5 rounded-xl bg-surface-2/70 px-3 py-1.5 sm:grid-cols-2">
                    <Toggle
                      checked={selection.allowWebSearch}
                      label={t("allow_internet_access")}
                      onChange={(allowWebSearch) => owner.updateSelection(persona._id, { allowWebSearch })}
                      disabled={!owner.isHydrated}
                    />
                    <Toggle
                      checked={selection.keepAvailable}
                      label={t("keep_available_in_chat")}
                      onChange={(keepAvailable) => owner.updateSelection(persona._id, { keepAvailable })}
                      disabled={!owner.isHydrated}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <footer className="border-t border-border/40 px-4 py-3">
          {owner.state.saveError && <p role="alert" className="mb-2 text-xs text-destructive">{owner.state.saveError}</p>}
          <div className="mb-2 flex items-center gap-1.5 text-[10px] text-muted">
            <Globe2 size={11} />
            <span>{t("advisor_private_cost_hint")}</span>
          </div>
          <button
            type="button"
            onClick={() => void owner.save()}
            disabled={!owner.isHydrated || owner.state.isSaving}
            className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {!owner.isHydrated || owner.state.isSaving ? t("advisor_loading") : t("done")}
          </button>
        </footer>

        {infoPersona && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 px-4" onClick={() => setInfoPersona(null)}>
            <div
              ref={infoDialogRef}
              role="dialog"
              aria-modal="true"
              aria-label={t("persona_info")}
              className="w-full max-w-md overflow-hidden rounded-2xl border border-border/50"
              onClick={(event) => event.stopPropagation()}
            >
              <PersonaInfoSheet persona={infoPersona} onClose={() => setInfoPersona(null)} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
