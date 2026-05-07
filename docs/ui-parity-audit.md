# UI Parity Audit

> M36 implementation source of truth for cross-platform visual parity, screenshot capture, status colors, component tokens, and workspace readiness notes.

## Current Baseline

- iOS is the mobile taste reference for chat, composer, navigation, controls, and animation restraint.
- Web is the large-screen density reference for sidebar, sticky panel, and workspace-style layouts.
- Android is the primary visual rebuild target and must retain the M34 performance gains.
- M35 owner guardrail: use existing owners/helpers first, and extract only when the touched behavior needs a real ownership or test boundary.
- Initial skill catalog inventory: 71 system skills, 60 visible, 10 integration-managed, 1 hidden. M36 consolidation removes 5 standalone seeded skills, leaving 66 seeded system skills: 55 visible, 10 integration-managed, and 1 hidden. Known catalog lint gaps at implementation start: Cloze validator allow-list drift, `data-analyzer` instruction length, and broad screenshot/browser validator matches.

## Severity Labels

| Label | Meaning | Required Action |
|-------|---------|-----------------|
| Blocker | A surface undermines product trust, accessibility, or shared workflow meaning | Fix before M36 closeout |
| Inconsistency | Same product state or component intent renders with conflicting vocabulary, color, density, or hierarchy | Align unless platform convention clearly wins |
| Polish | Surface works but feels less deliberate than iOS/web reference | Fix when in audited high-impact surfaces |
| Platform-acceptable difference | Divergence follows native platform expectation without changing product meaning | Document only |

## Canonical Screens

| Surface | iOS Reference | Web Reference | Android Target | Status |
|---------|---------------|---------------|----------------|--------|
| Onboarding/auth shell | Screenshot pending | Screenshot pending | Screenshot pending | Audit open |
| Chat list | Screenshot pending | Screenshot pending | Align rows, timestamps, folders, pinned/favorite treatment | Audit open |
| Chat detail | Screenshot pending | Screenshot pending | Align assistant rows, status cards, generated document/file cards | Audit open |
| Composer and attachments | Screenshot pending | Screenshot pending | Align button sizes, glass readability, attachment chips | Audit open |
| Message bubbles and assistant cards | Screenshot pending | Screenshot pending | Align typography, spacing, action buttons, state badges | Audit open |
| Generated file/document cards | Screenshot pending | Screenshot pending | Align card radius, icon blocks, metadata, download/open buttons | Audit open |
| Citations/source dialogs | Screenshot pending | Screenshot pending | Align citation cards and source labels | Audit open |
| Knowledge Base list/picker | Screenshot pending | Screenshot pending | Align row density, file metadata, picker affordances | Audit open |
| Settings/chat defaults | Screenshot pending | Screenshot pending | Reduce oversized Material defaults and nested cards | Audit open |
| Model/persona/skill pickers | Screenshot pending | Screenshot pending | Align chips, disabled/pro states, row hit targets | Audit open |
| Scheduled jobs | Screenshot pending | Screenshot pending | Align status colors, trigger tokens, run history rows | Audit open |
| Skills list/detail/editor | Screenshot pending | Screenshot pending | Align built-in/custom/default state badges and editor controls | Audit open |
| Large-screen/tablet layouts | Screenshot pending | Screenshot pending | Verify tablet split behavior against iPad/web density | Audit open |

## Canonical Colors

| Token | Hex | Notes |
|-------|-----|-------|
| Primary | `#FF6B3D` | Brand, primary action, running/streaming |
| Primary high contrast | `#D5381C` | High-contrast theme |
| Teal primary | `#00B8D9` | Teal theme |
| Lilac primary | `#9A7CF2` | Lilac theme |
| Secondary/info | `#61A6FF` | Secondary info status only when primary would confuse hierarchy |
| Success | `#34C759` | Success, complete, accepted |
| Warning | `#FF9500` | Warning, paused, cancelled |
| Danger | `#FF3B30` | Failed, rejected, destructive |
| Light background | `#FFFFFF` | Page background |
| Light elevated surface | `#FFFFFF` | Cards/modals |
| Light input/list fill | `#F2F2F2` | Inputs, grouped rows, assistant bubbles |
| Light code fill | `#F8F8F8` | Code/pre |
| Light muted text | `#767676` | Secondary labels |
| Dark background | `#000000` | Page background |
| Dark elevated surface | `#0A0A0A` | Cards/modals |
| Dark input/list fill | `#1A1A1A` | Inputs, grouped rows, assistant bubbles |
| Dark code fill | `#121212` | Code/pre |
| Dark muted text | `#949494` | Secondary labels |

Light borders use black at 6-12% opacity. Dark borders use white at 10-16% opacity.

## Status Contract

| State | Text | Fill | Usage |
|-------|------|------|-------|
| `pending` | Muted | Input/list fill | Queued, waiting, inactive pending |
| `running`, `streaming` | Primary | Primary 10-15% | Active generation, in-flight tool work |
| `complete`, `success`, `accepted` | Success | Success 10-15% | Successful terminal state |
| `failed`, `error`, `rejected`, `destructive` | Danger | Danger 10-15% | Error/rejected/destructive terminal state |
| `cancelled`, `warning`, `paused` | Warning | Warning 10-15% | User-cancelled, paused, warning |
| `unavailable`, `locked`, `pro` | Muted | Surface/border fill | Capability unavailable or locked state |

## Component Contract

| Component | Contract |
|-----------|----------|
| Primary command | Primary fill, white text, 40-44pt/dp minimum hit height, pill or 14px radius |
| Secondary command | Input/surface fill, foreground text, 0.5-1px border |
| Destructive command | Danger text; danger fill only for final confirmation |
| Icon button | 40pt/dp hit target, 18-22pt icon, accessible name/tooltip |
| Disabled control | 45-55% opacity, no alternate hue |
| Card | 12pt/px radius; 8pt/px for dense workspace cells; no nested cards |
| Chip/badge | Pill radius, 10-12pt/px label, semantic 10-15% fill, full semantic text color |
| Input | 14pt/px radius, input fill, token border on focus, primary focus ring |
| Row | Stable height, full-row hit target, subtle divider/border, no layout shift |
| Toolbar | Sticky when workspace/detail context benefits from repeated action access |

## Workspace Readiness

- Review card: one title/summary, one status badge, direct accept/reject or retry actions, source/document metadata, no nested card shell.
- Citation/source card: quote first, source metadata second, open/download actions as icon buttons.
- Split workspace: desktop web persistent sidebar plus sticky toolbar; tablet adaptive split when width allows; phone full-screen drill-in.
- Editable table cell: 8px radius, clear focus border, compact status badge, inline retry/error affordance.
- Progress/error/retry banner: semantic status fill, concise copy, one primary retry/action.

### M37/M38 Handoff Rules

- M37 tracked-change cards should reuse the review-card contract rather than inventing a second accept/reject card language. The backend edit status remains the source of truth; UI cards and review workspace surfaces only render that state.
- M37 document preview sidebars may defer perfect highlight positioning in v1, but source/edit cards must still show document metadata, concise reason text, and current accept/reject status with semantic tokens.
- M38 review grids should reuse the editable-table-cell contract: compact cells, stable row/column dimensions, inline status chips, and citation/source cards that open from the cell without changing the cell layout.
- Chat-created M38 tabular reviews stay draft-only until the workspace action starts generation. This keeps chat skill output aligned with the explicit-generation rule in the M38 milestone.
- Android and iOS mobile workspaces should use full-screen drill-in for dense review surfaces; tablet and desktop layouts can split when width allows.

## Skill Catalog Audit Snapshot

| Metric | Current Value |
|--------|---------------|
| Original system skills before consolidation | 71 |
| Seeded system skills after consolidation | 66 |
| Visible skills | 55 |
| Integration-managed skills | 10 |
| Hidden skills | 1 |
| Archived skills | `apple-calendar`, `google-calendar` |
| Removed standalone skills | `conditions-precedent-checklist`, `credit-agreement-summary`, `release-notes`, `shareholder-agreement-summary`, `solo-founder-gtm` |
| Current lint gaps | Cloze allow-list drift; `data-analyzer` over 10k chars; broad browser/screenshot validator matches |

## Capture Notes

Capture before/after screenshots for each canonical screen in iOS simulator, web desktop/mobile viewport, and Android device/emulator. Store screenshots under `artifacts/m36-ui-audit/` or attach them to the milestone notes if generated by an external workflow. Each screenshot entry should record platform, route, theme, viewport/device, date, and any relevant seeded/auth state.

For the M36 code/test parity pass, screenshots are optional evidence rather than a blocking exit criterion. Code review, automated tests, lint/type checks, and platform builds are the primary acceptance gates. If a visual issue remains visible on device, capture only that affected surface and attach it with the entry template below.

### Screenshot Matrix

Use this matrix while capturing the remaining M36 evidence. Prefer one light-mode and one dark-mode capture for each high-impact surface. If a surface cannot be reached locally, record why in the Notes column rather than leaving it implicit.

| Surface | iOS | Web Desktop | Web Mobile | Android Phone | Android Tablet | Notes |
|---------|-----|-------------|------------|---------------|----------------|-------|
| Onboarding/auth shell | Pending | Pending | Pending | Pending | Pending | Include unauthenticated state. |
| Chat list | Pending | Pending | Pending | Pending | Pending | Include folders, favorite/pinned state, timestamp density. |
| Chat detail | Pending | Pending | Pending | Pending | Pending | Include mixed user/assistant messages and failed/running states. |
| Composer and attachments | Pending | Pending | Pending | Pending | Pending | Include expanded attachment/menu state where available. |
| Message bubbles and assistant cards | Pending | Pending | Pending | Pending | Pending | Include markdown, code, tool call, and action-button rows. |
| Generated file/document cards | Pending | Pending | Pending | Pending | Pending | Include generated DOCX/PDF/chart/video cards when fixtures exist. |
| Citations/source dialogs | Pending | Pending | Pending | Pending | Pending | Include source metadata and open/download actions. |
| Knowledge Base list/picker | Pending | Pending | Pending | Pending | Pending | Include empty, populated, and pro/locked where available. |
| Settings/chat defaults | Pending | Pending | Pending | Pending | Pending | Include account, provider, appearance, and defaults sections. |
| Model/persona/skill pickers | Pending | Pending | Pending | Pending | Pending | Include unavailable/pro states and selected chips. |
| Scheduled jobs | Pending | Pending | Pending | Pending | Pending | Include run history and status token rows. |
| Skills list/detail/editor | Pending | Pending | Pending | Pending | Pending | Include built-in/custom/default badges and editor controls. |
| Large-screen/tablet layouts | Pending | Pending | Not applicable | Pending | Pending | Include split panes and drill-in fallback. |

### Capture Entry Template

Each screenshot or recording entry should use this format in the milestone, a PR note, or a companion audit file:

```markdown
#### [Surface] — [Platform] — [Theme]

- Artifact: `artifacts/m36-ui-audit/[filename].png`
- Date: YYYY-MM-DD
- App state: unauthenticated/authenticated, seeded fixture/live dev, pro/free
- Device/viewport: simulator/device/browser viewport
- Route/screen: concrete route, navigation path, or test fixture
- Severity findings:
  - `[label]` concise finding with component/state and intended follow-up
- Platform-acceptable differences:
  - concise note, or `None`
- Follow-up owner: M36 / M37 / M38 / backlog
```

## Implementation Notes

### Android Rebuild Targets

Use the existing Compose ownership boundaries and shared primitives before adding new abstractions:

- Shared tokens and primitives: `android/app/src/main/java/com/nanthai/edge/ui/theme/` and `android/app/src/main/java/com/nanthai/edge/ui/shared/`
- Chat list/detail: `android/app/src/main/java/com/nanthai/edge/features/chat/`
- Knowledge Base: `android/app/src/main/java/com/nanthai/edge/features/knowledgebase/`
- Settings and chat defaults: `android/app/src/main/java/com/nanthai/edge/features/settings/`
- Skills list/detail/editor: `android/app/src/main/java/com/nanthai/edge/features/skills/`

Prioritize row density, stable hit targets, status chips, card hierarchy, and generated-document/citation affordances. Avoid platform-wide Material theme churn unless a token is reused by multiple audited surfaces.

Closeout implementation targets:

- Generated artifacts and attachments should use shared icon blocks, stable metadata rows, 12dp cards, and 40dp action targets.
- Status/search/reasoning/progress cards should use semantic status tones and avoid nested card stacks.
- Picker and settings rows should prefer full-row hit areas with subtle borders over oversized Material cards.
- Integration account cards should show connection state as a semantic chip and keep provider actions as normal controls rather than dense nested panels.

### Web Polish Targets

Web changes should focus on M37/M38 readiness rather than broad visual redesign:

- Tokens and shared controls: `web/src/lib/uiTokens.ts` and `web/src/components/shared/`
- Chat/workspace primitives: `web/src/components/chat/`
- Chat list and navigation density: `web/src/components/chat-list/` and `web/src/components/layout/`
- Settings/picker parity: `web/src/components/settings/`

Prioritize layout stability, generated-card consistency, citation/source-card hierarchy, sticky workspace controls, and responsive fallbacks.

Closeout implementation targets:

- Generated artifact and citation cards should share semantic panel classes and avoid height jumps between loading, unavailable, and ready states.
- Chat list and sidebar controls should keep stable hit targets and avoid decorative floating chrome that would conflict with workspace density.
- Workspace-ready web surfaces should document sticky-toolbar and split-pane assumptions instead of adding incomplete M37/M38 routes during M36.

### iOS Reference Targets

iOS remains the reference unless the audit finds an inconsistency that should not propagate:

- Chat and composer reference: `NanthAi-Edge/NanthAi-Edge/Views/Chat/`
- Chat list reference: `NanthAi-Edge/NanthAi-Edge/Views/ChatList/`
- Pickers and shared controls: `NanthAi-Edge/NanthAi-Edge/Views/Shared/`
- Settings, Knowledge Base, scheduled jobs, and skills: `NanthAi-Edge/NanthAi-Edge/Views/Settings/`

Keep iOS changes narrow and covered by focused tests when they touch helpers, projections, DTOs, or view models.

## Skill Catalog Decision Log

Use this table for Phase 6. Classification should improve assistant behavior, not merely reduce catalog size.

| Skill Slug | Domain | Current Visibility | Classification | Reason | Action | M37/M38 Impact |
|------------|--------|--------------------|----------------|--------|--------|----------------|
| `adr` | PM/Engineering | Visible | Keep | Narrow decision-record output with clear trigger. | Preserve. | None direct. |
| `ai-pricing` | GTM | Visible | Keep | Distinct pricing strategy workflow. | Preserve; watch overlap with GTM positioning only at summary level. | None direct. |
| `apple-calendar` | Integration | Integration-managed, archived | Archive | Standalone discovery skill is intentionally archived. | Keep archived unless Apple Calendar is reintroduced as a primary standalone path. | None direct. |
| `brainstorming` | Productivity | Visible | Keep | General ideation workflow with no tool requirements. | Preserve. | None direct. |
| `calendar-scheduler` | Productivity/Integration | Integration-managed | Keep | Active scheduler path for Microsoft and Apple calendar tasks. | Preserve; ensure Google scheduling routes through `google-workspace`. | None direct. |
| `campaign-planning` | Marketing | Visible | Keep | Distinct campaign-planning output; now owns solo-founder/small-team GTM constraints. | Preserve with tightened launch-routing summary. | None direct. |
| `cloze` | Integration | Integration-managed | Keep | Narrow CRM integration path. | Preserve. | None direct. |
| `code-workspace` | Runtime | Visible | Keep | Temporary workspace workflow is distinct from persistent runtime. | Preserve. | None direct. |
| `ai-cold-outreach` | GTM | Visible | Keep | Distinct outbound sequence workflow. | Preserve. | None direct. |
| `clause-extraction` | Legal/Documents | Visible | Keep | Narrow extraction workflow with citations. | Preserve; may become a redline-review helper. | Supports M37 issue extraction. |
| `competitive-analysis` | PM/GTM | Visible | Keep | Distinct market comparison output. | Preserve. | None direct. |
| `conditions-precedent-checklist` | Legal/Documents | Removed from seed | Template | Mainly a repeatable checklist/document preset. | Remove standalone skill; preserve source behavior in `contract-review` and M38 template handoff. | Pattern for M38 tabular checklist reviews. |
| `content-to-pipeline` | GTM | Visible | Keep | Distinct content-led growth workflow. | Preserve. | None direct. |
| `contract-review` | Legal/Documents | Visible | Keep | Broad legal review entry point with clear risk-review trigger. | Preserve; ensure M37 tracked-change trigger does not compete. | Adjacent to M37 redline review. |
| `contract-drafting` | Legal/Documents | Visible | Keep | Drafting is distinct from review. | Preserve. | None direct. |
| `create-skill` | Skills | Visible | Keep | Only catalog-management skill. | Preserve. | Needed for future skill edits. |
| `credit-agreement-summary` | Legal/Documents | Removed from seed | Template | Repeatable legal summary preset. | Remove standalone skill; preserve source behavior in `contract-review` and M38 template handoff. | Required M38 legal summary preset. |
| `dashboard-builder` | Data/Analytics | Visible | Keep | Multi-chart/dashboard output is distinct from generic data analysis. | Preserve. | M38 may reuse chart/table output discipline. |
| `data-analyzer` | Data/Analytics | Visible | Keep | General sandbox analysis router; already tightened. | Preserve; keep summary narrower than dashboard/statistical/SQL skills. | Useful for M38 data review. |
| `data-validation` | Data/Analytics | Visible | Keep | Dataset quality audit is distinct. | Preserve. | Supports M38 validation workflows. |
| `design-critique` | Design | Visible | Keep | Distinct UI review workflow. | Preserve. | Supports M36 visual audit follow-up. |
| `doc-coauthoring` | Documents | Visible | Keep | Guided collaborative writing workflow, not just file generation. | Preserve; keep summary distinct from `document-drafting`. | None direct. |
| `document-drafting` | Documents | Visible | Keep | General polished document drafting. | Preserve; avoid competing with format-specific `docx` trigger. | Adjacent to M37 document generation. |
| `document-review` | Documents | Visible | Keep | General quote-backed document review. | Preserve; M37 tracked-change review should extend, not replace. | Direct precursor for M37 review UX. |
| `documents` | Documents | Visible | Keep | Broad file-work entry point when no format-specific skill is obvious. | Preserve; keep summary routing-oriented. | Foundation for M37/M38 file handling. |
| `docx` | Documents | Visible | Keep | Narrow Word format skill with concrete tool expectations. | Preserve; add redline/tracked-change guidance if backend tools support it. | Needed for M37 tracked changes. |
| `email-drafter` | Productivity | Visible | Keep | General one-off email drafting is distinct from sequences/campaigns. | Preserve. | None direct. |
| `email-sequence` | Marketing | Visible | Keep | Multi-step marketing email workflow. | Preserve; keep distinct from cold outreach and email drafter. | None direct. |
| `expansion-retention` | GTM | Visible | Keep | Customer retention/expansion strategy is distinct. | Preserve. | None direct. |
| `experiment-design` | PM/Data | Visible | Keep | Experiment design and metrics planning is distinct. | Preserve. | None direct. |
| `financial-statements` | Finance/Data | Visible | Keep | Finance statement analysis/reporting has specific outputs. | Preserve. | M38 may reuse tabular review patterns. |
| `gmail` | Integration | Integration-managed | Keep | Narrow Gmail integration path. | Preserve. | None direct. |
| `google-calendar` | Integration | Integration-managed, archived | Archive | Standalone Google Calendar path is intentionally archived in favor of Google Workspace. | Keep archived. | None direct. |
| `google-drive` | Integration | Integration-managed | Keep | Narrow Drive file path with picker constraints. | Preserve. | Supports file inputs for M37/M38. |
| `google-workspace` | Integration | Integration-managed | Keep | Cross-Google workflow router. | Preserve. | Supports workspace file/email/calendar context. |
| `incident-response` | Engineering | Visible | Keep | Incident workflow has clear trigger and document output. | Preserve. | None direct. |
| `internal-comms` | Productivity | Visible | Keep | Internal/stakeholder communication formats are distinct and now include release notes/changelogs. | Preserve; merged `release-notes` trigger here. | None direct. |
| `launch-checklist` | PM/GTM | Visible | Keep | Cross-functional launch readiness checklist. | Preserve; watch overlap with product launch. | None direct. |
| `legal-memo` | Legal/Documents | Visible | Keep | Specific legal memo output. | Preserve. | None direct. |
| `marketing-performance-report` | Marketing/Data | Visible | Keep | Metrics/reporting workflow needs analytics profile. | Preserve. | M38 may reuse report grid patterns. |
| `meeting-notes` | Productivity/Documents | Visible | Keep | Transcript/notes transformation has clear trigger. | Preserve. | None direct. |
| `microsoft-365` | Integration | Integration-managed | Keep | Cross-Microsoft workflow router. | Preserve. | Supports workspace file/email/calendar context. |
| `multi-platform-launch` | GTM | Visible | Keep | Product launch execution across channels. | Preserve; summary should stay distinct from `campaign-planning` and `launch-checklist`. | None direct. |
| `notion-workspace` | Integration | Integration-managed | Keep | Narrow Notion integration path. | Preserve. | None direct. |
| `pdf` | Documents | Visible | Keep | Narrow PDF rendering/extraction/regeneration skill. | Preserve. | Supports M37 preview/source checks. |
| `parallel-subagents` | Runtime | Visible | Keep | Distinct parallel-work orchestration skill. | Preserve. | Could help large review workflows. |
| `persona-manager` | NanthAI Product | Visible | Keep | Product-specific persona management skill. | Preserve. | None direct. |
| `persona` | PM/GTM | Visible | Keep | User/marketing persona generation is distinct from NanthAI persona management. | Preserve; keep summary wording distinct from `persona-manager`. | None direct. |
| `persistent-runtime` | Runtime | Visible | Keep | Durable runtime workflow is distinct from temporary workspace. | Preserve. | Useful for long-running M37/M38 artifacts. |
| `positioning-icp` | GTM | Visible | Keep | ICP and positioning strategy are distinct. | Preserve. | None direct. |
| `policy-review` | Legal/Documents | Visible | Keep | Policy review is distinct from contract review. | Preserve. | May reuse M37 review-card pattern. |
| `pptx` | Presentations | Visible | Keep | Narrow presentation format skill. | Preserve; ensure validators do not over-match browser/screenshot language. | None direct. |
| `prd` | PM | Visible | Keep | PRD output has clear trigger. | Preserve. | None direct. |
| `problem-statement` | PM | Visible | Keep | Problem-framing output is distinct from PRD. | Preserve. | None direct. |
| `process-documentation` | Ops/Documents | Visible | Keep | SOP/runbook/process workflow is distinct. | Preserve. | None direct. |
| `reconciliation` | Finance/Data | Visible | Keep | Transaction matching workflow is distinct. | Preserve. | M38 may reuse exception-grid patterns. |
| `release-notes` | PM/Product | Removed from seed | Consolidate | Release notes are a communication format, not a separate capability. | Remove standalone skill; preserve guidance in `internal-comms`. | None direct. |
| `retrospective` | PM/Productivity | Visible | Keep | Structured reflection workflow is distinct beyond developer/team retros. | Preserve with broader non-dev reflection wording. | None direct. |
| `scheduled-jobs` | NanthAI Product | Visible | Keep | Product-specific automation management skill. | Preserve. | None direct. |
| `ai-seo` | GTM | Visible | Keep | SEO strategy has clear trigger. | Preserve. | None direct. |
| `shareholder-agreement-summary` | Legal/Documents | Removed from seed | Template | Repeatable legal summary preset. | Remove standalone skill; preserve source behavior in `contract-review` and M38 template handoff. | Required M38 legal summary preset. |
| `slack` | Integration | Integration-managed | Keep | Narrow Slack integration path. | Preserve. | None direct. |
| `solo-founder-gtm` | GTM | Removed from seed | Consolidate | Resource-constrained GTM is useful but belongs under campaign/GTM planning. | Remove standalone skill; preserve guidance in `campaign-planning`. | None direct. |
| `sprint-planning` | PM | Visible | Keep | Sprint decomposition workflow is distinct. | Preserve. | None direct. |
| `sql-data-query` | Data/Analytics | Visible | Keep | SQL-over-uploaded-data workflow is distinct from pandas analysis. | Preserve. | Supports M38 table investigation. |
| `statistical-analysis` | Data/Analytics | Visible | Keep | Formal hypothesis testing is distinct. | Preserve. | Supports M38 analysis cases. |
| `testing-strategy` | Engineering | Visible | Keep | Test strategy workflow has clear trigger. | Preserve. | Supports M37/M38 test planning. |
| `user-stories` | PM | Visible | Keep | Story-writing output has clear trigger. | Preserve. | None direct. |
| `ux-copy` | Design/Product | Visible | Keep | UI copy audit/writing is distinct. | Preserve. | Supports M37/M38 copy polish. |
| `xlsx` | Spreadsheets | Visible | Keep | Narrow spreadsheet format skill with analytics support. | Preserve; align tabular-review trigger wording if needed. | Useful for M38 exports. |
| `nanthai-mobile-runtime` | Runtime Guard | Hidden | Keep | Hidden environment guard, not catalog-facing. | Preserve hidden; validators must not treat it as visible skill drift. | None direct. |

### Classification Values

- `Keep`: skill has a narrow, useful trigger and accurate tool/profile requirements.
- `Consolidate`: trigger competes with another skill and should route through one clearer entry point.
- `Archive`: skill is obsolete, unsafe, duplicated without value, or unsupported by current tools.
- `Split`: one skill handles materially different workflows that need different tool/profile rules.
- `Rename`: behavior is correct but summary/slug/name misleads selection.
- `Template`: workflow is mostly a repeatable checklist or column preset better represented as reusable guidance under a broader skill.

### Domain Grouping Checklist

- Documents and file formats: `documents`, `docx`, `pdf`, `xlsx`, `pptx`, document-generation workflows.
- Legal and review: contract review, redline/tracked-change candidates, citation review.
- GTM and marketing: ICP, positioning, outreach, SEO, launch, email, reporting.
- Product/PM: PRD, ADR, sprint planning, experiment design, user stories, release notes, retrospectives.
- Engineering/runtime: code workspace, persistent runtime, testing, incident response, subagents.
- Finance/data: reconciliation, statements, data analysis, SQL, dashboards, validation.
- Productivity/integrations: Gmail, calendars, Slack, Google Workspace, Microsoft 365, Notion, Cloze.

For each group, check whether summaries compete for the same user utterance. Prefer a single broad router only when it clearly points to narrower workflows; otherwise tighten the narrow skills and archive or template the overlap.

## Device Verification Needed

After the code/test pass, use device checks only to catch visual issues automation cannot prove:

- Android phone: chat list density, chat detail generated file/citation/status cards, composer controls, Knowledge Base list, settings rows, and skill picker.
- Android tablet: split-pane chat/list behavior, Knowledge Base and settings density, and picker drill-in behavior.
- iOS reference spot-check: chat/list/Knowledge Base/settings only if Android parity feels wrong and a reference comparison is needed.
- Performance: rerun the M34 Android macrobenchmark/profile checks on a physical device after the broader Android visual changes, or record the physical-device run as deferred if no device is available.
