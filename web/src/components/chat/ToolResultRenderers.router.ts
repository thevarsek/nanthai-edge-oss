import type { FC, ReactNode } from "react";
import { createElement } from "react";
import {
  WorkspaceExecResult,
  WorkspaceListFilesResult,
  WorkspaceReadFileResult,
  DataPythonExecResult,
} from "./ToolResultRenderers";
import {
  WorkspaceWriteFileResult,
  WorkspaceMakeDirsResult,
  WorkspaceExportFileResult,
  WorkspaceImportFileResult,
  WorkspaceResetResult,
} from "./ToolResultRenderers.simple";

function tryParse(json: string): Record<string, unknown> | null {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

const RENDERERS: Record<string, FC<{ data: Record<string, unknown> }>> = {
  workspace_exec: WorkspaceExecResult,
  workspace_list_files: WorkspaceListFilesResult,
  workspace_read_file: WorkspaceReadFileResult,
  data_python_exec: DataPythonExecResult,
  data_python_sandbox: DataPythonExecResult,
  workspace_write_file: WorkspaceWriteFileResult,
  workspace_make_dirs: WorkspaceMakeDirsResult,
  workspace_export_file: WorkspaceExportFileResult,
  workspace_import_file: WorkspaceImportFileResult,
  workspace_reset: WorkspaceResetResult,
};

export function renderToolResult(toolName: string, resultJson: string): ReactNode | null {
  const renderer = RENDERERS[toolName];
  if (!renderer) return null;

  const parsed = tryParse(resultJson);
  if (!parsed) return null;
  if (parsed.success === false) return null;

  return createElement(renderer, { data: parsed });
}
