import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronRight, Cpu, Search, X } from "lucide-react";
import { useModelSummaries, useSharedData } from "@/hooks/useSharedData";
import { useConnectionFilter } from "@/hooks/useConnectionFilter";
import { ConnectionFilter } from "@/components/shared/ConnectionFilter";
import { type DraftStep, shortModelName } from "./ScheduledJobEditor.model";

// ─── Step Participant Section ───────────────────────────────────────────────

export function StepParticipantSection({
  step, onChange,
}: {
  step: DraftStep;
  onChange: (patch: Partial<DraftStep>) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { personas, prefs } = useSharedData();
  const { connectionFilter, setConnectionFilter, connectionPersonas } = useConnectionFilter();
  const modelSummaries = useModelSummaries();
  const zdrEnforced = prefs?.zdrEnabled === true;
  const [search, setSearch] = useState("");
  const q = search.toLowerCase();

  const modelZdrMap = useMemo(
    () => new Map(((modelSummaries ?? []) as Array<{ modelId: string; hasZdrEndpoint?: boolean }>).map((m) => [m.modelId, m.hasZdrEndpoint === true])),
    [modelSummaries],
  );

  const currentPersona = step.selectedPersonaId
    ? (personas ?? []).find((p) => p._id === step.selectedPersonaId)
    : null;

  const label = currentPersona
    ? (currentPersona as { displayName?: string }).displayName ?? t("persona")
    : shortModelName(step.modelId);

  const filteredPersonas = useMemo(() => {
    const all = (connectionPersonas ?? []) as Array<{ _id: string; displayName?: string; personaDescription?: string; avatarEmoji?: string; modelId?: string }>;
    if (!q) return all;
    return all.filter((p) => (p.displayName ?? "").toLowerCase().includes(q) || (p.personaDescription ?? "").toLowerCase().includes(q));
  }, [connectionPersonas, q]);

  const filteredModels = useMemo(() => {
    if (connectionFilter === "local") return [];
    const all = (modelSummaries ?? []) as Array<{ modelId: string; name: string; provider?: string; hasZdrEndpoint?: boolean }>;
    if (!q) return all;
    return all.filter((m) => m.name.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q));
  }, [modelSummaries, q, connectionFilter]);

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted uppercase tracking-wide px-1 pt-3 first:pt-0">{t("participant_section")}</h3>
      <div className="rounded-2xl bg-surface-2 overflow-hidden">
        <button
          onClick={() => setOpen(true)}
          className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-3 transition-colors text-left"
        >
          <Cpu size={16} className="text-primary flex-shrink-0" />
          <span className="text-sm flex-1">{t("model_and_persona")}</span>
          <span className="text-xs text-muted truncate max-w-[140px]">{label}</span>
          <ChevronRight size={14} className="text-foreground/30 flex-shrink-0" />
        </button>
      </div>
      {step.selectedPersonaId && (
        <p className="text-xs px-1 text-muted">{t("persona_overrides_footer")}</p>
      )}

      {/* Inline picker modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setOpen(false)}>
          <div className="bg-background rounded-2xl border border-border/50 shadow-xl w-full max-w-md max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
              <h2 className="text-base font-semibold">{t("model_and_persona")}</h2>
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-surface-3 text-muted"><X size={18} /></button>
            </div>
            <div className="px-4 pt-3 pb-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("search_generic_placeholder")} className="w-full pl-8 pr-4 py-2 text-sm bg-surface-2 border border-border/50 rounded-xl placeholder:text-muted focus:outline-none focus:border-accent/50" />
              </div>
            </div>
            <ConnectionFilter value={connectionFilter} onChange={setConnectionFilter} />
            <div className="flex-1 overflow-y-auto">
              {filteredPersonas.length > 0 && (
                <div>
                  <div className="px-4 py-1.5"><span className="text-xs font-medium text-foreground/50 uppercase tracking-wide">{t("personas_section_label")}</span></div>
                  {filteredPersonas.map((p) => {
                    const selected = step.selectedPersonaId === p._id;
                    const isZdrBlocked = zdrEnforced && p.modelId != null && !modelZdrMap.get(p.modelId);
                    return (
                      <button key={p._id} onClick={() => { if (!isZdrBlocked) { onChange({ selectedPersonaId: p._id, modelId: p.modelId || step.modelId }); setOpen(false); } }} className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left ${isZdrBlocked ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-3 cursor-pointer"}`}>
                        <div className="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0 text-sm">{p.avatarEmoji || "🤖"}</div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${selected ? "text-primary" : ""}`}>{p.displayName ?? t("unnamed")}</p>
                          {isZdrBlocked && <p className="text-[10px] text-muted">{t("zdr_model_not_supported")}</p>}
                        </div>
                        {selected && <Check size={14} className="text-primary flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
              {filteredModels.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 mt-1"><span className="text-xs font-medium text-foreground/50 uppercase tracking-wide">{t("models_section_label")}</span></div>
                  {filteredModels.map((m) => {
                    const selected = !step.selectedPersonaId && step.modelId === m.modelId;
                    const isZdrDisabled = zdrEnforced && !m.hasZdrEndpoint;
                    return (
                      <button key={m.modelId} onClick={() => { if (!isZdrDisabled) { onChange({ modelId: m.modelId, selectedPersonaId: null }); setOpen(false); } }} className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left ${isZdrDisabled ? "opacity-40 cursor-not-allowed" : "hover:bg-surface-3 cursor-pointer"}`}>
                        <div className="w-7 h-7 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0"><Cpu size={12} className="text-muted" /></div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${selected ? "text-primary" : ""}`}>{m.name}</p>
                          {m.provider && <p className="text-[11px] text-muted truncate capitalize">{m.provider}</p>}
                          {isZdrDisabled && <p className="text-[10px] text-muted">{t("zdr_model_not_supported")}</p>}
                        </div>
                        {selected && <Check size={14} className="text-primary flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

