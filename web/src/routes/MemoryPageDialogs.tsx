import { useState, type PropsWithChildren, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import { Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSharedData } from "@/hooks/useSharedData";
import type {
  ImportedMemoryCandidate,
  MemoryCategory,
  MemoryDoc,
  MemoryRetrievalMode,
  MemoryScopeType,
} from "./MemoryPageHelpers";

type MemoryDraft = {
  content: string;
  category: MemoryCategory | "";
  retrievalMode: MemoryRetrievalMode;
  scopeType: MemoryScopeType;
  personaIds: string[];
  tagsText: string;
  isPinned: boolean;
};

const MEMORY_CATEGORIES = [
  "identity",
  "preferences",
  "work",
  "goals",
  "background",
  "writingStyle",
  "relationships",
  "skills",
  "tools",
  "logistics",
] as const;

const RETRIEVAL_OPTIONS = ["alwaysOn", "contextual", "disabled"] as const;
const SCOPE_OPTIONS = ["allPersonas", "selectedPersonas"] as const;

function draftFromMemory(memory?: MemoryDoc): MemoryDraft {
  return {
    content: memory?.content ?? "",
    category: memory?.category ?? "",
    retrievalMode: memory?.retrievalMode ?? "contextual",
    scopeType: memory?.scopeType ?? "allPersonas",
    personaIds: memory?.personaIds ?? [],
    tagsText: (memory?.tags ?? []).join(", "),
    isPinned: memory?.isPinned ?? false,
  };
}

function draftFromCandidate(candidate: ImportedMemoryCandidate): MemoryDraft {
  return {
    content: candidate.content,
    category: candidate.category ?? "",
    retrievalMode: candidate.retrievalMode,
    scopeType: candidate.scopeType,
    personaIds: candidate.personaIds ?? [],
    tagsText: (candidate.tags ?? []).join(", "),
    isPinned: candidate.isPinned ?? false,
  };
}

function candidateFromDraft(draft: MemoryDraft, sourceFileName?: string | null): ImportedMemoryCandidate {
  return {
    content: draft.content.trim(),
    category: draft.category || undefined,
    retrievalMode: draft.retrievalMode,
    scopeType: draft.scopeType,
    personaIds: draft.scopeType === "selectedPersonas" ? draft.personaIds : [],
    tags: draft.tagsText.split(",").map((tag) => tag.trim()).filter(Boolean),
    isPinned: draft.isPinned,
    sourceFileName,
  };
}

function MemoryFormFields({
  draft,
  onChange,
}: {
  draft: MemoryDraft;
  onChange: (draft: MemoryDraft) => void;
}) {
  const { t } = useTranslation();
  const { personas } = useSharedData();
  const availablePersonas = ((personas ?? []) as unknown as Array<{
    _id: string;
    displayName?: string;
  }>);

  const categoryLabel = (value: string) =>
    value === "writingStyle" ? t("memory_cat_writing_style") : t(`memory_cat_${value}`);

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <label className="text-xs text-muted">{t("memory_content_label")}</label>
        <textarea
          value={draft.content}
          onChange={(e) => onChange({ ...draft, content: e.target.value })}
          placeholder={t("memory_content_placeholder")}
          rows={3}
          className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-border/50 text-sm focus:outline-none focus:border-accent resize-none"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted">{t("memory_category_label")}</span>
          <select
            value={draft.category}
            onChange={(e) => onChange({ ...draft, category: e.target.value as MemoryDraft["category"] })}
            className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-border/50 text-sm"
          >
            <option value="">{t("memory_cat_none")}</option>
            {MEMORY_CATEGORIES.map((category) => (
              <option key={category} value={category}>{categoryLabel(category)}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs text-muted">Retrieval</span>
          <select
            value={draft.retrievalMode}
            onChange={(e) => onChange({ ...draft, retrievalMode: e.target.value as MemoryRetrievalMode })}
            className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-border/50 text-sm"
          >
            {RETRIEVAL_OPTIONS.map((option) => (
              <option key={option} value={option}>{t(`memory_retrieval_${option === "disabled" ? "ignored" : option === "alwaysOn" ? "always_on" : option}`)}</option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="text-xs text-muted">Scope</span>
          <select
            value={draft.scopeType}
            onChange={(e) => onChange({ ...draft, scopeType: e.target.value as MemoryScopeType })}
            className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-border/50 text-sm"
          >
            {SCOPE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "allPersonas" ? t("memory_scope_all_personas") : t("memory_scope_persona_specific")}
              </option>
            ))}
          </select>
        </label>
      </div>

      {draft.scopeType === "selectedPersonas" && availablePersonas.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs text-muted">Personas</span>
          <div className="flex flex-wrap gap-2">
            {availablePersonas.map((persona) => {
              const selected = draft.personaIds.includes(persona._id);
              return (
                <button
                  key={persona._id}
                  type="button"
                  onClick={() => onChange({
                    ...draft,
                    personaIds: selected
                      ? draft.personaIds.filter((id) => id !== persona._id)
                      : [...draft.personaIds, persona._id],
                  })}
                  className={[
                    "px-3 py-1.5 rounded-full text-xs transition-colors",
                    selected ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-foreground",
                  ].join(" ")}
                >
                  {persona.displayName ?? "Persona"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs text-muted">{t("tags")}</label>
        <input
          value={draft.tagsText}
          onChange={(e) => onChange({ ...draft, tagsText: e.target.value })}
          placeholder="work, style, travel"
          className="w-full px-3 py-2 rounded-xl bg-surface-2 border border-border/50 text-sm focus:outline-none focus:border-accent"
        />
      </div>

      <label className="flex items-center justify-between cursor-pointer">
        <span className="text-sm">{t("memory_pin_label")}</span>
        <input
          type="checkbox"
          checked={draft.isPinned}
          onChange={(e) => onChange({ ...draft, isPinned: e.target.checked })}
          className="w-4 h-4 rounded accent-accent"
        />
      </label>
    </div>
  );
}

function DialogShell({
  title,
  onClose,
  actions,
  children,
}: PropsWithChildren<{ title: string; onClose: () => void; actions: ReactNode }>) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-surface-1 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto space-y-4 p-6 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold">{title}</h3>
          {actions}
        </div>
        {children}
      </div>
    </div>
  );
}

export function MemoryEditorDialog({ memory, onClose }: { memory?: MemoryDoc; onClose: () => void }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => draftFromMemory(memory));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const createManual = useMutation(api.memory.operations.createManual);
  const updateMemory = useMutation(api.memory.operations.update);

  const handleSave = async () => {
    if (!draft.content.trim()) return;
    setSaving(true);
    setError(null);
    const payload = candidateFromDraft(draft);
    try {
      if (memory) {
        await updateMemory({ memoryId: memory._id, ...payload } as Parameters<typeof updateMemory>[0]);
      } else {
        await createManual(payload as Parameters<typeof createManual>[0]);
      }
      onClose();
    } catch {
      setError(t("memory_save_error"));
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title={memory ? t("edit") : t("add_memory")}
      onClose={onClose}
      actions={<button onClick={() => void handleSave()} disabled={saving || !draft.content.trim()} className="px-4 py-2 rounded-lg text-sm bg-accent text-white disabled:opacity-50">{saving ? t("saving") : t("save")}</button>}
    >
      <MemoryFormFields draft={draft} onChange={setDraft} />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </DialogShell>
  );
}

export function ImportReviewDialog({
  candidates,
  onClose,
  onSave,
}: {
  candidates: ImportedMemoryCandidate[];
  onClose: () => void;
  onSave: (candidates: ImportedMemoryCandidate[]) => Promise<void> | void;
}) {
  const { t } = useTranslation();
  const [drafts, setDrafts] = useState(() => candidates.map(draftFromCandidate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(
        drafts.map((draft, index) => candidateFromDraft(draft, candidates[index]?.sourceFileName)),
      );
    } catch {
      setError(t("memory_save_error"));
      setSaving(false);
    }
  };

  return (
    <DialogShell
      title={t("memory_import")}
      onClose={onClose}
      actions={<button onClick={() => void handleSave()} disabled={saving || drafts.every((draft) => !draft.content.trim())} className="px-4 py-2 rounded-lg text-sm bg-accent text-white disabled:opacity-50">{saving ? t("saving") : t("save")}</button>}
    >
      <div className="space-y-4">
        {drafts.map((draft, index) => (
          <div key={`${candidates[index]?.sourceFileName ?? "memory"}-${index}`} className="rounded-2xl bg-surface-2 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <Upload size={14} className="text-accent" />
                <span className="font-medium">{candidates[index]?.sourceFileName ?? `Candidate ${index + 1}`}</span>
              </div>
              {(candidates[index]?.importanceScore != null || candidates[index]?.confidenceScore != null) && (
                <span className="text-xs text-muted">
                  {[candidates[index]?.importanceScore, candidates[index]?.confidenceScore].filter((value) => value != null).map((value) => Number(value).toFixed(2)).join(" / ")}
                </span>
              )}
            </div>
            <MemoryFormFields
              draft={draft}
              onChange={(nextDraft) => setDrafts((current) => current.map((entry, entryIndex) => entryIndex === index ? nextDraft : entry))}
            />
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </DialogShell>
  );
}
