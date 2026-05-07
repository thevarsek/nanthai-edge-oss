# Tool, Skill & Capability Access Map

> Canonical reference for what NanthAI exposes at each tier, how skills relate to tools, and what is currently gated by Pro, connected apps, or internal runtime capability.

## Purpose

This document is the product-facing complement to the lower-level architecture docs.

Use it when you need to answer:

- what Free vs Pro vs internal Max users can actually do
- which tools are executable versus which skills are discoverable instructions
- which connected-app features depend on OAuth connections
- how the cheap ephemeral workspace, analytics runtimes, and persistent runtime split work today

## Core Model

NanthAI has three separate concepts that interact:

| Layer | What it is | Example | How it is gated |
|---|---|---|---|
| Capability / tier | Account-level access state | `pro` | Purchase entitlements and manual capability grants |
| Skill | Instruction pack the model can discover and load | `data-analyzer`, `docx`, `google-workspace` | Skill visibility + capability requirements |
| Tool | Executable backend function callable by the model | `generate_xlsx`, `gmail_read`, `data_python_exec` | Tool registry built server-side per run |

### Important current implementation note

The latest architecture now uses **progressive tool discovery** for normal chat generation:

- **Free** users still get no tool registry
- **Pro** users start with a small base registry
- loading a skill expands the active tool profiles for the next turn
- **All Pro** users can unlock analytics/workspace profiles in the same progressive way (M27 removed the former `sandboxRuntime` internal-only gate)

Regardless of tier or unlocked profiles, the active generation model must still advertise `supportsTools === true` before NanthAI attaches any model-invoked tool registry to the run. A non-tool-capable model degrades to plain chat for that turn, even for Pro / runtime users.

Some lightweight general tools remain in the base registry for reliability and backwards compatibility:

- `load_skill`
- `search_chats`
- `fetch_image`
- scheduled job tools
- persona tools
- skill management tools

Subagents are no longer part of the base registry. They are unlocked through the dedicated `parallel-subagents` skill and a small set of built-in strategic planning skills that can genuinely benefit from parallel decomposition.

The heaviest tool families — docs, connected apps, and runtime — now sit behind profile-driven expansion.

### Runtime compatibility fallback

Current backend behavior is intentionally forgiving:

- send / retry requests that include integrations or subagents on a non-tool-capable model are silently downgraded instead of rejected
- persona, chat, and scheduled-job writes also silently strip tool-dependent integration state when the selected model cannot use tools
- clients should still disable incompatible integrations / skills / subagent controls ahead of time so users do not save or send configurations that will be downgraded server-side

## Tier And Capability Matrix

| Tier / Capability | How granted | What it unlocks | What stays blocked |
|---|---|---|---|
| `Free` | Default account state | Basic chat, model switching, normal conversation UX | All model-invoked tools, connected-app actions, runtime |
| `Pro` (`pro`) | App purchase entitlement or manual grant | Full NanthAI tool registry: docs/files, chat search, scheduled jobs, personas, skills, connected apps, workspace/runtime tools, Python analytics, chart generation, optional subagents | MCP runtime |
| `mcpRuntime` | Reserved only | No public surface yet | MCP execution remains unavailable |

> **Note (M27):** The `sandboxRuntime` capability was removed in M27. All workspace tools, analytics tools, and runtime-only skills are now available to all Pro users without any additional capability grant.

## Tool Registry By Gate

### High-level exposure

| Tool family | Gate |
|---|---|
| Document, text, utility, search, persona, scheduled-job, and skill tools | Pro + active model tool-capable |
| Connected-app tools | Pro + active model tool-capable + active connection + integration requested for the run |
| Subagents | Pro + active model tool-capable + single-participant chat + subagents enabled |
| Workspace/runtime tools | Pro + active model tool-capable (skill-activated via `code_workspace`) |
| Analytics tools | Pro + active model tool-capable (skill-activated via analytics skills) |

### Executable tool families

| Tool family | Tool IDs | Gate |
|---|---|---|
| Document workspace tools | `list_documents`, `read_document`, `find_in_document` | Pro + explicit scoped documents in the current chat turn |
| Document generation/editing tools | `generate_docx`, `read_docx`, `edit_docx`, `generate_pptx`, `read_pptx`, `edit_pptx`, `generate_xlsx`, `read_xlsx`, `edit_xlsx` | Pro |
| Text/file tools | `generate_text_file`, `read_text_file`, `generate_eml`, `read_eml` | Pro |
| Utility | `fetch_image` | Pro |
| Chat search | `search_chats` | Pro |
| Scheduled jobs | `create_scheduled_job`, `list_scheduled_jobs`, `update_scheduled_job`, `delete_scheduled_job` | Pro |
| Persona management | `create_persona`, `delete_persona` | Pro |
| Skill management and discovery | `load_skill`, `list_skills`, `create_skill`, `update_skill`, `delete_skill`, `enable_skill_for_chat`, `disable_skill_for_chat`, `assign_skill_to_persona`, `remove_skill_from_persona` | Pro |
| Subagents | `spawn_subagents` | Pro + tool-capable model + subagents enabled + subagent profile loaded |
| Google Drive + Calendar | `drive_upload`, `drive_list`, `drive_read`, `drive_move`, `calendar_list`, `calendar_create`, `calendar_delete` | Pro + active Google OAuth connection + requested integration. OAuth is narrowed to `drive.file` + `calendar.events`; Drive access requires explicit Picker/OnePick file grants or app-created files. |
| Gmail Manual | `gmail_send`, `gmail_read`, `gmail_search`, `gmail_delete`, `gmail_modify_labels`, `gmail_list_labels` | Pro + active `gmail_manual` connection + requested integration. Gmail no longer uses Google OAuth scopes. |
| Microsoft 365 | `outlook_send`, `outlook_read`, `outlook_search`, `outlook_delete`, `outlook_move`, `outlook_list_folders`, `onedrive_upload`, `onedrive_list`, `onedrive_read`, `onedrive_move`, `ms_calendar_list`, `ms_calendar_create`, `ms_calendar_delete` | Pro + active Microsoft connection + requested integration |
| Notion | `notion_search`, `notion_read_page`, `notion_create_page`, `notion_update_page`, `notion_delete_page`, `notion_update_database_entry`, `notion_query_database` | Pro + active Notion connection + requested integration |
| Apple Calendar | `apple_calendar_list`, `apple_calendar_create`, `apple_calendar_update`, `apple_calendar_delete` | Pro + active Apple Calendar connection + requested integration |
| Slack | `slack_send_message`, `slack_read_messages`, `slack_search_messages`, `slack_list_channels`, `slack_search_users`, `slack_create_canvas`, `slack_update_canvas`, `slack_read_canvas`, `slack_read_user_profile` | Pro + active Slack connection + requested integration |
| Cloze | `cloze_person_find`, `cloze_person_count`, `cloze_person_add`, `cloze_person_change`, `cloze_project_find`, `cloze_project_change`, `cloze_add_note`, `cloze_add_todo`, `cloze_timeline`, `cloze_save_draft`, `cloze_about_me` | Pro + active Cloze connection + requested integration |
| Workspace/runtime | `workspace_exec`, `workspace_list_files`, `workspace_read_file`, `workspace_write_file`, `workspace_make_dirs`, `workspace_import_file`, `workspace_export_file`, `workspace_reset`, `data_python_exec`, `data_python_sandbox`, `vm_exec`, `vm_list_files`, `vm_read_file`, `vm_write_file`, `vm_delete_file`, `vm_make_dirs`, `vm_import_file`, `vm_export_file`, `vm_reset`, `read_pdf`, `generate_pdf`, `edit_pdf` | Pro (skill-activated) |

## Skills And Their Practical Role

Skills are curated or user-authored instruction packs that help the model choose the right workflow. They do not execute work by themselves; they point the model toward the right tool families.

### Visible built-in skills

| Family | Skills | Typical profile(s) | Gate |
|---|---|---|---|
| Runtime / analytics | `code-workspace`, `persistent-runtime`, `data-analyzer`, `dashboard-builder`, `data-validation`, `sql-data-query`, `statistical-analysis` | `workspace`, `persistentRuntime`, `analytics` | Pro (skill-activated) |
| Documents | `documents`, `document-review`, `document-drafting`, `docx`, `pdf`, `pptx`, `xlsx`, `doc-coauthoring` | mostly `docs`; `pdf` uses `persistentRuntime`; `documents` spans `docs` + `persistentRuntime`; `xlsx` also carries `analytics` metadata | Generally Pro-useful |
| Parallel decomposition | `parallel-subagents` plus selected strategy skills like `competitive-analysis`, `multi-platform-launch`, and `ai-pricing` | `subagents` | Pro-useful when subagents are enabled |
| Connected apps | `google-drive`, `prod-calendar-scheduler`, `gmail`, `microsoft-365`, `notion-workspace`, `apple-calendar`, `slack`, `cloze` | `google`, `gmailManual`, `microsoft`, `notion`, `appleCalendar`, `slack`, `cloze` | Pro, plus matching connection for real use |
| Productivity | `prod-brainstorming`, `prod-calendar-scheduler`, `prod-email-drafter`, `prod-meeting-notes` | instruction-led | Pro-useful |
| Product / PM | `pm-adr`, `pm-competitive-analysis`, `pm-experiment-design`, `pm-launch-checklist`, `pm-persona`, `pm-prd`, `pm-problem-statement`, `pm-retrospective`, `pm-sprint-planning`, `pm-user-stories` | instruction-led | Pro-useful |
| GTM / growth | `gtm-ai-pricing`, `gtm-cold-outreach`, `gtm-content-to-pipeline`, `gtm-expansion-retention`, `gtm-multi-platform-launch`, `gtm-positioning-icp`, `gtm-seo` | instruction-led | Pro-useful |
| Marketing | `campaign-planning`, `email-sequence`, `marketing-performance-report` | instruction-led; `marketing-performance-report` uses analytics profile | Pro-useful |
| Design | `design-critique`, `ux-copy` | instruction-led | Pro-useful |
| Engineering | `incident-response`, `testing-strategy` | instruction-led | Pro-useful |
| Finance | `financial-statements`, `reconciliation` | instruction-led; `reconciliation` uses analytics profile | Pro-useful |
| Legal / business documents | `contract-review`, `contract-drafting`, `legal-memo`, `clause-extraction`, `policy-review` | `docs` for citation-aware review and generated DOCX workflows | Pro-useful |
| Operations | `process-documentation` | instruction-led | Pro-useful |
| Internal communications | `internal-comms` including release notes, changelogs, stakeholder updates, and app-store update copy | instruction-led | Pro-useful |

### M33 document workflow skills

M33 added a dedicated document workflow layer on top of the lower-level file tools:

- review/citation skills: `document-review`, `contract-review`, `clause-extraction`
- drafting/generation skills: `document-drafting`, `contract-drafting`, `legal-memo`, `policy-review`
- removed M36 standalone legal templates (`conditions-precedent-checklist`, `credit-agreement-summary`, `shareholder-agreement-summary`) are preserved as M38 tabular review template requirements, not active catalog skills
- all use the existing progressive skill resolver; there is no separate template catalog or legal-only product mode
- generated DOCX outputs are saved as normal generated files and linked to canonical `documents` / `documentVersions`
- citation-aware skills only operate over explicit document scope from attachments, KB picker selections, or existing chat context; they do not search the whole Knowledge Base by default

### Hidden built-in skills

| Skill | Purpose | Visibility |
|---|---|---|
| `nanthai-mobile-runtime` | Internal capability-aware runtime instruction injection | Hidden |

`create-skill` remains visible and active as the user-facing skill management workflow.

## Skills With Explicit Tool Profile Metadata

These are the clearest examples of how skills and tools relate today.

| Skill | Required tool profiles | Required tool IDs | Required capabilities |
|---|---|---|---|
| `data-analyzer` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | none (M27) |
| `dashboard-builder` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | none (M27) |
| `data-validation` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | none (M27) |
| `sql-data-query` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | none (M27) |
| `statistical-analysis` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | none (M27) |
| `marketing-performance-report` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | none (M27) |
| `reconciliation` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | none (M27) |
| `code-workspace` | `workspace` | `workspace_exec`, `workspace_list_files`, `workspace_read_file`, `workspace_write_file`, `workspace_make_dirs`, `workspace_import_file`, `workspace_export_file`, `workspace_reset` | none (M27) |
| `persistent-runtime` | `persistentRuntime` | `vm_exec`, `vm_list_files`, `vm_read_file`, `vm_write_file`, `vm_delete_file`, `vm_make_dirs`, `vm_import_file`, `vm_export_file`, `vm_reset` | none |
| `pdf` | `persistentRuntime` | `read_pdf`, `generate_pdf`, `edit_pdf` | none |
| `parallel-subagents` | `subagents` | `spawn_subagents` | none |
| `documents` | `docs`, `persistentRuntime` | profile-driven document/text/email/PDF tools, plus scoped document workspace tools | none |
| `document-review` | `docs` | `list_documents`, `read_document`, `find_in_document` | none |
| `document-drafting` | `docs` | `read_document`, `generate_docx` | none |
| `docx` | `docs` | `generate_docx`, `read_docx`, `edit_docx` | none |
| `pptx` | `docs` | `generate_pptx`, `read_pptx`, `edit_pptx` | none |
| `xlsx` | `docs`, `analytics` | `generate_xlsx`, `read_xlsx`, `edit_xlsx` | none explicitly |
| `financial-statements` | `docs` | `generate_xlsx`, `read_xlsx`, `edit_xlsx`, `generate_docx` | none |
| `contract-drafting` | `docs` | `read_document`, `generate_docx` | none |
| `legal-memo` | `docs` | `read_document`, `find_in_document`, `generate_docx` | none |
| `clause-extraction` | `docs` | `list_documents`, `read_document`, `find_in_document` | none |
| `policy-review` | `docs` | `read_document`, `find_in_document`, `generate_docx` | none |
| `google-drive` | `google` | Drive tool IDs | `requiredIntegrationIds = ["drive"]`; access is `drive.file` + Picker/OnePick grants only |
| `gmail` | `google` | Gmail tool IDs | `requiredIntegrationIds = ["gmail"]`; the integration is satisfied by the `gmail_manual` provider, not Gmail OAuth |
| `microsoft-365` | `microsoft` | Outlook, OneDrive, MS Calendar tool IDs | `requiredIntegrationIds = ["outlook", "onedrive", "ms_calendar"]` |
| `notion-workspace` | `notion` | Notion page/database tool IDs | `requiredIntegrationIds = ["notion"]` |
| `apple-calendar` | `appleCalendar` | Apple Calendar tool IDs | `requiredIntegrationIds = ["apple_calendar"]` |
| `slack` | `slack` | Slack messaging tool IDs | `requiredIntegrationIds = ["slack"]` |
| `cloze` | `cloze` | Cloze CRM tool IDs | `requiredIntegrationIds = ["cloze"]` |

## User-Created Skills

User skills now carry the same routing metadata as system skills.

| Field | Purpose |
|---|---|
| `requiredToolProfiles` | Primary routing metadata for future progressive tool exposure |
| `requiredToolIds` | Explicit tool dependency and validation surface |
| `requiredIntegrationIds` | Connected-app requirements |
| `requiredCapabilities` | Visibility and entitlement gate |
| `runtimeMode` | `textOnly`, `toolAugmented`, or `sandboxAugmented` |

### Auto-inference behavior

On create/update, NanthAI normalizes skill metadata like this:

| Signal | Inferred result |
|---|---|
| Document workspace/generation tool IDs | add `docs` profile |
| `workspace_import_file` or `data_python_exec` | add `analytics` profile |
| Generic workspace tool IDs | add `workspace` profile |
| Persistent VM and PDF tool IDs | add `persistentRuntime` profile |
| Gmail / Drive / Calendar integration IDs | add `google` profile |
| Outlook / OneDrive / MS Calendar integration IDs | add `microsoft` profile |
| Notion integration ID | add `notion` profile |
| Apple Calendar integration ID | add `appleCalendar` profile |
| Slack integration ID | add `slack` profile |
| Cloze integration ID | add `cloze` profile |
| Scheduled job tool IDs | add `scheduledJobs` profile |
| Skill CRUD tool IDs | add `skillsManagement` profile |

### Practical safety rules

| Rule | Outcome |
|---|---|
| Integration profile without matching integration ID | orphaned profile pruned with warning (returned in `validationWarnings`) |
| User-facing editor | shows simplified toggles instead of raw profile IDs |

### Mutation return shape

`createSkill` and `updateSkill` now return `{ skillId, validationWarnings }` instead of just `skillId`. The `validationWarnings` array contains human-readable strings about auto-corrections applied during save (orphaned integration profiles pruned, inferred capabilities added, etc.). Clients should surface these warnings in the editor UI after a successful save.

## What Each Tier Actually Feels Like

| Capability surface | Free | Pro |
|---|---:|---:|
| Plain chat | Yes | Yes |
| Multi-model chat | Yes | Yes |
| Tool-calling at all | No | Yes |
| Document generation / reading / editing | No | Yes |
| Search chats | No | Yes |
| Personas | No | Yes |
| Scheduled jobs | No | Yes |
| Connected apps | No | Yes, if connected |
| Skill loading / management | No | Yes, when the active model supports tools |
| Subagents | No | Yes, when enabled and the active model supports tools |
| Workspace file system / shell | No | Yes (skill-activated) |
| Python analytics / chart generation | No | Yes (skill-activated) |

## Product Copy Guidance

For external communication, the cleanest framing today is:

| Audience | Recommended wording |
|---|---|
| Free users | "Core multi-model AI chat" |
| Pro users | "Advanced workflows, documents, connected apps, scheduled jobs, skills, code execution, and data analytics" |

### Important wording note for runtime

The runtime workspace is:

- temporary per chat
- paused automatically after inactivity
- not a permanent personal VM
- durable only when outputs are exported back into NanthAI storage

In practice there are now two runtime shapes:

- `workspace_*`: cheap ephemeral just-bash workspace for short-lived tasks
- `vm_*` / PDF tools: persistent Vercel runtime for multi-turn stateful work

## See Also

- [`architecture.md`](architecture.md) — backend tool registry and Convex execution flow
- [`client-convex-contract.md`](client-convex-contract.md) — shared client-facing Convex contract
- [`tech-stack.md`](tech-stack.md) — OSS runtime and dependency overview

## Slack MCP Tools — Hosted MCP And Drift Detection

Unlike the Google / Microsoft / Notion / Cloze tools which call raw provider REST APIs, Slack tools call Slack's hosted Model Context Protocol endpoint at `https://mcp.slack.com/mcp`. The public NanthAI tool IDs (`slack_send_message`, `slack_search_messages`, etc.) are stable Convex wrappers around the live Slack MCP tools. Wrapper names never change; the MCP tool names and argument schemas they call through to are allowed to evolve on Slack's side.

Key properties of this layer:

- **User-facing tool IDs are stable.** iOS/Android label maps, the skill catalog (`convex/skills/catalog/slack.ts`), and tool-ID validators all key off the wrapper IDs. Renames on Slack's side must not leak into clients.
- **`slack_search_messages` is a routing wrapper.** It forwards to Slack's `slack_search_public` (default) or `slack_search_public_and_private` based on an `include_private` flag.
- **Per-user state is only the OAuth token.** Tool argument schemas are global. Updating a wrapper deploys to every user simultaneously — no per-user reconnect needed.
- **`convex/tools/slack/mcp_tools_snapshot.ts`** holds a committed baseline of the live MCP `tools/list` response (tool names + sorted required/properties arrays).
- **`checkSlackMcpDrift`** (weekly internal cron, `0 6 * * 1`) picks any active Slack connection, probes `tools/list`, diffs against the snapshot, and `console.warn`s on drift (`missing_in_live`, `new_in_live`, `required_changed`, `properties_changed`). It never auto-updates the baseline — drift must be reviewed manually and the snapshot + wrappers updated together.
- If no active Slack connection exists across all users, the drift check skips silently.
