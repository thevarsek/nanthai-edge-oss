import type { Id } from "@convex/_generated/dataModel";
import { Check, MapPin, Pencil, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";

export type MemoryCategory =
  | "background"
  | "identity"
  | "writingStyle"
  | "work"
  | "goals"
  | "relationships"
  | "preferences"
  | "tools"
  | "skills"
  | "logistics";

export type MemoryRetrievalMode = "alwaysOn" | "contextual" | "disabled";
export type MemoryScopeType = "allPersonas" | "selectedPersonas";

export interface MemoryDoc {
  _id: Id<"memories">;
  content: string;
  category?: MemoryCategory;
  retrievalMode?: MemoryRetrievalMode;
  scopeType?: MemoryScopeType;
  sourceType?: string;
  sourceFileName?: string | null;
  isPinned?: boolean;
  isPending?: boolean;
  personaIds?: string[];
  tags?: string[];
}

export interface ImportedMemoryCandidate {
  content: string;
  category?: MemoryCategory;
  retrievalMode: MemoryRetrievalMode;
  scopeType: MemoryScopeType;
  personaIds?: string[];
  tags?: string[];
  isPinned?: boolean;
  sourceFileName?: string | null;
  importanceScore?: number | null;
  confidenceScore?: number | null;
}

export function MemoryItemRow({
  memory,
  onDelete,
  onPin,
  onApprove,
  onReject,
  onEdit,
}: {
  memory: MemoryDoc;
  onDelete: (id: Id<"memories">) => void;
  onPin: (id: Id<"memories">) => void;
  onApprove: (id: Id<"memories">) => void;
  onReject: (id: Id<"memories">) => void;
  onEdit?: (memory: MemoryDoc) => void;
}) {
  const { t } = useTranslation();
  const isPending = memory.isPending === true;
  const tags = memory.tags ?? [];

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <button
        type="button"
        onClick={() => onEdit?.(memory)}
        disabled={onEdit === undefined}
        className="flex-1 min-w-0 text-left disabled:cursor-default"
      >
        <p className="text-sm leading-relaxed">{memory.content}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {memory.category && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface-3 text-muted uppercase tracking-wide">
              {memory.category}
            </span>
          )}
          {isPending && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-400/15 text-amber-400 uppercase tracking-wide">
              {t("memory_pending_badge")}
            </span>
          )}
          {memory.isPinned && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-accent/15 text-accent uppercase tracking-wide">
              {t("memory_pinned_badge")}
            </span>
          )}
          {memory.scopeType === "selectedPersonas" && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface-3 text-muted">
              {t("persona_specific")}
            </span>
          )}
          {tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface-3 text-muted"
            >
              #{tag}
            </span>
          ))}
          {memory.sourceFileName && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-surface-3 text-muted">
              {memory.sourceFileName}
            </span>
          )}
        </div>
      </button>
      <div className="flex items-center gap-1 flex-shrink-0">
        {onEdit && (
          <button
            onClick={() => onEdit(memory)}
            className="p-1.5 rounded-lg text-muted hover:text-foreground transition-colors"
            title={t("edit")}
          >
            <Pencil size={14} />
          </button>
        )}
        {isPending && (
          <>
            <button
              onClick={() => onApprove(memory._id)}
              className="p-1.5 rounded-lg hover:bg-green-400/15 text-muted hover:text-green-400 transition-colors"
              title={t("memory_approve_title")}
            >
              <Check size={14} />
            </button>
            <button
              onClick={() => onReject(memory._id)}
              className="p-1.5 rounded-lg hover:bg-red-400/15 text-muted hover:text-red-400 transition-colors"
              title={t("memory_reject_title")}
            >
              <X size={14} />
            </button>
          </>
        )}
        <button
          onClick={() => onPin(memory._id)}
          className={memory.isPinned
            ? "p-1.5 rounded-lg text-accent"
            : "p-1.5 rounded-lg text-muted hover:text-foreground transition-colors"}
          title={memory.isPinned ? t("memory_unpin_title") : t("memory_pin_title")}
        >
          <MapPin size={14} fill={memory.isPinned ? "currentColor" : "none"} />
        </button>
        <button
          onClick={() => onDelete(memory._id)}
          className="p-1.5 rounded-lg text-muted hover:text-red-400 transition-colors"
          title={t("delete")}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
