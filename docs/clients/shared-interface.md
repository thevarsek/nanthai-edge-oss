# Shared interface semantics

Native clients follow platform interaction conventions while using the same
backend state and vocabulary. iOS informs compact mobile presentation; web informs
large-screen density. Android retains its native Compose ownership and performance
behavior. Visual consistency does not justify a new product restriction.

## iOS adaptive navigation and controls

Compact windows use a native navigation stack with the selected chat as its path.
Back and edge-swipe clear that selection; expanded windows use a list/detail split
view. The workspace retains the active chat model across width changes so draft,
attachment and optional voice-reference state survive folding. Leaving the chat
releases that active session. Android and web retain their existing navigation;
this adaptation changes no shared Convex behavior.

With the iOS 27.1 SDK, the system's vertical-toolbar environment moves the composer
context menu into the native side rail in both compact and expanded layouts.
On Duo's expanded layout, the sidebar toggle and New Chat stay visible, while
Settings, Search and Filter share an overflow menu in the leading workspace
toolbar, separate from web search and Ideascape. The
sidebar toggle keeps its position when the list is hidden. Settings uses the
existing full workspace screen, with Done returning to the preserved conversation.
The collapsed chat list keeps New Chat and Settings visible and puts search/filter
in its native bottom toolbar. Search expands into a focused, opaque-backed field
with a matching close control.
The workspace and list share presentation state and filter actions.
Native toolbar placement and overflow remain system-managed.

Other iPhones and iPads retain the existing composer and list controls. New SDK
symbols are guarded by the SwiftUI module version at compilation and by iOS
availability at runtime. Xcode 26.6 and 27 use the existing controls; the iOS 27.1
SDK enables vertical-toolbar adaptation. Swift 6.4 alone does not identify that SDK.
Simulator checks cover navigation, width changes and voice controls; hardware Duo
reachability still requires validation on the device.

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

## Conversation capabilities and provider dependencies

Connected AI clients has its own Settings section immediately after AI connections
on web, iOS and Android. Its navigation row uses a link icon and opens the existing
client connection management page, using the platform’s standard settings header,
back navigation, grouped client capabilities and revoke action. All three show the same setup instructions, selectable deployment-specific MCP URL, access policy and empty-state message; setup remains available when clients are connected.

Telegram is an AI connections row that opens a dedicated setup/connection screen on web,
iOS and Android. All clients use `channels/linking:status`, `begin`, `confirm`,
`selectConversation`, `disconnect` and the same recovery mutations. The shared status
includes connection state, current conversation and participant names. Existing chats
retain their roster; a starter Persona is optional for new chats.
The picker is an unsaved draft. Connect this conversation and Create and connect are
distinct actions; the connection action acknowledges the adjacent future-reply notice,
without a mandatory checkbox on any client.

Request-specific voice cloning is an explicit action in the composer + menu, labelled
“Clone a voice” in the user's language. The model, recording/file selection, transcript
and request consent controls live in the existing modal sheet/drawer pattern. Closing
the sheet preserves the draft and leaves only a compact reopen action in the composer;
ordinary chat has no persistent setup form. Recording controls stay inside the setup
flow, including Use recording and cancellation.

All three clients use the same field order: model, reference recordings and their
optional transcripts, then request permission. Import and recording are separate
action rows; selected recordings and permission use checkmark/checkbox selection
controls rather than persistent-setting switches. Transcripts retain a visible label
after entry. Native sheet chrome and control appearance remain platform-specific.
Visual comparisons use matching model, attachment, selection, transcript and permission
states, with the keyboard dismissed.

Collaboration work and execution limits belong in Conversation mode alongside the mode
choice. They do not occupy the chat transcript/footer. Work remains optional and accepts
general objectives, ownership, reviewers and dependencies. Writer/reviewer examples do
not define the only workflow. Causal continuations with redundant ancestor parents are
not alternate branches; actual sibling alternatives retain branch navigation.
Android's mode sheet retains its current partial or expanded height when the mode
selection changes. The user can drag to expand it; its content scrolls beneath the
fixed title. The selected mode uses native radio semantics, and Goals and limits opens
through a settings row. Parallel and Collaboration previews still require Use this mode
to apply them; Autonomous Discussion retains its separate start action.

Optional `audioReplyNotice` and `inputProcessingNotice` fields convey shared provider or
preparation state without replacing committed content. Clients localize known notice
codes and tolerate nullable/future fields. Automatic audio follows the same app/chat
settings through Telegram and NanthAI; missing OpenRouter does not invalidate a local
text reply.

iOS configures its media audio category at launch so inline audio/video, voice previews
and response speech remain audible in Silent Mode. Launch does not activate the audio
session; activation remains with playback. Recording retains its input-capable session.
