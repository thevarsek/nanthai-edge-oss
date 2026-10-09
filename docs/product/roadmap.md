# Product direction

The product uses one Convex conversation and execution plane across web, iOS,
Android and the Mac Runtime Host. Codex/Pi extend where selected Persona work runs;
they do not replace shared context, authorization, artifacts or scheduling.

## Current integration

`codex/context-assembly-integration` merged into `main` through PR #120 on
5 October 2026. It contains the completed Codex bridge,
Codex/Pi multi-harness support, Mac setup and lifecycle work, shared-context
continuity repair, and saved-task/source-pill implementation. The accepted scope
was qualified on the owner's existing Mac and DEV. The production backend and
public Mac installer/download page were published on 5 October 2026 before main
integration. A new iOS or Android store release is not implied. The
[milestone index](../../milestones/README.md) owns exact status and qualification
limits.

## Release branch and future work

| Area | Direction | Scope owner |
|---|---|---|
| Teams and shared work | Persona Teams, durable work records and common progression | [Teams](../../milestones/M55-persona-teams-work-records.md) |
| External conversations | Telegram ingress/delivery with canonical conversation ownership; persistent compaction | [Telegram](../../milestones/M59-telegram-persona-conversations.md) |
| Voice | Request-scoped voice cloning with its own product scope | [Voice cloning](../../milestones/M51-voice-cloning.md) |
| Owned coding executor | Deferred; continue supported Codex/Pi execution | [Native harness](../../milestones/M57-native-coding-harness.md) |

M51, M55 and M59 are implemented and technically qualified on the combined
`codex/release-persona-capabilities` branch. Public-site capability source is updated.
This branch awaits owner review against main; production publication and native
store releases are separate. The owner confirmed voice likeness through listening on
October 6, 2026.

A full context inspector, general offline cloud replica and automatic native-history
import are not part of the delivered scope. Planned scopes do not themselves
approve new restrictions, confirmations, defaults or provider spending. Repository
approval rules continue to govern implementation changes.

OpenRouter Batch API integration is not planned. The documented bulk-processing
use cases do not establish a current NanthAI user journey worth a separate batch
submission and results workflow. Batch-only model variants remain excluded from
interactive pickers; this does not remove existing historical records.
