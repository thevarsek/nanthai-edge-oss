import {
  createTool,
  type RegisteredTool,
  type ToolParameterSchema,
} from "./registry";

const openParameters: ToolParameterSchema = {
  type: "object",
  properties: {},
  additionalProperties: true,
};

function unavailableRuntimeTool(name: string, description: string): RegisteredTool {
  return createTool({
    name,
    description,
    parameters: openParameters,
    execute: async () => ({
      success: false,
      data: null,
      error:
        "This workspace/runtime tool is temporarily unavailable while NanthAI isolates runtime tools behind a Convex action boundary.",
    }),
  });
}

export const analyticsProfileTools = [
  unavailableRuntimeTool(
    "workspace_import_file",
    "Import a user-owned file into the current chat workspace.",
  ),
  unavailableRuntimeTool(
    "workspace_export_file",
    "Export a file from the current chat workspace into durable storage.",
  ),
  unavailableRuntimeTool(
    "data_python_exec",
    "Run Python for tabular data analysis in the analytics workspace.",
  ),
  unavailableRuntimeTool(
    "data_python_sandbox",
    "Run Python in the analytics sandbox for file-backed analysis.",
  ),
];

export const workspaceProfileTools = [
  unavailableRuntimeTool(
    "workspace_exec",
    "Execute a shell command in the current chat workspace.",
  ),
  unavailableRuntimeTool(
    "workspace_list_files",
    "List files and directories inside the current chat workspace.",
  ),
  unavailableRuntimeTool(
    "workspace_read_file",
    "Read a text file from the current chat workspace.",
  ),
  unavailableRuntimeTool(
    "workspace_write_file",
    "Write a text file into the current chat workspace.",
  ),
  unavailableRuntimeTool(
    "workspace_make_dirs",
    "Create directories inside the current chat workspace.",
  ),
  ...analyticsProfileTools.filter((tool) =>
    ["workspace_import_file", "workspace_export_file"].includes(tool.name),
  ),
  unavailableRuntimeTool(
    "workspace_reset",
    "Reset the current chat workspace.",
  ),
];

export const persistentRuntimeProfileTools = [
  unavailableRuntimeTool(
    "vm_exec",
    "Execute a command in the persistent runtime workspace.",
  ),
  unavailableRuntimeTool(
    "vm_list_files",
    "List files in the persistent runtime workspace.",
  ),
  unavailableRuntimeTool(
    "vm_read_file",
    "Read a file from the persistent runtime workspace.",
  ),
  unavailableRuntimeTool(
    "vm_write_file",
    "Write a file into the persistent runtime workspace.",
  ),
  unavailableRuntimeTool(
    "vm_delete_file",
    "Delete a file or directory from the persistent runtime workspace.",
  ),
  unavailableRuntimeTool(
    "vm_make_dirs",
    "Create directories in the persistent runtime workspace.",
  ),
  unavailableRuntimeTool(
    "vm_import_file",
    "Import a stored file into the persistent runtime workspace.",
  ),
  unavailableRuntimeTool(
    "vm_export_file",
    "Export a persistent runtime file into durable storage.",
  ),
  unavailableRuntimeTool(
    "vm_reset",
    "Reset the persistent runtime workspace.",
  ),
  unavailableRuntimeTool(
    "read_pdf",
    "Read a PDF from the persistent runtime workspace.",
  ),
  unavailableRuntimeTool(
    "generate_pdf",
    "Generate a PDF in the persistent runtime workspace.",
  ),
  unavailableRuntimeTool(
    "edit_pdf",
    "Edit a PDF in the persistent runtime workspace.",
  ),
];
