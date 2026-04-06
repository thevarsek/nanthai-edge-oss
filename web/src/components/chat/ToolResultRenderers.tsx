// components/chat/ToolResultRenderers.tsx
// Structured renderers for workspace/sandbox tool results.
// Replaces raw JSON <pre> blocks with formatted displays.
// Complex renderers here; simple ones in ToolResultRenderers.simple.tsx.

import { File, Folder, Terminal, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatBytes } from "./ToolResultRenderers.utils";

export function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "success" | "error" }) {
  const cls =
    variant === "success"
      ? "bg-green-900/30 text-green-400 border-green-700/40"
      : variant === "error"
        ? "bg-red-900/30 text-red-400 border-red-700/40"
        : "bg-surface-3/50 text-muted border-border/20";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls}`}>
      {children}
    </span>
  );
}

export function CodeBlock({ children, color }: { children: string; color?: string }) {
  return (
    <pre
      className="rounded p-2 overflow-x-auto leading-relaxed whitespace-pre-wrap break-all text-[11px] bg-surface-2/50 font-mono"
      style={color ? { color } : undefined}
    >
      {children}
    </pre>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted mb-1 uppercase tracking-wider text-[10px] font-medium">
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// workspace_exec
// ---------------------------------------------------------------------------

export function WorkspaceExecResult({ data }: { data: Record<string, unknown> }) {
  const { t } = useTranslation();
  const d = (data.data ?? data) as Record<string, unknown>;
  const stdout = (d.stdout as string) || "";
  const stderr = (d.stderr as string) || "";
  const exitCode = d.exitCode as number | undefined;
  const durationMs = d.durationMs as number | undefined;
  const cwd = d.cwd as string | undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Terminal size={12} className="text-muted" />
        {exitCode !== undefined && (
          <Badge variant={exitCode === 0 ? "success" : "error"}>
            exit {exitCode}
          </Badge>
        )}
        {durationMs !== undefined && (
          <Badge>{(durationMs / 1000).toFixed(2)}s</Badge>
        )}
        {cwd && <span className="text-[10px] text-muted truncate">{cwd}</span>}
      </div>
      {stdout && (
        <div>
          <SectionLabel>stdout</SectionLabel>
          <CodeBlock color="#86efac">{stdout}</CodeBlock>
        </div>
      )}
      {stderr && (
        <div>
          <SectionLabel>stderr</SectionLabel>
          <CodeBlock color="#fca5a5">{stderr}</CodeBlock>
        </div>
      )}
      {!stdout && !stderr && (
        <p className="text-muted text-[11px] italic">{t("no_output")}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// workspace_list_files
// ---------------------------------------------------------------------------

export function WorkspaceListFilesResult({ data }: { data: Record<string, unknown> }) {
  const { t } = useTranslation();
  const d = (data.data ?? data) as Record<string, unknown>;
  const root = d.root as string | undefined;
  const files = (d.files ?? []) as Array<{ type: string; path: string }>;

  return (
    <div className="space-y-1.5">
      {root && (
        <div className="flex items-center gap-1.5 text-[10px] text-muted">
          <Folder size={10} /> {root}
        </div>
      )}
      <div className="rounded bg-surface-2/50 p-2 max-h-48 overflow-y-auto space-y-0.5">
        {files.length === 0 && (
          <p className="text-muted text-[11px] italic">{t("empty_directory")}</p>
        )}
        {files.map((f, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px] font-mono text-foreground">
            {f.type === "dir" ? (
              <Folder size={11} className="text-blue-400 shrink-0" />
            ) : (
              <File size={11} className="text-muted shrink-0" />
            )}
            <span className="truncate">{f.path}</span>
          </div>
        ))}
      </div>
      <span className="text-[10px] text-muted">{files.length === 1 ? t("n_items", { count: files.length }) : t("n_items_plural", { count: files.length })}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// workspace_read_file
// ---------------------------------------------------------------------------

export function WorkspaceReadFileResult({ data }: { data: Record<string, unknown> }) {
  const { t } = useTranslation();
  const d = (data.data ?? data) as Record<string, unknown>;
  const path = d.path as string | undefined;
  const content = d.content as string | undefined;
  const mimeType = d.mimeType as string | undefined;
  const sizeBytes = d.sizeBytes as number | undefined;
  const truncated = d.truncated as boolean | undefined;
  const isBinary = d.isBinary as boolean | undefined;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <FileText size={12} className="text-muted" />
        {path && <span className="text-[11px] font-mono text-foreground truncate">{path}</span>}
        {mimeType && <Badge>{mimeType}</Badge>}
        {sizeBytes !== undefined && <Badge>{formatBytes(sizeBytes)}</Badge>}
        {truncated && <Badge variant="error">truncated</Badge>}
      </div>
      {isBinary ? (
        <p className="text-muted text-[11px] italic">{t("binary_file")}</p>
      ) : content ? (
        <div className="max-h-64 overflow-y-auto rounded bg-surface-2/50">
          <CodeBlock>{content}</CodeBlock>
        </div>
      ) : (
        <p className="text-muted text-[11px] italic">{t("no_content")}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// data_python_exec
// ---------------------------------------------------------------------------

export function DataPythonExecResult({ data }: { data: Record<string, unknown> }) {
  const { t } = useTranslation();
  const d = (data.data ?? data) as Record<string, unknown>;
  const text = d.text as string | undefined;
  const resultsSummary = d.resultsSummary as string | undefined;
  const logs = d.logs as { stdout?: string; stderr?: string } | undefined;
  const chartsCreated = d.chartsCreated as number | undefined;
  const exportedFiles = d.exportedFiles as string[] | undefined;
  const importedFiles = d.importedFiles as string[] | undefined;
  const warnings = d.warnings as string[] | undefined;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="success">Python</Badge>
        {chartsCreated != null && chartsCreated > 0 && (
          <Badge>{chartsCreated} chart{chartsCreated > 1 ? "s" : ""}</Badge>
        )}
        {exportedFiles?.length ? <Badge>{exportedFiles.length} export{exportedFiles.length > 1 ? "s" : ""}</Badge> : null}
        {importedFiles?.length ? <Badge>{importedFiles.length} import{importedFiles.length > 1 ? "s" : ""}</Badge> : null}
      </div>
      {text && (
        <div>
          <SectionLabel>{t("result")}</SectionLabel>
          <CodeBlock>{text}</CodeBlock>
        </div>
      )}
      {resultsSummary && !text && (
        <div>
          <SectionLabel>{t("summary")}</SectionLabel>
          <CodeBlock>{resultsSummary}</CodeBlock>
        </div>
      )}
      {logs?.stdout && (
        <div>
          <SectionLabel>stdout</SectionLabel>
          <CodeBlock color="#86efac">{logs.stdout}</CodeBlock>
        </div>
      )}
      {logs?.stderr && (
        <div>
          <SectionLabel>stderr</SectionLabel>
          <CodeBlock color="#fca5a5">{logs.stderr}</CodeBlock>
        </div>
      )}
      {warnings?.length ? (
        <div>
          <SectionLabel>{t("warnings")}</SectionLabel>
          {warnings.map((w, i) => (
            <p key={i} className="text-yellow-400 text-[11px]">{w}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
