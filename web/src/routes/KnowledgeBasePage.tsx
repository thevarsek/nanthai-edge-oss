import { useState, useMemo } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Search, FileText, Trash2, Download, Files, Image, Video, HardDrive, Quote } from "lucide-react";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ProGateWrapper } from "@/hooks/useProGate";
import { useConnectedAccounts } from "@/hooks/useSharedData";
import { useToast } from "@/components/shared/Toast.context";
import { convexErrorMessage } from "@/lib/convexErrors";
import {
  DriveImportProgress,
  driveImportErrorMessage,
  driveImportProgressMessage,
} from "@/lib/driveImportFeedback";
import { pickGoogleDriveFiles } from "@/lib/googleDrivePicker";
import { cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

const MAX_KB_UPLOAD_BYTES = 25 * 1024 * 1024;

type KBSource = "upload" | "generated" | "drive" | "all";
type KBFolderFilter = "all" | "unfiled" | string;

interface KBFile {
  storageId: string;
  fileAttachmentId?: string;
  filename: string;
  source: "upload" | "generated" | "drive";
  sizeBytes?: number;
  createdAt?: number;
  downloadUrl?: string | null;
  mimeType?: string;
  toolName?: string;
  documentId?: string;
  documentVersionId?: string;
  documentStatus?: string;
  documentExtractionStatus?: string;
  documentVersionNumber?: number;
  documentSyncState?: string;
  documentExternalSyncedVersionId?: string;
  documentExternalSyncedVersionNumber?: number;
  documentExternalSyncedDownloadUrl?: string | null;
  documentFolderId?: string;
  isReadableDocument?: boolean;
}

interface DocumentVersionDownload {
  versionId: string;
  documentId: string;
  filename: string;
  mimeType: string;
  downloadUrl: string | null;
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

function fileIcon(mime?: string) {
  if (mime?.startsWith("video/")) return <Video size={14} className="text-foreground/50" />;
  if (mime?.startsWith("image/")) return <Image size={14} className="text-foreground/50" />;
  return <FileText size={14} className="text-foreground/50" />;
}

function FileRow({
  file,
  onDelete,
  onViewDriveVersion,
  onMakeDriveVersionCurrent,
}: {
  file: KBFile;
  onDelete: (storageId: string, source: "upload" | "generated" | "drive") => void;
  onViewDriveVersion: (file: KBFile) => void;
  onMakeDriveVersionCurrent: (file: KBFile) => void;
}) {
  const { t } = useTranslation();
  const hasDriveUpdate = file.documentSyncState === "external_update_available" && !!file.documentExternalSyncedVersionId;
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

  const isImage = file.mimeType?.startsWith("image/");
  const isVideo = file.mimeType?.startsWith("video/");
  const supportsDocumentChat = file.isReadableDocument === true || !!file.documentId;
  const documentStatus = supportsDocumentChat
    ? [
        file.documentExtractionStatus === "ready"
          ? t("kb_document_ready")
          : file.documentExtractionStatus === "extracting" || file.documentExtractionStatus === "pending"
          ? t("kb_document_preparing")
          : file.documentExtractionStatus === "failed"
          ? t("kb_document_unavailable")
          : file.documentExtractionStatus === "error" || file.documentExtractionStatus === "unsupported"
          ? t("kb_document_unavailable")
          : t("kb_document_readable"),
        (file.documentSyncState === "current" || file.documentSyncState === "updated_from_drive") && file.source === "drive"
          ? t("updated_from_drive")
          : file.documentSyncState === "external_update_available"
          ? t("drive_update_available")
          : file.documentSyncState === "local_ahead"
          ? t("local_edits_ahead")
          : null,
      ].filter(Boolean).join(" · ")
    : null;

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      {/* Thumbnail for images, poster frame for videos, icon for everything else */}
      {isImage && file.downloadUrl ? (
        <img
          src={file.downloadUrl}
          alt={file.filename}
          className="w-8 h-8 rounded-lg object-cover flex-shrink-0 bg-surface-3"
        />
      ) : isVideo && file.downloadUrl ? (
        <video
          src={file.downloadUrl}
          className="w-8 h-8 rounded-lg object-cover flex-shrink-0 bg-surface-3"
          muted
          preload="metadata"
        />
      ) : (
        <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center flex-shrink-0">
          {fileIcon(file.mimeType)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm truncate text-foreground">
          {file.filename}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-md uppercase tracking-wide inline-flex items-center gap-1",
              file.source === "upload"
                ? "bg-surface-3 text-foreground/55"
                : file.source === "drive"
                ? "bg-blue-500/15 text-blue-500"
                : "bg-accent/15 text-accent",
            )}
          >
            {file.source === "drive" && <HardDrive size={9} />}
            {file.source === "upload"
              ? t("uploaded_source")
              : file.source === "drive"
              ? t("drive_source")
              : t("ai_generated_source")}
          </span>
          {file.sizeBytes != null && (
            <span className="text-xs text-foreground/50">
              {formatFileSize(file.sizeBytes)}
            </span>
          )}
        </div>
        {documentStatus && (
          <div className="mt-1 flex items-center gap-1 text-xs text-foreground/50">
            <Quote size={11} />
            <span className="truncate">{documentStatus}</span>
          </div>
        )}
      </div>
      <button
        onClick={handleDownload}
        disabled={!file.downloadUrl}
        className="p-1.5 rounded-lg transition-colors flex-shrink-0 disabled:opacity-30 text-foreground/50"
        title={t("download")}
      >
        <Download size={14} />
      </button>
      {hasDriveUpdate && (
        <>
          <button
            onClick={() => onViewDriveVersion(file)}
            className="p-1.5 rounded-lg text-foreground/50 hover:text-blue-400 transition-colors flex-shrink-0"
            title={t("view_drive_version")}
          >
            <HardDrive size={14} />
          </button>
          <button
            onClick={() => onMakeDriveVersionCurrent(file)}
            className="px-2 py-1 rounded-lg text-xs text-primary hover:bg-primary/10 transition-colors flex-shrink-0"
            title={t("make_current")}
          >
            {t("make_current")}
          </button>
        </>
      )}
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
  const { toast } = useToast();
  const { googleConnection } = useConnectedAccounts();
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<KBSource>("all");
  const [folderFilter, setFolderFilter] = useState<KBFolderFilter>("all");
  const [deleteTarget, setDeleteTarget] = useState<{
    storageId: string;
    fileAttachmentId?: string;
    source: "upload" | "generated" | "drive";
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [importingFromDrive, setImportingFromDrive] = useState(false);
  const [driveImportProgress, setDriveImportProgress] = useState<DriveImportProgress | null>(null);

  const files = useQuery(api.knowledge_base.queries.listKnowledgeBaseFiles, {
    ...(search ? { search } : {}),
    source: sourceFilter,
    ...(folderFilter === "unfiled" ? { folderFilter: "unfiled" as const } : {}),
    ...(folderFilter !== "all" && folderFilter !== "unfiled" ? { folderId: folderFilter as Id<"folders"> } : {}),
  });
  const folders = useQuery(api.folders.queries.list) as Array<{ _id: string; name: string }> | undefined;

  const createKnowledgeBaseUploadUrl = useMutation(
    api.knowledge_base.mutations.createKnowledgeBaseUploadUrl,
  );
  const bindKnowledgeBaseUploadSession = useMutation(
    api.knowledge_base.mutations.bindKnowledgeBaseUploadSession,
  );
  const addUploadToKnowledgeBase = useMutation(
    api.knowledge_base.mutations.addUploadToKnowledgeBase,
  );
  const deleteFile = useMutation(api.knowledge_base.mutations.deleteKnowledgeBaseFile);
  const makeCurrentVersion = useMutation(api.documents.mutations.makeCurrentVersion);
  const getDrivePickerAccessToken = useAction(api.oauth.google.getDrivePickerAccessToken);
  const importDriveFileToKnowledgeBase = useAction(
    api.knowledge_base.actions.importDriveFileToKnowledgeBase,
  );

  const grouped = useMemo(() => {
    if (!files) return [];
    return groupFilesByDate([...files] as KBFile[], t);
  }, [files, t]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files ?? []);
    if (selectedFiles.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of selectedFiles) {
        if (file.size > MAX_KB_UPLOAD_BYTES) {
          throw new Error(
            t("kb_upload_file_too_large_arg", {
              var1: formatFileSize(MAX_KB_UPLOAD_BYTES),
            }),
          );
        }
        const { uploadUrl, uploadSessionId } = await createKnowledgeBaseUploadUrl({});
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!res.ok) throw new Error("Upload failed");
        const { storageId } = (await res.json()) as { storageId: string };
        await bindKnowledgeBaseUploadSession({
          uploadSessionId,
          storageId: storageId as Id<"_storage">,
        });
        // Register the uploaded blob as a KB file. Without this, the `_storage`
        // row exists but no `fileAttachments` row points at it, so the file
        // never appears in the KB list.
        await addUploadToKnowledgeBase({
          storageId: storageId as Id<"_storage">,
          uploadSessionId,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        });
      }
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

  const handleImportFromDrive = async () => {
    if (importingFromDrive) return;
    if (googleConnection?.hasDrive !== true) {
      toast({
        message: t("connect_google_drive_before_choosing_files"),
        variant: "error",
      });
      return;
    }

    const developerKey =
      import.meta.env.VITE_GOOGLE_PICKER_API_KEY ?? import.meta.env.VITE_GOOGLE_API_KEY;
    const appId =
      import.meta.env.VITE_GOOGLE_PICKER_APP_ID ?? import.meta.env.VITE_GOOGLE_PROJECT_NUMBER;
    if (!developerKey || !appId) {
      toast({
        message: t("google_drive_picker_not_configured"),
        variant: "error",
      });
      return;
    }

    setImportingFromDrive(true);
    setDriveImportProgress(null);
    try {
      const token = await getDrivePickerAccessToken({});
      const picked = await pickGoogleDriveFiles({
        accessToken: token.accessToken,
        appId,
        developerKey,
        multiselect: true,
      });
      if (picked.length === 0) return;
      setDriveImportProgress({ current: 0, total: picked.length });

      // Import sequentially so a transient failure on one file doesn't poison
      // the rest of the batch — successful imports stay imported.
      let imported = 0;
      const failures: string[] = [];
      for (const [index, file] of picked.entries()) {
        setDriveImportProgress({
          current: index + 1,
          total: picked.length,
          filename: file.name,
        });
        try {
          await importDriveFileToKnowledgeBase({ fileId: file.id });
          imported++;
        } catch (error) {
          failures.push(driveImportErrorMessage(error, file.name, t, navigator.language));
        }
      }
      if (imported > 0) {
        toast({
          message: t("kb_drive_import_succeeded", { count: imported }),
          variant: "success",
        });
      }
      if (failures.length > 0) {
        toast({
          message: t("kb_drive_import_partial_failure", {
            count: failures.length,
            error: failures[0],
          }),
          variant: "error",
        });
      }
    } catch (error) {
      toast({
        message: convexErrorMessage(error, t("google_drive_picker_failed")),
        variant: "error",
      });
    } finally {
      setImportingFromDrive(false);
      setDriveImportProgress(null);
    }
  };

  const openVersionDownload = (version: DocumentVersionDownload) => {
    if (!version.downloadUrl) {
      toast({ message: t("something_went_wrong"), variant: "error" });
      return;
    }
    const a = document.createElement("a");
    a.href = version.downloadUrl;
    a.download = version.filename;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleViewDriveVersion = (file: KBFile) => {
    if (!file.documentExternalSyncedVersionId || !file.documentId) return;
    openVersionDownload({
      versionId: file.documentExternalSyncedVersionId,
      documentId: file.documentId,
      filename: file.filename,
      mimeType: file.mimeType ?? "application/octet-stream",
      downloadUrl: file.documentExternalSyncedDownloadUrl ?? null,
    });
  };

  const handleMakeDriveVersionCurrent = async (file: KBFile) => {
    if (!file.documentId || !file.documentExternalSyncedVersionId) return;
    try {
      await makeCurrentVersion({
        documentId: file.documentId as Id<"documents">,
        versionId: file.documentExternalSyncedVersionId as Id<"documentVersions">,
      });
      toast({ message: t("updated_from_drive"), variant: "success" });
    } catch (error) {
      toast({ message: convexErrorMessage(error, t("something_went_wrong")), variant: "error" });
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
        <button
          type="button"
          onClick={handleImportFromDrive}
          disabled={importingFromDrive || uploading}
          className={cn(
            "px-3 py-1.5 rounded-lg bg-surface-2 text-foreground text-sm font-medium border border-border/50 inline-flex items-center gap-1.5 transition-opacity",
            importingFromDrive || uploading
              ? "opacity-50 pointer-events-none"
              : "hover:bg-surface-3",
          )}
          title={t("import_from_drive")}
        >
          <HardDrive size={14} />
          {importingFromDrive ? t("importing") : t("import_from_drive")}
        </button>
        <label
          className={cn(
            "px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium cursor-pointer transition-opacity",
            uploading || importingFromDrive ? "opacity-50 pointer-events-none" : "hover:opacity-90",
          )}
        >
          {uploading ? t("uploading_file") : t("upload")}
          <input type="file" className="hidden" onChange={handleUpload} accept=".pdf,.txt,.md,.docx,.csv" multiple />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-4 space-y-4">
          {uploadError && (
            <p className="text-sm text-red-400">{uploadError}</p>
          )}
          <div className="flex items-center gap-2 rounded-xl border border-border/50 bg-surface-2 px-3 py-2 text-sm text-foreground/60">
            <Quote size={15} className="text-accent" />
            <span>{t("kb_document_chat_helper")}</span>
          </div>
          {driveImportProgress && (
            <div className="flex items-center gap-3 rounded-xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-500">
              <LoadingSpinner size="sm" />
              <span className="min-w-0 truncate">
                {driveImportProgressMessage(driveImportProgress, t)}
              </span>
            </div>
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
            {(["all", "upload", "generated", "drive"] as const).map((s) => (
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
                {s === "all"
                  ? t("all_files")
                  : s === "upload"
                  ? t("uploaded_source")
                  : s === "drive"
                  ? t("drive_source")
                  : t("ai_generated")}
              </button>
            ))}
          </div>

          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {[
              { id: "all", label: t("all") },
              { id: "unfiled", label: t("unfiled") },
              ...((folders ?? []).map((folder) => ({ id: folder._id, label: folder.name }))),
            ].map((folder) => (
              <button
                key={folder.id}
                onClick={() => setFolderFilter(folder.id)}
                className={cn(
                  "shrink-0 px-3 py-1.5 rounded-lg text-sm transition-colors",
                  folderFilter === folder.id
                    ? "bg-accent text-white"
                    : "bg-surface-2 text-foreground/60",
                )}
              >
                {folder.label}
              </button>
            ))}
          </div>

          {/* File list — grouped by date like iOS */}
          {files === undefined ? (
            <div className="flex justify-center py-8"><LoadingSpinner /></div>
          ) : grouped.length === 0 ? (
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
                      onDelete={(storageId, source) => setDeleteTarget({
                        storageId,
                        fileAttachmentId: file.fileAttachmentId,
                        source,
                      })}
                      onViewDriveVersion={handleViewDriveVersion}
                      onMakeDriveVersionCurrent={handleMakeDriveVersionCurrent}
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
              ...(deleteTarget.fileAttachmentId
                ? { fileAttachmentId: deleteTarget.fileAttachmentId as Id<"fileAttachments"> }
                : {}),
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
