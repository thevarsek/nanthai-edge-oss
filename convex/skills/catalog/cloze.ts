import { SystemSkillSeedData } from "../mutations_seed";

export const CLOZE_SKILL: SystemSkillSeedData = {
  slug: "cloze",
  name: "Cloze",
  summary:
    "Search, add, and update contacts, projects, notes, todos, and drafts in Cloze CRM.",
  instructionsRaw: `# Cloze CRM

Use this skill for tasks that require the user's Cloze CRM data.

## When to Use

- Find, add, or update people (contacts/leads)
- Count contacts matching a filter
- Add notes or todos linked to a contact
- Read a contact's timeline (activity history)
- Save an email draft linked to a contact
- Look up the authenticated user's Cloze profile
- Find or update projects

## Guidance

- Confirm destructive actions (updates, changes) before executing.
- Summarize what was created or modified so the user can verify.
- Use cloze_person_find before cloze_person_change to resolve the correct contact.
- Use cloze_project_find before cloze_project_change to resolve the correct project.
- Reuse person IDs and project IDs from earlier tool results in the conversation.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "integration_managed",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "cloze_person_find",
    "cloze_person_count",
    "cloze_person_add",
    "cloze_person_change",
    "cloze_add_note",
    "cloze_add_todo",
    "cloze_timeline",
    "cloze_save_draft",
    "cloze_about_me",
    "cloze_project_find",
    "cloze_project_change",
  ],
  requiredToolProfiles: ["cloze"],
  requiredIntegrationIds: ["cloze"],
};
