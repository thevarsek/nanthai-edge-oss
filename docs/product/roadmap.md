# Product direction

The product uses one Convex conversation and execution plane across web, iOS,
Android and the Mac Runtime Host. Codex/Pi extend where selected Persona work runs;
they do not replace shared context, authorization, artifacts or scheduling.

## Current integration

`codex/context-assembly-integration` contains the completed Codex bridge,
Codex/Pi multi-harness support, Mac setup and lifecycle work, shared-context
continuity repair, and saved-task/source-pill implementation. The accepted scope
was qualified on the owner's existing Mac and DEV. It remains under review against
`main`; integration completion does not imply a production deploy, public installer
or store release. The [milestone index](../../milestones/README.md) owns exact status
and qualification limits.

## Planned work

| Area | Direction | Scope owner |
|---|---|---|
| Teams and shared work | Persona Teams, durable work records and common progression | [Teams](../../milestones/M55-persona-teams-work-records.md) |
| External conversations | Telegram ingress/delivery with canonical conversation ownership; persistent compaction | [Telegram](../../milestones/M59-telegram-persona-conversations.md) |
| Voice | Request-scoped voice cloning with its own product scope | [Voice cloning](../../milestones/M51-voice-cloning.md) |
| Owned coding executor | Deferred; continue supported Codex/Pi execution | [Native harness](../../milestones/M57-native-coding-harness.md) |

A full context inspector, general offline cloud replica and automatic native-history
import are not part of the delivered scope. Planned scopes do not themselves
approve new restrictions, confirmations, defaults or provider spending. Repository
approval rules continue to govern implementation changes.
