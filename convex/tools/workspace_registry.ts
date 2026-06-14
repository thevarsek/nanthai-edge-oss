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
import { dataPythonSandbox } from "./data_python_sandbox";
import { vmExec } from "./vm_exec";
import { vmListFiles } from "./vm_list_files";
import { vmReadFile } from "./vm_read_file";
import { vmWriteFile } from "./vm_write_file";
import { vmDeleteFile } from "./vm_delete_file";
import { vmMakeDirs } from "./vm_make_dirs";
import { vmImportFile } from "./vm_import_file";
import { vmExportFile } from "./vm_export_file";
import { vmReset } from "./vm_reset";
import { readPdf } from "./read_pdf";
import { generatePdf } from "./generate_pdf";
import { editPdf } from "./edit_pdf";

export const analyticsProfileTools = [
  workspaceImportFile,
  workspaceExportFile,
  dataPythonExec,
  dataPythonSandbox,
];

export const workspaceProfileTools = [
  workspaceExec,
  workspaceListFiles,
  workspaceReadFile,
  workspaceWriteFile,
  workspaceMakeDirs,
  workspaceImportFile,
  workspaceExportFile,
  workspaceReset,
];

export const persistentRuntimeProfileTools = [
  vmExec,
  vmListFiles,
  vmReadFile,
  vmWriteFile,
  vmDeleteFile,
  vmMakeDirs,
  vmImportFile,
  vmExportFile,
  vmReset,
  readPdf,
  generatePdf,
  editPdf,
];

export function registerAnalyticsTools(registry: ToolRegistry): void {
  registry.register(...analyticsProfileTools);
}

export function registerWorkspaceProfileTools(registry: ToolRegistry): void {
  registry.register(...workspaceProfileTools);
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
    dataPythonSandbox,
    workspaceReset,
  );
}

export function registerPersistentRuntimeTools(registry: ToolRegistry): void {
  registry.register(...persistentRuntimeProfileTools);
}

export function registerAllRuntimeTools(registry: ToolRegistry): void {
  registerWorkspaceTools(registry);
  registerPersistentRuntimeTools(registry);
}
