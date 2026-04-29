// convex/skills/catalog/create_skill.ts
// =============================================================================
// System skill: create-skill
// Skill management — create, edit, delete skills and manage skill assignments
// to chats and personas.
// =============================================================================

import { SystemSkillSeedData } from "../mutations_seed";

export const CREATE_SKILL_SKILL: SystemSkillSeedData = {
  slug: "create-skill",
  name: "Skill Creator",
  summary:
    "Create, edit, delete, and manage NanthAI skills. Use when the user wants to create " +
    "a new skill, update an existing one, assign skills to personas, or enable/disable skills for a chat.",
  instructionsRaw: `# Skill Creator for NanthAI

Guide users through creating effective skills that extend NanthAI's capabilities.

## What Skills Are

Skills are modular instruction sets that give the AI specialized knowledge, workflows, and domain expertise. They transform general-purpose AI into a specialized assistant for specific tasks.

### What Skills Provide
1. **Specialized workflows** — Multi-step procedures for specific domains
2. **Domain expertise** — Company-specific knowledge, schemas, business logic
3. **Tool guidance** — Instructions for working with specific NanthAI tools effectively
4. **Output standards** — Templates, formatting rules, quality criteria

## Core Principles

### Concise is Key
The context window is shared with conversation history, system prompts, and other skills. Only add context the AI doesn't already have. Challenge each piece: "Does the AI really need this?" and "Does this justify its token cost?"

Prefer concise examples over verbose explanations.

### Set Appropriate Degrees of Freedom
- **High freedom** (guidelines): When multiple approaches are valid, decisions depend on context
- **Medium freedom** (patterns with parameters): When a preferred pattern exists but some variation is acceptable
- **Low freedom** (strict procedures): When operations are fragile, consistency is critical, or a specific sequence must be followed

### What NOT to Include
- References to capabilities NanthAI doesn't have (bash, filesystem, browser, MCP, raw HTTP)
- Setup instructions, installation guides, READMEs
- Information the AI already knows well (general programming concepts, common formats)
- Redundant explanations of the same concept

## Skill Creation Process

### Step 1: Understand with Concrete Examples

Ask the user:
1. "What should this skill help with? Give me 2-3 example tasks."
2. "What would you say to trigger this skill?"
3. "What does a good result look like?"

Don't overwhelm — start with the most important questions and follow up as needed.

### Step 2: Plan the Skill Contents

For each example, consider:
- What domain knowledge is needed that the AI doesn't have?
- What specific procedures or workflows should be followed?
- What tools does this skill need? (NanthAI tools only)
- What output format or quality standards apply?

### Step 3: Draft the Skill

Structure the skill with:

**Name:** Short, descriptive (e.g. "Financial Reports", "API Documentation")

**Summary:** 1-2 sentences covering what it does AND when to use it. This is what appears in the skill catalog — make it trigger correctly.

**Instructions:** The core content. Organize as:
- When to use (trigger conditions)
- Key workflows or procedures
- Domain-specific knowledge
- Quality standards and examples
- Common pitfalls to avoid

**Runtime Mode:**
- \`textOnly\` — Skill provides knowledge/workflows but doesn't require specific tools
- \`toolAugmented\` — Skill relies on product tools or integrations
- \`sandboxAugmented\` — Skill needs the temporary NanthAI code workspace

**Tool Profiles:**
- \`docs\` — document, spreadsheet, and presentation workflows
- \`analytics\` — uploaded file analysis and notebook-style Python
- \`workspace\` — generic code execution and file manipulation in the workspace
- \`subagents\` — parallel helper agents for genuinely decomposable work
- \`google\`, \`microsoft\`, \`notion\`, \`appleCalendar\` — connected app domains
- \`scheduledJobs\`, \`skillsManagement\`, \`personas\` — advanced NanthAI control surfaces

### Step 4: Validate

Before saving, verify:
1. No references to bash, filesystem, browser, MCP, or raw HTTP
2. All referenced tools are actual NanthAI tools
3. Instructions are concise (under 5000 words ideally)
4. Summary accurately describes when to trigger
5. Every sentence earns its place

### Step 5: Create the Skill

Use the \`create_skill\` tool with:
- \`name\`: The skill name
- \`summary\`: Trigger description (from Step 3)
- \`instructionsRaw\`: The full instructions (from Step 3)
- \`runtimeMode\`: "textOnly", "toolAugmented", or "sandboxAugmented"
- \`requiredToolProfiles\`: The smallest profile set that should be unlocked when the skill loads
- \`requiredToolIds\`: Optional explicit NanthAI tool IDs when the skill depends on exact tools
- \`requiredIntegrationIds\`: Optional integration IDs if connected apps are required
- \`requiredCapabilities\`: Optional internal capability IDs required by the skill (rarely needed)

The system will automatically:
1. Validate instructions for compatibility
2. Infer/normalize missing profiles and runtime requirements
3. Save the skill

Prefer the simplest valid shape. Do not over-tag every skill with docs, analytics, and workspace unless it truly needs all of them.

### Step 6: Iterate

After testing the skill in real conversations:
1. Note where it struggles or produces suboptimal results
2. Use \`update_skill\` to refine instructions
3. Add examples for common failure cases
4. Remove instructions that aren't helping

## Skill Assignment & Chat Management

- **enable_skill_for_chat** — Make a skill auto-load in a specific chat
- **disable_skill_for_chat** — Remove a skill from a chat
- **assign_skill_to_persona** — Bind a skill to a persona so it loads whenever that persona is active
- **remove_skill_from_persona** — Unbind a skill from a persona

Use these when the user says things like "always use this skill in this chat" or "add this skill to my coding persona".

## Available NanthAI Tools

For reference when setting requiredToolIds:

**Documents:** generate_docx, read_docx, edit_docx, generate_pptx, read_pptx, edit_pptx, generate_xlsx, read_xlsx, edit_xlsx, generate_text_file, read_text_file, generate_eml, read_eml
**Media:** fetch_image
**Search:** search_chats
**Workspace & Analytics:** workspace_exec, workspace_list_files, workspace_read_file, workspace_write_file, workspace_make_dirs, workspace_import_file, workspace_export_file, workspace_reset, data_python_exec
**Scheduling:** create_scheduled_job, list_scheduled_jobs, update_scheduled_job, delete_scheduled_job
**Personas:** create_persona, delete_persona
**Skills:** load_skill, list_skills, create_skill, update_skill, delete_skill
**Google:** gmail_send, gmail_create_draft, gmail_read, gmail_search, gmail_delete, gmail_modify_labels, gmail_list_labels, drive_upload, drive_list, drive_read, drive_move, calendar_list, calendar_create, calendar_delete
**Microsoft:** outlook_send, outlook_read, outlook_search, outlook_delete, outlook_move, outlook_list_folders, onedrive_upload, onedrive_list, onedrive_read, onedrive_move, ms_calendar_list, ms_calendar_create, ms_calendar_delete
**Apple:** apple_calendar_list, apple_calendar_create, apple_calendar_update, apple_calendar_delete
**Notion:** notion_search, notion_read_page, notion_create_page, notion_update_page, notion_delete_page, notion_update_database_entry, notion_query_database`,
  instructionsCompiled: undefined,
  compilationStatus: "compiled",
  scope: "system",
  origin: "nanthaiBuiltin",
  visibility: "visible",
  lockState: "locked",
  status: "active",
  runtimeMode: "toolAugmented",
  requiredToolIds: [
    "create_skill", "update_skill", "delete_skill", "list_skills",
    "enable_skill_for_chat", "disable_skill_for_chat",
    "assign_skill_to_persona", "remove_skill_from_persona",
  ],
  requiredToolProfiles: ["skillsManagement"],
  requiredIntegrationIds: [],
};
