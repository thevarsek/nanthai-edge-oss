import { SystemSkillSeedData } from "../mutations_seed";

export const NOTION_WORKSPACE_SKILL: SystemSkillSeedData = {
  slug: "notion-workspace",
  name: "Notion Workspace",
  summary:
    "Work with Notion pages and databases. Use when the task requires reading, creating, updating, or querying connected Notion content.",
  instructionsRaw: `# Notion Workspace

Use this skill when the task depends on connected Notion pages or databases.

## When to Use

- Search Notion for pages or database entries
- Read page contents before summarizing or transforming them
- Create or update pages
- Query or update database rows

## Guidance

- Read before editing whenever the target page or database state matters.
- Keep page titles, database names, and row filters explicit.
- Summarize exactly what changed after write operations.
- If Notion search or read succeeds in the current run, assume Notion write tools are available too when this skill is loaded and the Notion integration is active.
- Do not claim Notion write tools are unavailable without first checking whether the needed Notion tool can be called.
- Reuse page IDs, database IDs, and row identifiers from earlier Notion tool results whenever possible.`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "integration_managed",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "notion_search", "notion_read_page", "notion_create_page",
    "notion_update_page", "notion_delete_page", "notion_update_database_entry",
    "notion_query_database",
  ],
  requiredToolProfiles: ["notion"],
  requiredIntegrationIds: ["notion"],
};
