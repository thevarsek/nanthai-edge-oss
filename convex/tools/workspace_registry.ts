"use node";

import { ToolRegistry } from "./registry";
import { workspaceExec } from "./workspace_exec";
import { workspaceListFiles } from "./workspace_list_files";
import { workspaceReadFile } from "./workspace_read_file";
import { workspaceWriteFile } from "./workspace_write_file";
import { workspaceMakeDirs } from "./workspace_make_dirs";
import { workspaceExportFile } from "./workspace_export_file";
import { workspaceReset } from "./workspace_reset";
import { workspaceImportFile } from "./workspace_import_file";
import { dataPythonExec } from "./data_python_exec";

export function registerAnalyticsTools(registry: ToolRegistry): void {
  registry.register(
    workspaceImportFile,
    workspaceExportFile,
    dataPythonExec,
  );
}

export function registerWorkspaceProfileTools(registry: ToolRegistry): void {
  registry.register(
    workspaceExec,
    workspaceListFiles,
    workspaceReadFile,
    workspaceWriteFile,
    workspaceMakeDirs,
    workspaceImportFile,
    workspaceExportFile,
    workspaceReset,
  );
}

export function registerWorkspaceTools(registry: ToolRegistry): void {
  registry.register(
    workspaceExec,
    workspaceListFiles,
    workspaceReadFile,
    workspaceWriteFile,
    workspaceMakeDirs,
    workspaceImportFile,
    workspaceExportFile,
    dataPythonExec,
    workspaceReset,
  );
}
