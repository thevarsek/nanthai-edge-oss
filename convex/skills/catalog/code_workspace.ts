import { SystemSkillSeedData } from "../mutations_seed";

export const CODE_WORKSPACE_SKILL: SystemSkillSeedData = {
  slug: "code-workspace",
  name: "Code Workspace",
  summary:
    "Use NanthAI's temporary chat workspace to write files, run code, inspect outputs, and export durable results. Use for coding, scripts, quick automations, and file-processing workflows.",
  instructionsRaw: `# Code Workspace

Use NanthAI's temporary chat workspace when the task requires code execution, shell commands, or iterative file manipulation.

## When to Use

- Writing and running scripts (Python stdlib, Node/TS, shell scripts)
- Inspecting or transforming uploaded files with text processing tools
- Creating intermediate files before exporting final outputs
- Debugging code, command output, or file formats

## Limitations

- **No network access** — cannot fetch URLs, call APIs, or download packages.
- **No pip/npm install** — only Python stdlib and pre-installed CLI tools are available.
- **Filesystem is temporary** — files persist within this response only; lost between messages.
- **For data analysis** with numpy, pandas, or matplotlib, use the data-analyzer skill instead (which provides data_python_exec).

## Preferred Workflow

1. Inspect the current workspace state before assuming files exist.
2. Create or update files explicitly.
3. Run the minimum command needed to verify progress.
4. Export durable outputs back into NanthAI storage when the user needs to keep them.

## Guardrails

- Treat the workspace as temporary to this chat.
- Prefer named NanthAI export/import tools over inventing local paths in the final answer.
- Avoid claiming a file is available to the user until it has been exported.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "workspace_exec",
    "workspace_list_files",
    "workspace_read_file",
    "workspace_write_file",
    "workspace_make_dirs",
    "workspace_import_file",
    "workspace_export_file",
    "workspace_reset",
  ],
  requiredToolProfiles: ["workspace"],
  requiredIntegrationIds: [],
  requiredCapabilities: [],
};
