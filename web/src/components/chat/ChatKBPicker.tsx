// components/chat/ChatKBPicker.tsx
// Modal picker for attaching Knowledge Base files to the current message.
// Queries the user's KB files and lets them select/deselect files to include.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { X, Search, FileText, BookOpen } from "lucide-react";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";

// ─── Types ──────────────────────────────────────────────────────────────────

interface KBFile {
  storageId: string;
  filename: string;
  source: "upload" | "generated";
  sizeBytes?: number;
  createdAt?: number;
}

interface Props {
  selectedFileIds: Set<string>;
  onToggle: (storageId: string) => void;
  onClose: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes > 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ChatKBPicker({ selectedFileIds, onToggle, onClose }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");

  const files = useQuery(api.chat.queries.listKnowledgeBaseFiles, {
    ...(search ? { search } : {}),
    source: "all" as const,
  }) as KBFile[] | undefined;

  const filtered = useMemo(() => {
    if (!files) return [];
    if (!search.trim()) return files;
    const q = search.toLowerCase();
    return files.filter((f) => f.filename.toLowerCase().includes(q));
  }, [files, search]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md bg-surface-1 rounded-t-2xl sm:rounded-2xl overflow-hidden"
        style={{ maxHeight: "80vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border/50">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="text-primary" />
            <h2 className="text-base font-semibold">{t("knowledge_base")}</h2>
            {selectedFileIds.size > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 text-primary font-medium">
                {selectedFileIds.size}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-3 text-muted hover:text-foreground transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-3 pb-1">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="search"
              placeholder={t("search_files")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm bg-surface-2 border border-border/50 text-foreground placeholder-muted focus:outline-none focus:border-primary/50"
            />
          </div>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: "calc(80vh - 8rem)" }}>
          {files === undefined ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : filtered.length === 0 ? (
            <EmptyState hasSearch={search.length > 0} />
          ) : (
            <div className="divide-y divide-border/30">
              {filtered.map((file) => (
                <FileRow
                  key={file.storageId}
                  file={file}
                  selected={selectedFileIds.has(file.storageId)}
                  onToggle={() => onToggle(file.storageId)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {selectedFileIds.size > 0 && (
          <div className="px-5 py-3 border-t border-border/50">
            <p className="text-xs text-muted">
              {t("files_will_be_included", {
                var1: selectedFileIds.size,
                var2: selectedFileIds.size !== 1 ? "s" : "",
              })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FileRow({
  file,
  selected,
  onToggle,
}: {
  file: KBFile;
  selected: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-3 px-5 py-3 hover:bg-surface-2 transition-colors text-left"
    >
      {/* Checkbox */}
      <div
        className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
          selected
            ? "bg-primary border-primary"
            : "border-border hover:border-primary/50"
        }`}
      >
        {selected && (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 6L5 8.5L9.5 4"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {/* File icon */}
      <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center flex-shrink-0">
        <FileText size={14} className="text-foreground/50" />
      </div>

      {/* File info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{file.filename}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] px-1.5 py-0.5 rounded-md uppercase tracking-wide bg-surface-3 text-muted">
              {file.source === "upload" ? t("uploaded") : t("generated")}
            </span>
          {file.sizeBytes != null && (
            <span className="text-xs text-muted">{formatSize(file.sizeBytes)}</span>
          )}
        </div>
      </div>
    </button>
  );
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="px-5 py-12 text-center">
      <BookOpen size={32} className="text-muted mx-auto mb-3 opacity-40" />
      <p className="text-sm text-muted">
        {hasSearch ? t("no_files_found") : t("no_files_in_kb")}
      </p>
      <p className="text-xs text-muted mt-1">
        {hasSearch
          ? t("try_different_search")
          : t("upload_files_in_settings_kb")}
      </p>
    </div>
  );
}
