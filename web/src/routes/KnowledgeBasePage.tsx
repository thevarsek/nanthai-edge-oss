import { useState, useMemo } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Search, FileText, Trash2, Download, Files } from "lucide-react";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ProGateWrapper } from "@/hooks/useProGate";
import { convexErrorMessage } from "@/lib/convexErrors";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

type KBSource = "upload" | "generated" | "all";

interface KBFile {
  storageId: string;
  filename: string;
  source: "upload" | "generated";
  sizeBytes?: number;
  createdAt?: number;
  downloadUrl?: string | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes > 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function getDateGroup(ts: number | undefined, t: (key: string) => string): string {
  if (!ts) return t("date_unknown");
  const now = new Date();
  const d = new Date(ts);
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffDays === 0) return t("date_today");
  if (diffDays === 1) return t("date_yesterday");
  if (diffDays < 7) return t("date_last_7_days");
  if (diffDays < 30) return t("date_last_30_days");
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function groupFilesByDate(files: KBFile[], t: (key: string) => string): { header: string; files: KBFile[] }[] {
  const groups = new Map<string, KBFile[]>();
  for (const f of files) {
    const key = getDateGroup(f.createdAt, t);
    const arr = groups.get(key) ?? [];
    arr.push(f);
    groups.set(key, arr);
  }
  return Array.from(groups.entries()).map(([header, files]) => ({ header, files }));
}

// ─── File row ──────────────────────────────────────────────────────────────

function FileRow({
  file,
  onDelete,
}: {
  file: KBFile;
  onDelete: (storageId: string, source: "upload" | "generated") => void;
}) {
  const { t } = useTranslation();
  const handleDownload = () => {
    if (!file.downloadUrl) return;
    const a = document.createElement("a");
    a.href = file.downloadUrl;
    a.download = file.filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center flex-shrink-0">
        <FileText size={14} className="text-foreground/50" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate text-foreground">
          {file.filename}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-md uppercase tracking-wide",
              file.source === "upload"
                ? "bg-surface-3 text-foreground/55"
                : "bg-accent/15 text-accent",
            )}
          >
            {file.source === "upload" ? t("uploaded_source") : t("ai_generated_source")}
          </span>
          {file.sizeBytes != null && (
            <span className="text-xs text-foreground/50">
              {formatFileSize(file.sizeBytes)}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={handleDownload}
        disabled={!file.downloadUrl}
        className="p-1.5 rounded-lg transition-colors flex-shrink-0 disabled:opacity-30 text-foreground/50"
        title={t("download")}
      >
        <Download size={14} />
      </button>
      <button
        onClick={() => onDelete(file.storageId, file.source)}
        className="p-1.5 rounded-lg text-foreground/50 hover:text-red-400 transition-colors flex-shrink-0"
        title={t("delete")}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ─── Page content ──────────────────────────────────────────────────────────

function KnowledgeBasePageContent() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<KBSource>("all");
  const [deleteTarget, setDeleteTarget] = useState<{
    storageId: string;
    source: "upload" | "generated";
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const files = useQuery(api.chat.queries.listKnowledgeBaseFiles, {
    ...(search ? { search } : {}),
    source: sourceFilter,
  });

  const createUploadUrl = useMutation(api.chat.mutations.createUploadUrl);
  const deleteFile = useMutation(api.chat.mutations.deleteKnowledgeBaseFile);

  const grouped = useMemo(() => {
    if (!files) return [];
    return groupFilesByDate([...files] as KBFile[], t);
  }, [files, t]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uploadUrl = await createUploadUrl({});
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed");
    } catch (error) {
      setUploadError(
        t("upload_failed_arg", {
          var1: convexErrorMessage(error, "Unknown error"),
        }),
      );
    } finally {
      setUploading(false);
      e.target.value = "";
    }
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
        <h1 className="text-lg font-semibold flex-1">
          {t("knowledge_base")}
        </h1>
        <label
          className={cn(
            "px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium cursor-pointer transition-opacity",
            uploading ? "opacity-50 pointer-events-none" : "hover:opacity-90",
          )}
        >
          {uploading ? t("uploading_file") : t("upload")}
          <input type="file" className="hidden" onChange={handleUpload} accept=".pdf,.txt,.md,.docx,.csv" />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          {uploadError && (
            <p className="text-sm text-red-400">{uploadError}</p>
          )}
          {/* Search */}
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/40"
            />
            <input
              type="search"
              placeholder={t("search_placeholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 rounded-xl text-sm focus:outline-none bg-surface-2 border border-border/50 text-foreground"
            />
          </div>

          {/* Source filter */}
          <div className="flex gap-1.5">
            {(["all", "upload", "generated"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm transition-colors",
                  sourceFilter === s
                    ? "bg-accent text-white"
                    : "bg-surface-2 text-foreground/60",
                )}
              >
                {s === "all" ? t("all_files") : s === "upload" ? t("uploaded_source") : t("ai_generated")}
              </button>
            ))}
          </div>

          {/* File list — grouped by date like iOS */}
          {files === undefined ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : files.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <Files size={48} strokeWidth={1} className="text-foreground/25" />
              <div className="text-center">
                <p className="font-medium text-foreground">
                  {search ? t("no_files_found") : t("no_files_yet")}
                </p>
                <p className="text-sm mt-1 max-w-xs text-foreground/50">
                  {search
                    ? t("no_files_match_search")
                    : t("kb_empty_description")}
                </p>
              </div>
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.header} className="space-y-2">
                <h3 className="text-xs font-medium uppercase tracking-wide px-1 text-muted">
                  {group.header}
                </h3>
                <div className="rounded-2xl overflow-hidden divide-y divide-border/50 bg-surface-2">
                  {group.files.map((file) => (
                    <FileRow
                      key={file.storageId}
                      file={file}
                      onDelete={(storageId, source) => setDeleteTarget({ storageId, source })}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) {
            void deleteFile({
              storageId: deleteTarget.storageId as Id<"_storage">,
              source: deleteTarget.source,
            });
          }
          setDeleteTarget(null);
        }}
        title={t("delete_file_title")}
        description={t("delete_file_description")}
        confirmLabel={t("delete")}
        confirmVariant="destructive"
      />
    </div>
  );
}

export function KnowledgeBasePage() {
  return (
    <ProGateWrapper feature="Knowledge Base">
      <KnowledgeBasePageContent />
    </ProGateWrapper>
  );
}
