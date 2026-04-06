// components/chat/ToolResultRenderers.simple.tsx
// Simple key-value renderers for smaller workspace tools.
// Split from ToolResultRenderers.tsx for the 300-line rule.

import { FileText, Download, FolderPlus, RefreshCw, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "./ToolResultRenderers";
import { formatBytes } from "./ToolResultRenderers.utils";

// ---------------------------------------------------------------------------
// workspace_write_file
// ---------------------------------------------------------------------------

export function WorkspaceWriteFileResult({ data }: { data: Record<string, unknown> }) {
  const d = (data.data ?? data) as Record<string, unknown>;
  const path = String(d.path ?? "");
  const bytesWritten = d.bytesWritten as number | undefined;
  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      <FileText size={12} className="text-green-400" />
      <span className="font-mono text-foreground truncate">{path}</span>
      {bytesWritten !== undefined && <Badge>{formatBytes(bytesWritten)}</Badge>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// workspace_make_dirs
// ---------------------------------------------------------------------------

export function WorkspaceMakeDirsResult({ data }: { data: Record<string, unknown> }) {
  const d = (data.data ?? data) as Record<string, unknown>;
  const path = String(d.path ?? "");
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <FolderPlus size={12} className="text-blue-400" />
      <span className="font-mono text-foreground truncate">{path}</span>
      {!!d.created && <Badge variant="success">created</Badge>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// workspace_export_file
// ---------------------------------------------------------------------------

export function WorkspaceExportFileResult({ data }: { data: Record<string, unknown> }) {
  const { t } = useTranslation();
  const d = (data.data ?? data) as Record<string, unknown>;
  const filename = String(d.filename ?? "");
  const mimeType = d.mimeType ? String(d.mimeType) : null;
  const sizeBytes = d.sizeBytes as number | undefined;
  const downloadUrl = d.downloadUrl ? String(d.downloadUrl) : null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <Download size={12} className="text-primary" />
        <span className="font-mono text-foreground truncate">{filename}</span>
        {mimeType && <Badge>{mimeType}</Badge>}
        {sizeBytes !== undefined && <Badge>{formatBytes(sizeBytes)}</Badge>}
      </div>
      {downloadUrl && (
        <a
          href={downloadUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[11px] text-primary hover:underline truncate block"
        >
          {t("download")}
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// workspace_import_file
// ---------------------------------------------------------------------------

export function WorkspaceImportFileResult({ data }: { data: Record<string, unknown> }) {
  const d = (data.data ?? data) as Record<string, unknown>;
  const label = String(d.filename ?? d.path ?? "");
  const mimeType = d.mimeType ? String(d.mimeType) : null;
  const sizeBytes = d.sizeBytes as number | undefined;
  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      <Upload size={12} className="text-primary" />
      <span className="font-mono text-foreground truncate">{label}</span>
      {mimeType && <Badge>{mimeType}</Badge>}
      {sizeBytes !== undefined && <Badge>{formatBytes(sizeBytes)}</Badge>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// workspace_reset
// ---------------------------------------------------------------------------

export function WorkspaceResetResult({ data }: { data: Record<string, unknown> }) {
  const { t } = useTranslation();
  const d = (data.data ?? data) as Record<string, unknown>;
  const cwd = d.cwd ? String(d.cwd) : null;
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <RefreshCw size={12} className="text-yellow-400" />
      <span className="text-foreground">{t("workspace_reset_label")}</span>
      {cwd && <Badge>{cwd}</Badge>}
    </div>
  );
}
