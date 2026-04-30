import { SystemSkillSeedData } from "../mutations_seed";

export const GOOGLE_DRIVE_SKILL: SystemSkillSeedData = {
  slug: "google-drive",
  name: "Google Drive",
  summary:
    "List, read, move, and upload files in Google Drive when the task depends on Drive content. Operates only on files the user has explicitly shared with NanthAI via the Drive picker, plus files NanthAI uploaded.",
  instructionsRaw: `# Google Drive

Use this skill for tasks that require Google Drive.

NanthAI uses the narrow \`drive.file\` scope. That means the available tools can
only see files the user explicitly picked for NanthAI (via the Drive file picker
on web, or the system file picker on iOS/Android) plus files NanthAI uploaded
itself. Tools cannot enumerate the user's entire Drive.

## When to Use

- Find or list the files the user has already shared with NanthAI
- Read or export the content of a shared file
- Upload generated files to Drive
- Move shared files between folders that are also accessible to NanthAI

## Reading Drive files

- For Google Docs / Sheets / Slides and plain-text formats (txt, csv, json, md), \`drive_read\` returns the file's text directly.
- **For binary files (PDF, DOCX, images, etc.), \`drive_read\` only returns metadata — it never returns text content for binaries.** When NanthAI has already imported the picked Drive file into the current chat, \`drive_read\`'s response will include a \`scopedDocument\` field with a \`doc_id\` (e.g. \`doc-0\`). When you see that, call \`read_document\` with that \`doc_id\` to get the extracted text, or \`find_in_document\` for keyword search. **Do not** attempt to download the Drive file from a public URL or claim the content cannot be read — the document workspace already has the extracted text.
- If \`drive_read\` returns a binary file with no \`scopedDocument\` field, call \`list_documents\` first to see if the file is in the chat workspace under a different handle, and read it from there. Match by \`driveFileId\` (which equals the Drive \`fileId\`) or by filename.

## Guidance

- Be explicit about which file or folder is being used.
- Summarize uploads, reads, and moves so the user can verify the result quickly.
- If Drive list or read succeeds in the current run, assume Drive action tools are available too when this skill is loaded and the Drive integration is active.
- Do not claim Drive action tools are unavailable without first checking whether the needed Drive tool can be called.
- If a tool returns a "requiresDrivePicker" or similar grant-required error, ask the user to share the relevant file via the Drive picker before retrying — do not attempt to work around the scope limitation.
- Reuse file IDs, folder IDs, and file paths from earlier Drive tool results whenever possible.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "integration_managed",
  lockState: "locked",
  // M24 Phase 5: Reinstated under the narrow drive.file scope + Drive Picker.
  // Tools only operate on user-granted files (recorded in googleDriveFileGrants)
  // and files uploaded by NanthAI itself.
  status: "active",
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
