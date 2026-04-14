import { SystemSkillSeedData } from "../mutations_seed";

export const PERSISTENT_RUNTIME_SKILL: SystemSkillSeedData = {
  slug: "persistent-runtime",
  name: "Persistent Runtime",
  summary:
    "Use NanthAI's persistent Vercel runtime for multi-turn work that needs durable filesystem state, package installs, network access, or a long-lived Python/Node environment.",
  instructionsRaw: `# Persistent Runtime

Use this skill when the task needs a runtime that survives across later generations in the same chat.

## When to Use

- Multi-step workflows where files need to survive across messages
- Python or Node work that needs installed packages
- Tasks that need network access
- Runtime-heavy conversions, parsing, or artifact production
- Cases where the temporary \`code-workspace\` tools are too limited

## Available Tools

- **vm_exec** — run shell commands in the persistent runtime
- **vm_list_files** — inspect the persistent workspace
- **vm_read_file** — read text files from the persistent workspace
- **vm_write_file** — write text files into the persistent workspace
- **vm_delete_file** — remove files or directories from the persistent workspace
- **vm_make_dirs** — create directories in the persistent workspace
- **vm_import_file** — import a user-owned file from NanthAI storage
- **vm_export_file** — export a runtime file back into NanthAI durable storage
- **vm_reset** — clear the persistent workspace contents while keeping the runtime session alive

## Environment Selection

- Use \`environment: "python"\` for Python-oriented workflows, package installs, data processing, and most document pipelines.
- Use \`environment: "node"\` for Node/JavaScript workflows.
- Keep related work in the same environment so the filesystem and installed dependencies remain reusable later in the chat.

## Working Style

- Inspect before assuming files exist.
- Prefer narrow file tools for routine read/write/list operations.
- Use \`vm_exec\` when shell commands are the simplest or most capable path.
- Export user-meaningful outputs back into NanthAI storage when the user needs a durable artifact.
- Escalate here only when persistence, packages, network, or multi-step state really matter; otherwise stay on the cheaper temporary workspace.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "vm_exec",
    "vm_list_files",
    "vm_read_file",
    "vm_write_file",
    "vm_delete_file",
    "vm_make_dirs",
    "vm_import_file",
    "vm_export_file",
    "vm_reset",
  ],
  requiredToolProfiles: ["persistentRuntime"],
  requiredIntegrationIds: [],
};
