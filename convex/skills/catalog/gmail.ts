import { SystemSkillSeedData } from "../mutations_seed";

export const GMAIL_SKILL: SystemSkillSeedData = {
  slug: "gmail",
  name: "Gmail",
  summary:
    "Read, search, draft, send, and organize Gmail messages when the task depends on the user's inbox.",
  instructionsRaw: `# Gmail

Use this skill for tasks that require Gmail.

## When to Use

- Read, search, summarize, or triage Gmail messages
- Draft or send emails
- Archive, trash, or relabel messages

## Guidance

- Confirm the target inbox action before changing message state.
- Summarize what was sent or modified so the user can verify it quickly.
- If Gmail read or search succeeds in the current run, assume Gmail action tools are available too when this skill is loaded and the Gmail integration is active.
- Do not claim Gmail action tools are unavailable without first checking whether the needed Gmail tool can be called.
- Reuse message IDs and message details from earlier Gmail tool results in the conversation whenever possible.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "integration_managed",
  lockState: "locked",
  // Archived per M24: Google scope approval pending. Reinstate when Google integration is re-enabled.
  status: "archived",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "gmail_send",
    "gmail_read",
    "gmail_search",
    "gmail_delete",
    "gmail_modify_labels",
    "gmail_list_labels",
  ],
  requiredToolProfiles: ["google"],
  requiredIntegrationIds: ["gmail"],
};
