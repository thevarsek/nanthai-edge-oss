import { SystemSkillSeedData } from "../mutations_seed";

export const GOOGLE_DRIVE_SKILL: SystemSkillSeedData = {
  slug: "google-drive",
  name: "Google Drive",
  summary:
    "List, read, move, and upload files in Google Drive when the task depends on Drive content.",
  instructionsRaw: `# Google Drive

Use this skill for tasks that require Google Drive.

## When to Use

- Find or list files in Google Drive
- Read or export file content
- Upload generated files
- Move files between folders

## Guidance

- Be explicit about which file or folder is being used.
- Summarize uploads, reads, and moves so the user can verify the result quickly.
- If Drive list or read succeeds in the current run, assume Drive action tools are available too when this skill is loaded and the Drive integration is active.
- Do not claim Drive action tools are unavailable without first checking whether the needed Drive tool can be called.
- Reuse file IDs, folder IDs, and file paths from earlier Drive tool results whenever possible.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  // Archived per M24: Google scope approval pending. Reinstate when Google integration is re-enabled.
  status: "archived",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "drive_upload",
    "drive_list",
    "drive_read",
    "drive_move",
  ],
  requiredToolProfiles: ["google"],
  requiredIntegrationIds: ["drive"],
};
