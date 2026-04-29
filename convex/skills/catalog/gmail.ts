import { SystemSkillSeedData } from "../mutations_seed";

export const GMAIL_SKILL: SystemSkillSeedData = {
  slug: "gmail",
  name: "Gmail",
  summary:
    "Read, search, draft, send, and organize Gmail messages when the task depends on the user's inbox. Uses the user's manually connected Gmail account (IMAP/SMTP with an app password).",
  instructionsRaw: `# Gmail

Use this skill for tasks that require Gmail.

The user has connected Gmail manually using IMAP/SMTP with a Google App Password,
not the Gmail REST API. The available tools wrap that connection, so behavior is
similar to standard Gmail access but operates over IMAP/SMTP.

## When to Use

- Read, search, summarize, or triage Gmail messages
- Create Gmail drafts or send emails
- Archive, trash, or relabel messages (label changes map to IMAP flags/folders)

## Guidance

- Confirm the target inbox action before changing message state.
- Use gmail_create_draft when the user asks to draft an email without sending it.
- Summarize what was sent or modified so the user can verify it quickly.
- If Gmail read or search succeeds in the current run, assume Gmail action tools are available too when this skill is loaded and the Gmail integration is active.
- Do not claim Gmail action tools are unavailable without first checking whether the needed Gmail tool can be called.
- Reuse message IDs and message details from earlier Gmail tool results in the conversation whenever possible.
- Search supports a practical subset of Gmail query syntax (from:, to:, subject:, after:, before:, is:unread, is:read, is:starred); not every advanced Gmail operator is available over IMAP.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "integration_managed",
  lockState: "locked",
  // M24 Phase 5: Reinstated. Backed by Manual Gmail (IMAP/SMTP via app password)
  // instead of Gmail REST API to avoid the gmail.modify scope and CASA review.
  // The "gmail" integration ID is satisfied by the gmail_manual provider —
  // see convex/chat/queries_generation_context.ts (case "gmail_manual").
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "gmail_send",
    "gmail_create_draft",
    "gmail_read",
    "gmail_search",
    "gmail_delete",
    "gmail_modify_labels",
    "gmail_list_labels",
  ],
  requiredToolProfiles: ["google"],
  requiredIntegrationIds: ["gmail"],
};
