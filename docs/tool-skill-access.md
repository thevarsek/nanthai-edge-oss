# Tool, Skill & Capability Access Map

> Canonical reference for what NanthAI exposes at each tier, how skills relate to tools, and what is currently gated by Pro, connected apps, or internal runtime capability.

## Purpose

This document is the product-facing complement to the lower-level architecture docs.

Use it when you need to answer:

- what Free vs Pro vs internal Max users can actually do
- which tools are executable versus which skills are discoverable instructions
- which connected-app features depend on OAuth connections
- which runtime features are internal-only and manually granted today

## Core Model

NanthAI has three separate concepts that interact:

| Layer | What it is | Example | How it is gated |
|---|---|---|---|
| Capability / tier | Account-level access state | `pro`, `sandboxRuntime` | Purchase entitlements and manual capability grants |
| Skill | Instruction pack the model can discover and load | `data-analyzer`, `docx`, `google-workspace` | Skill visibility + capability requirements |
| Tool | Executable backend function callable by the model | `generate_xlsx`, `gmail_read`, `data_python_exec` | Tool registry built server-side per run |

### Important current implementation note

The latest architecture now uses **progressive tool discovery** for normal chat generation:

- **Free** users still get no tool registry
- **Pro** users start with a small base registry
- loading a skill expands the active tool profiles for the next turn
- **Internal runtime** users can unlock analytics/workspace profiles in the same progressive way

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
- persona and scheduled-job writes also silently strip `enabledIntegrations` when the selected model cannot use tools
- clients should still disable incompatible integrations / skills / subagent controls ahead of time so users do not save or send configurations that will be downgraded server-side

## Tier And Capability Matrix

| Tier / Capability | How granted | What it unlocks | What stays blocked |
|---|---|---|---|
| `Free` | Default account state | Basic chat, model switching, normal conversation UX | All model-invoked tools, connected-app actions, runtime |
| `Pro` (`pro`) | App purchase entitlement or manual grant | Standard NanthAI tool registry: docs/files, chat search, scheduled jobs, personas, skills, connected apps, optional subagents | Workspace/runtime tools and runtime-only skills |
| `Internal Max runtime` (`sandboxRuntime`) | Manual Convex capability grant only | Everything in Pro plus temporary per-chat workspace execution, Python analytics, chart generation/export, runtime-only skills | MCP runtime |
| `mcpRuntime` | Reserved only | No public surface yet | MCP execution remains unavailable |

## Tool Registry By Gate

### High-level exposure

| Tool family | Gate |
|---|---|
| Document, text, utility, search, persona, scheduled-job, and skill tools | Pro + active model tool-capable |
| Connected-app tools | Pro + active model tool-capable + active connection + integration requested for the run |
| Subagents | Pro + active model tool-capable + single-participant chat + subagents enabled |
| Workspace/runtime tools | Pro + active model tool-capable + `sandboxRuntime` |

### Executable tool families

| Tool family | Tool IDs | Gate |
|---|---|---|
| Document tools | `generate_docx`, `read_docx`, `edit_docx`, `generate_pptx`, `read_pptx`, `edit_pptx`, `generate_xlsx`, `read_xlsx`, `edit_xlsx` | Pro |
| Text/file tools | `generate_text_file`, `read_text_file`, `generate_eml`, `read_eml` | Pro |
| Utility | `fetch_image` | Pro |
| Chat search | `search_chats` | Pro |
| Scheduled jobs | `create_scheduled_job`, `list_scheduled_jobs`, `delete_scheduled_job` | Pro |
| Persona management | `create_persona`, `delete_persona` | Pro |
| Skill management and discovery | `load_skill`, `list_skills`, `create_skill`, `update_skill`, `delete_skill`, `enable_skill_for_chat`, `disable_skill_for_chat`, `assign_skill_to_persona`, `remove_skill_from_persona` | Pro |
| Subagents | `spawn_subagents` | Pro + tool-capable model + subagents enabled + subagent profile loaded |
| Google Workspace | `gmail_send`, `gmail_read`, `gmail_search`, `gmail_delete`, `gmail_modify_labels`, `gmail_list_labels`, `drive_upload`, `drive_list`, `drive_read`, `drive_move`, `calendar_list`, `calendar_create`, `calendar_delete` | Pro + active Google connection + requested integration |
| Microsoft 365 | `outlook_send`, `outlook_read`, `outlook_search`, `outlook_delete`, `outlook_move`, `outlook_list_folders`, `onedrive_upload`, `onedrive_list`, `onedrive_read`, `onedrive_move`, `ms_calendar_list`, `ms_calendar_create`, `ms_calendar_delete` | Pro + active Microsoft connection + requested integration |
| Notion | `notion_search`, `notion_read_page`, `notion_create_page`, `notion_update_page`, `notion_delete_page`, `notion_update_database_entry`, `notion_query_database` | Pro + active Notion connection + requested integration |
| Apple Calendar | `apple_calendar_list`, `apple_calendar_create`, `apple_calendar_update`, `apple_calendar_delete` | Pro + active Apple Calendar connection + requested integration |
| Workspace/runtime | `workspace_exec`, `workspace_list_files`, `workspace_read_file`, `workspace_write_file`, `workspace_make_dirs`, `workspace_import_file`, `workspace_export_file`, `data_python_exec`, `workspace_reset` | Pro + `sandboxRuntime` |

## Skills And Their Practical Role

Skills are curated or user-authored instruction packs that help the model choose the right workflow. They do not execute work by themselves; they point the model toward the right tool families.

### Visible built-in skills

| Family | Skills | Typical profile(s) | Gate |
|---|---|---|---|
| Runtime / analytics | `code-workspace`, `data-analyzer`, `dashboard-builder`, `data-validation`, `sql-data-query`, `statistical-analysis` | `workspace`, `analytics` | `sandboxRuntime` |
| Documents | `documents`, `docx`, `pptx`, `xlsx`, `doc-coauthoring` | mostly `docs`; `xlsx` also carries `analytics` metadata | Generally Pro-useful |
| Parallel decomposition | `parallel-subagents` plus selected strategy skills like `competitive-analysis`, `multi-platform-launch`, and `ai-pricing` | `subagents` | Pro-useful when subagents are enabled |
| Connected apps | `google-workspace`, `microsoft-365`, `notion-workspace`, `apple-calendar` | `google`, `microsoft`, `notion`, `appleCalendar` | Pro, plus matching connection for real use |
| Productivity | `prod-brainstorming`, `prod-calendar-scheduler`, `prod-email-drafter`, `prod-meeting-notes` | instruction-led | Pro-useful |
| Product / PM | `pm-adr`, `pm-competitive-analysis`, `pm-experiment-design`, `pm-launch-checklist`, `pm-persona`, `pm-prd`, `pm-problem-statement`, `pm-release-notes`, `pm-retrospective`, `pm-sprint-planning`, `pm-user-stories` | instruction-led | Pro-useful |
| GTM / growth | `gtm-ai-pricing`, `gtm-cold-outreach`, `gtm-content-to-pipeline`, `gtm-expansion-retention`, `gtm-multi-platform-launch`, `gtm-positioning-icp`, `gtm-seo`, `gtm-solo-founder` | instruction-led | Pro-useful |
| Marketing | `campaign-planning`, `email-sequence`, `marketing-performance-report` | instruction-led; `marketing-performance-report` is `sandboxAugmented` | Pro-useful; `marketing-performance-report` requires `sandboxRuntime` |
| Design | `design-critique`, `ux-copy` | instruction-led | Pro-useful |
| Engineering | `incident-response`, `testing-strategy` | instruction-led | Pro-useful |
| Finance | `financial-statements`, `reconciliation` | instruction-led; `reconciliation` is `sandboxAugmented` | Pro-useful; `reconciliation` requires `sandboxRuntime` |
| Legal | `contract-review` | instruction-led | Pro-useful |
| Operations | `process-documentation` | instruction-led | Pro-useful |
| Internal communications | `internal-comms` | instruction-led | Pro-useful |

### Hidden built-in skills

| Skill | Purpose | Visibility |
|---|---|---|
| `nanthai-mobile-runtime` | Internal capability-aware runtime instruction injection | Hidden |
| `create-skill` | Internal guidance for generating/editing skills correctly | Hidden |

## Skills With Explicit Tool Profile Metadata

These are the clearest examples of how skills and tools relate today.

| Skill | Required tool profiles | Required tool IDs | Required capabilities |
|---|---|---|---|
| `data-analyzer` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | `sandboxRuntime` |
| `dashboard-builder` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | `sandboxRuntime` |
| `data-validation` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | `sandboxRuntime` |
| `sql-data-query` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | `sandboxRuntime` |
| `statistical-analysis` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | `sandboxRuntime` |
| `marketing-performance-report` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | `sandboxRuntime` |
| `reconciliation` | `analytics` | `workspace_import_file`, `data_python_exec`, `workspace_export_file` | `sandboxRuntime` |
| `code-workspace` | `workspace` | `workspace_exec`, `workspace_list_files`, `workspace_read_file`, `workspace_write_file`, `workspace_make_dirs`, `workspace_import_file`, `workspace_export_file`, `workspace_reset` | `sandboxRuntime` |
| `parallel-subagents` | `subagents` | `spawn_subagents` | none |
| `documents` | `docs` | profile-driven document/text/email tools | none |
| `docx` | `docs` | `generate_docx`, `read_docx`, `edit_docx` | none |
| `pptx` | `docs` | `generate_pptx`, `read_pptx`, `edit_pptx` | none |
| `xlsx` | `docs`, `analytics` | `generate_xlsx`, `read_xlsx`, `edit_xlsx` | none explicitly |
| `financial-statements` | `docs` | `generate_xlsx`, `read_xlsx`, `edit_xlsx`, `generate_docx` | none |
| `google-workspace` | `google` | Gmail, Drive, Calendar tool IDs | `requiredIntegrationIds = ["gmail", "drive", "calendar"]` |
| `microsoft-365` | `microsoft` | Outlook, OneDrive, MS Calendar tool IDs | `requiredIntegrationIds = ["outlook", "onedrive", "ms_calendar"]` |
| `notion-workspace` | `notion` | Notion page/database tool IDs | `requiredIntegrationIds = ["notion"]` |
| `apple-calendar` | `appleCalendar` | Apple Calendar tool IDs | `requiredIntegrationIds = ["apple_calendar"]` |

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
| Document tool IDs | add `docs` profile |
| `workspace_import_file` or `data_python_exec` | add `analytics` profile + require `sandboxRuntime` |
| Generic workspace tool IDs | add `workspace` profile + require `sandboxRuntime` |
| Gmail / Drive / Calendar integration IDs | add `google` profile |
| Outlook / OneDrive / MS Calendar integration IDs | add `microsoft` profile |
| Notion integration ID | add `notion` profile |
| Apple Calendar integration ID | add `appleCalendar` profile |
| Scheduled job tool IDs | add `scheduledJobs` profile |
| Skill CRUD tool IDs | add `skillsManagement` profile |

### Practical safety rules

| Rule | Outcome |
|---|---|
| Runtime-capable user skill without `sandboxRuntime` access | rejected by backend normalization |
| Integration profile without matching integration ID | rejected |
| Skill with runtime profile | visibility can be gated by `requiredCapabilities` |
| User-facing editor | shows simplified toggles instead of raw profile IDs |

## What Each Tier Actually Feels Like

| Capability surface | Free | Pro | Pro + `sandboxRuntime` |
|---|---:|---:|---:|
| Plain chat | Yes | Yes | Yes |
| Multi-model chat | Yes | Yes | Yes |
| Tool-calling at all | No | Yes | Yes |
| Document generation / reading / editing | No | Yes | Yes |
| Search chats | No | Yes | Yes |
| Personas | No | Yes | Yes |
| Scheduled jobs | No | Yes | Yes |
| Connected apps | No | Yes, if connected | Yes, if connected |
| Skill loading / management | No | Yes, when the active model supports tools | Yes, when the active model supports tools |
| Subagents | No | Yes, when enabled and the active model supports tools | Yes, when enabled and the active model supports tools |
| Workspace file system / shell | No | No | Yes |
| Python analytics / chart generation | No | No | Yes |
| Runtime-only skills visible in the skill catalog | No | No | Yes |

## Product Copy Guidance

For external communication, the cleanest framing today is:

| Audience | Recommended wording |
|---|---|
| Free users | "Core multi-model AI chat" |
| Pro users | "Advanced workflows, documents, connected apps, scheduled jobs, and skills" |
| Internal / future Max users | "Everything in Pro plus a temporary coding and analytics workspace" |

### Important wording note for runtime

The runtime workspace is:

- temporary per chat
- paused automatically after inactivity
- not a permanent personal VM
- durable only when outputs are exported back into NanthAI storage

## See Also

- [`monetization.md`](monetization.md) — commercial Free vs Pro positioning
- [`max-runtime-analytics.md`](max-runtime-analytics.md) — internal runtime architecture
- [`architecture.md`](architecture.md) — backend tool registry and Convex execution flow
- [`mobile-api-contract.md`](mobile-api-contract.md) — shared client-facing Convex contract
