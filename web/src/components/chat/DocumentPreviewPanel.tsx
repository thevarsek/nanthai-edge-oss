import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, X } from "lucide-react";
import { useAction, useQuery } from "convex/react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import type { GeneratedFileForPreview } from "./GeneratedFilesCard";
import { DocumentPreviewContent, type DocumentPreviewPayload } from "./DocumentPreviewContent";
import { workspaceIconBlockClass } from "@/lib/uiTokens";

type DocumentEditAnnotation = NonNullable<Message["documentEditAnnotations"]>[number];

type PreviewLoadState = {
  versionId?: string;
  preview: DocumentPreviewPayload | null;
  status: "idle" | "unavailable";
};

export type DocumentPreviewSelection = {
  messageId?: Id<"messages">;
  file?: GeneratedFileForPreview;
  generatedFileId?: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number | null;
  downloadUrl?: string | null;
  versionId?: string;
  annotations?: DocumentEditAnnotation[];
  focusEditId?: string;
};

function formatSize(bytes?: number | null): string | undefined {
  if (bytes == null) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeLabel(mimeType: string, t: TFunction): string {
  if (mimeType.includes("wordprocessingml") || mimeType.includes("msword")) return t("word_document");
  if (mimeType.includes("pdf")) return t("pdf");
  if (mimeType.startsWith("text/")) return t("text_file");
  if (mimeType === "message/rfc822") return t("email");
  return mimeType.split("/").pop() ?? t("file");
}

function isPdfPreview(filename: string, mimeType: string, downloadUrl: string | null): downloadUrl is string {
  const lowerName = filename.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  return Boolean(downloadUrl) && (lowerMime.includes("pdf") || lowerName.endsWith(".pdf"));
}

function metadata(selection: DocumentPreviewSelection, sizeBytes: number | null | undefined, t: TFunction): string {
  return [
    fileTypeLabel(selection.mimeType, t),
    formatSize(sizeBytes ?? selection.sizeBytes),
  ].filter(Boolean).join(" • ");
}

function documentStatusLabel(status: string, t: TFunction): string {
  switch (status) {
    case "pending": return t("pending");
    case "accepted": return t("accepted");
    case "rejected": return t("rejected");
    case "superseded": return t("superseded");
    case "unavailable": return t("unavailable");
    default: return status;
  }
}

export function DocumentPreviewPanel({
  selection,
  onClose,
}: {
  selection: DocumentPreviewSelection;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const editRefs = useRef(new Map<string, HTMLDivElement>());
  const [previewLoad, setPreviewLoad] = useState<PreviewLoadState>({
    preview: null,
    status: "unavailable",
  });
  const getDocumentPreview = useAction(api.documents.actions.getDocumentPreview);
  const files = useQuery(
    api.chat.queries.getGeneratedFilesByMessage,
    selection.messageId ? { messageId: selection.messageId } : "skip",
  );
  const generatedFile = useMemo(() => {
    const targetId = selection.generatedFileId ?? selection.file?._id;
    return files?.find((file) => file._id === targetId);
  }, [files, selection.file?._id, selection.generatedFileId]);
  const filename = generatedFile?.filename ?? selection.file?.filename ?? selection.filename;
  const mimeType = generatedFile?.mimeType ?? selection.file?.mimeType ?? selection.mimeType;
  const downloadUrl = generatedFile?.downloadUrl ?? selection.file?.downloadUrl ?? selection.downloadUrl ?? null;
  const sizeBytes = generatedFile?.sizeBytes ?? selection.file?.sizeBytes ?? selection.sizeBytes;
  const versionId = generatedFile?.documentVersionId ?? selection.versionId ?? selection.file?.documentVersionId;
  const annotations = selection.annotations ?? [];
  const focusedAnnotation = annotations.find((annotation) => annotation.editId === selection.focusEditId);
  const rendersPdf = isPdfPreview(filename, mimeType, downloadUrl);
  const preview = versionId && previewLoad.versionId === versionId ? previewLoad.preview : null;
  const previewState: "idle" | "loading" | "unavailable" = !versionId
    ? "unavailable"
    : previewLoad.versionId === versionId
      ? previewLoad.status
      : "loading";

  useEffect(() => {
    if (rendersPdf) return;
    if (!versionId) return;
    let cancelled = false;
    void getDocumentPreview({ versionId: versionId as Id<"documentVersions"> })
      .then((result) => {
        if (cancelled) return;
        setPreviewLoad({
          versionId,
          preview: result as DocumentPreviewPayload,
          status: "idle",
        });
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewLoad({
          versionId,
          preview: null,
          status: "unavailable",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [getDocumentPreview, rendersPdf, versionId]);

  useEffect(() => {
    if (!selection.focusEditId) return;
    window.setTimeout(() => {
      editRefs.current.get(selection.focusEditId as string)?.scrollIntoView({
        block: "center",
        behavior: "smooth",
      });
    }, 0);
  }, [selection.focusEditId, annotations.length]);

  return (
    <aside className="relative z-20 flex h-full w-full max-w-[560px] shrink-0 flex-col border-l border-border/50 bg-background shadow-xl lg:w-[520px]">
      <div className="flex min-h-[72px] items-center gap-3 border-b border-border/50 px-4 py-3">
        <div className={workspaceIconBlockClass("h-10 w-10")}>
          <FileText size={19} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{filename}</h2>
          <p className="mt-0.5 text-xs text-muted">{metadata({ ...selection, mimeType }, sizeBytes, t)}</p>
        </div>
        {downloadUrl && (
          <a
            href={downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            download={filename}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
            aria-label={t("download_filename", { filename })}
            title={t("download")}
          >
            <Download size={16} />
          </a>
        )}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          aria-label={t("close_document_preview")}
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-4">
          {rendersPdf ? (
            <div className="overflow-hidden rounded-lg border border-border/50 bg-white shadow-sm">
              <iframe
                title={filename}
                src={downloadUrl}
                className="h-[72vh] min-h-[520px] w-full bg-white"
              />
            </div>
          ) : preview ? (
            <DocumentPreviewContent preview={preview} focusedAnnotation={focusedAnnotation} />
          ) : previewState === "loading" ? (
            <div className="rounded-lg border border-border/50 bg-white px-6 py-7 shadow-sm">
              <div className="mb-4 h-4 w-3/4 animate-pulse rounded bg-surface-3" />
              <div className="mb-2 h-3 w-full animate-pulse rounded bg-surface-3" />
              <div className="mb-2 h-3 w-11/12 animate-pulse rounded bg-surface-3" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-surface-3" />
            </div>
          ) : (
            <div className="rounded-lg border border-border/50 bg-surface-2/40 px-4 py-5 text-sm text-muted">
              {t("document_preview_unavailable")}
            </div>
          )}

          {annotations.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-muted">
                <FileText size={13} />
                <span>{t("tracked_changes")}</span>
              </div>
              {annotations.map((annotation, index) => {
                const focused = annotation.editId === selection.focusEditId;
                return (
                  <div
                    key={annotation.editId}
                    ref={(node) => {
                      if (node) editRefs.current.set(annotation.editId as string, node);
                      else editRefs.current.delete(annotation.editId as string);
                    }}
                    className={`rounded-lg border p-3 text-sm transition-colors ${
                      focused ? "border-primary bg-primary/5" : "border-border/50 bg-surface-2/40"
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold text-foreground">{t("change_number", { number: index + 1 })}</span>
                      <span className="text-xs text-muted">{documentStatusLabel(annotation.displayStatus, t)}</span>
                    </div>
                    {annotation.contextBefore && (
                      <p className="mb-2 line-clamp-2 text-xs text-muted">{annotation.contextBefore}</p>
                    )}
                    {annotation.deletedText && (
                      <div className="mb-2 rounded-md bg-destructive/10 px-2 py-1.5 text-xs">
                        <span className="font-semibold text-destructive">{t("delete")}:</span>{" "}
                        <span className="text-foreground">{annotation.deletedText}</span>
                      </div>
                    )}
                    {annotation.insertedText && (
                      <div className="mb-2 rounded-md bg-primary/10 px-2 py-1.5 text-xs">
                        <span className="font-semibold text-primary">{t("insert")}:</span>{" "}
                        <span className="text-foreground">{annotation.insertedText}</span>
                      </div>
                    )}
                    {annotation.contextAfter && (
                      <p className="mt-2 line-clamp-2 text-xs text-muted">{annotation.contextAfter}</p>
                    )}
                    {annotation.reason && (
                      <p className="mt-3 text-xs leading-relaxed text-muted">{annotation.reason}</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
