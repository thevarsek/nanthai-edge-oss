# Shared interface semantics

Native clients follow platform interaction conventions while using the same
backend state and vocabulary. iOS informs compact mobile presentation; web informs
large-screen density. Android retains its native Compose ownership and performance
behavior. Visual consistency does not justify a new product restriction.

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

### Document-workspace handoff rules

> **M40 closeout (2026-07-18):** The proposed editable review workspace was
> descoped. M40 is backend-only and uses ordinary chat plus the existing XLSX
> generated-file card, so the workspace-specific rules below are retained only
> as historical audit context and are not an implementation checklist.

- M39 tracked-change cards should reuse the review-card contract rather than inventing a second accept/reject card language. The backend edit status remains the source of truth; UI cards and review workspace surfaces only render that state.
- M39 document preview sidebars may defer perfect highlight positioning in v1, but source/edit cards must still show document metadata, concise reason text, and current accept/reject status with semantic tokens.
- Historical workspace guidance: a future review-grid UI should reuse compact editable cells and citation/source cards rather than create another visual language.


## Verification

Use focused projection/owner tests for shared state and matching platform smoke
coverage for changed controls. Generated artifacts, sources and pending/error states
must preserve the same meaning across clients. Temporary visual captures belong
outside repository documentation. See [testing](../development/testing-strategy.md).
