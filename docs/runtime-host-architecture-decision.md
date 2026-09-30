# Runtime Host architecture and execution boundaries

> Architecture baseline: 2026-09-09; implementation status reconciled 2026-09-30. Scope: M45 preview and successor release seams. See the [current delivery roadmap](runtime-roadmap.md).
> Implementation status: September branch work records current-Persona resolution, canonical catch-up, receipts/frontier checks, result bridge and activation as implemented. Connected personal-Mac/clean-machine and supported release gates remain unverified. See [dated handoff](runtime-host-local-work-2026-09-11.md); this document is not a new deployment or fresh test result.
> Historical source: [August transport evidence](runtime-host-transport-evidence-2026-08.md). Retain the selected local-stdio Codex App Server transport unless new acceptance-critical evidence justifies reconsideration.

## Decision

Keep one Convex-owned connected conversation and execution plane. The Runtime Host is a small process supervisor for supported workers. Its operator CLI and eventual terminal/tray interfaces belong to one installed NanthAI package; they are not separate agent backends.

The common contract must support an external Codex/Pi worker and, later if justified, a NanthAI-native worker. It does not pretend their internal prompts, tools, authentication or continuation state are identical. Interoperability is explicit capability negotiation plus canonical task/context/results, not forced lowest-common-denominator behavior.

## Ownership map

| Concern | Owner | Must not become |
|---|---|---|
| Human intent, public messages/branches, Persona defaults | Existing Convex product domains | A second transcript in the host spool |
| Authorized context and prepared turn | Shared cloud context owners today; extracted policy/source seam in M56 | Adapter-selected replacement of canonical conversation truth |
| Which participant acts | M50 Collaboration; work-aware successor in M55 | Runtime Host or native-harness speaker scheduler |
| Logical run, attempt, lease/fence and terminal state | `convex/execution/*` | A parallel remote-run state machine |
| Tool effects, unknown outcomes and reconciliation | Existing operation journal and provider adapters | Claimed exactly-once delivery across arbitrary external services |
| Files/evidence/usage | Existing artifacts/storage and `usageRecords` | Binary/raw transcript payloads in `runEvents` |
| Local process trees and bounded wire queues | Runtime Host | A heap shared with untrusted extensions and every model session |
| Inner agent loop | Selected Codex/Pi harness or future native worker | An inference API entitlement inferred from a subscription token |
| UI status/content | Existing canonical projections plus streaming overlay | Client-owned progression or duplicate task creation |

Read [execution-control-plane.md](execution-control-plane.md) and [durable-workload-authoring.md](durable-workload-authoring.md) before changing lifecycle behavior. M48 removed the former continuation engine; do not recreate it under a runtime abstraction. Keep latency-sensitive V8 actions separate from narrow Node-only tool actions.

## Interfaces, routes and state

The terminal, web and mobile interfaces may observe/control the same room. Opening a new interface attaches to existing state rather than creating another generation. A user may choose a cloud participant from the terminal or a local participant from Edge.

Cloud native execution initially uses OpenRouter. Local external execution uses the configured harness/provider. Conditional M57 local native execution uses the common context behavior and supported provider adapters. Connected state stays in Convex in all three cases. Local execution does not imply local inference or fully local data.

The host connects outbound to Convex. Pairing grants scoped revocable device authority, not provider-account credentials. Native subscription authentication remains in supported provider storage. Public context publication and local file access are separate permissions; a file read on a machine is not automatically uploaded to the room.

## M59 external conversations and compaction

[M59](../milestones/M59-telegram-persona-conversations.md) adds Telegram as a verified ingress/delivery interface after the proposed M45/M53/M54 qualification and productization block. It routes through canonical conversation admission and the selected executor; the host never receives Telegram credentials or owns channel scheduling. Native approvals/input remain with the existing authenticated controller in v1.

The [compaction audit and contract](conversation-compaction.md) distinguishes current tool-loop recovery from planned persistent cross-turn summary-plus-tail preparation. Changed canonical summary identity/coverage must participate in native compatibility checks; use the existing fresh-session path when context replacement cannot be proved. Unchanged summaries retain the receipt/delta path. Private Codex compaction never advances a NanthAI coverage cursor. This contract is M59 work, not a claim that branch code already persists conversation summaries.

## Persona and turn resolution

The participant has a stable ID and a Persona reference. For a new logical turn, load the latest accessible Persona, apply a compatible explicit chat override, validate route/capabilities, and record the effective execution configuration before dispatch. No long-lived chat configuration snapshot or manual refresh UX remains in the target design.

An in-flight turn and its durable continuation/replay retain their effective configuration; a new workflow action is not a new human turn. New explicit retries/turns resolve current defaults. Revocation, lost source access or deleted authorization is enforced immediately. Historical configuration is evidence only and cannot silently authorize future work.

The September implementation record retires persistent chat-route snapshot writers and captures effective configuration for active turns/replay. Connected release verification remains M45.7/45.17 work. Preserve stable participant IDs and historical result attribution; do not simply replace every field named snapshot, since causal/execution evidence may still require immutable records.

## Prepared turn and wire contract

Use `PreparedParticipantTurn` as the cloud-side preparation result and the existing strict `RuntimeTurnPacket` for local transport. The cloud need not serialize through a process packet just to make a provider request. Keep one semantic source of instructions, context, capabilities and causal provenance rather than two independent assemblers.

Packets carry run/attempt/fence and stable participant IDs, ordered role-aware typed content, supported instruction/capability declarations, source/artifact references, omissions, route intent, command identity and integrity metadata. Large bytes use authorized expiring fetch handles, bounded chunks, byte length and hash validation. Unsupported required parts fail explicitly; optional speaker eligibility may exclude an incompatible executor with a reason.

The established process boundary is `nanthai.runtime.process.v1`, with the executor-neutral `nanthai.runtime.v1` contract recorded in the source schemas. Version/schema compatibility must be checked against the executable actually used. Upstream latest documentation is not a substitute for this check. Evolve schemas deliberately and update fixtures/callers together.

Do not announce native NanthAI, Pi, Copilot, a tool bridge or a modality because the contract can represent it. Capability advertising follows real implementations and tests.

## Native-session continuity

A native thread is a cache attached to stable room participant identity and compatible effective route, not canonical chat memory. Separate participants never share private native sessions, even with identical Persona names/models.

Track the canonical frontier actually delivered separately from real native turn/session IDs. Commit cursor progress only at acknowledged fenced boundaries. A skipped participant catches up with authorized peer/human messages and published evidence; retry cannot skip an undelivered delta or inject it twice.

Before reuse, validate route, current instructions/capabilities, branch, privacy and context policy. If the native API cannot safely replace old instructions or remove disallowed context, visibly rebuild on the selected route. A shorter supplied prompt does not erase a thread's old history. Detect external advancement and do not silently merge an unrelated Codex-client turn into NanthAI.

Thread names `<Persona> · <chat title>` are display provenance. They can change without identity change. Unknown actual model remains unknown even when the selected model is known. Native rerouting is reported rather than rewritten into the user's historical selection.

## Execution safety

One active execution attempt owns its worker/process tree and fence. Preserve existing idempotent commands, bounded spooling, acknowledgment and event ordering. Cancellation closes the writer fence before remote acknowledgment, then tears down owned descendants. Do not claim the process stopped merely because a request was sent.

Normal stream deltas use the content overlay path; coarse run events contain bounded lifecycle summaries. High-volume stdout, raw native transcripts, credentials and binaries are not run events. Valid native warnings are diagnostics rather than automatic failed turns. Unknown/malformed consequential protocol behavior requires explicit compatibility handling and meaningful failures.

Journal consequential effects before dispatch. Replay committed results; refuse blind resend when an external write might already have happened. Process restart is not proof of side-effect rollback. The host spool supports transport recovery; it is not an offline conversation database.

Current machine-level access policy remains explicit. The cwd is provenance, not a silently introduced mandatory folder grant. Native approvals and OS denials remain authoritative. M55 may introduce an explicit Team workspace/read-only policy, but must enforce it and must not describe advisory file leases or worktrees as a security sandbox.

Native children belong to their parent adapter attempt and stay backstage. NanthAI `spawn_subagents` children have separate durable child-run semantics. Keep origin/usage/approval attribution separate; do not double count descendants or expose per-child controls without supported evidence.

## Current code paths to inspect first

| Change | Starting owners |
|---|---|
| Persona/current route | `convex/runtime_host/persona_routes.ts`, `chat_routes.ts`, `route_resolution.ts`, `convex/participants/*` |
| Canonical preparation | `convex/chat/actions_context_assembly_integration.ts`, `prepared_participant_turn.ts`, `convex/runtime_host/chat_dispatch_context.ts` |
| Packet/materialization | `convex/runtime_host/production_packet.ts`, `production_packet_content.ts`, `protocol_packet.ts` |
| Native binding/cursors | `convex/runtime_host/conversation_bindings.ts`, host Codex request/context/thread owners |
| Streaming/publication | `convex/runtime_host/chat_event_ingestion.ts`, `chat_terminal_ingestion.ts`, existing artifact/usage writers |
| Host/process ownership | `runtime-host/src/runtime_host.ts`, `session_supervisor.ts`, process/wire/queue owners |
| Contrasting adapter | `runtime-host/src/adapter_registry.ts` and current protocol capability/event definitions |
| Team progression | `convex/collaboration/*`; current Autonomous loop stays until M55 parity/drain |

These are branch starting points, not a promise of unchanged filenames. Trace exact callers before editing; do not reproduce an owner under a new directory to avoid understanding the existing one.

## Release seams and later options

M45 ships the Codex preview, minimum installer/activation and safe results. M53 ships Pi/multi-harness and records the context/code-intelligence screen. M54 closes product breadth, native controls, schedules, external MCP, accounting and full resource soaks. M55 adds work records and a common Team progression path. M56/M57/M58 are conditional feature releases, not required abstractions now.

M56 can extract pure policy/types plus a small preparation coordinator, while Convex remains the I/O/durability adapter. M58 can add a local store without copying that algorithm. A Convex Component may be considered after real reuse requirements, not as a prerequisite to a CLI.

## Revisit triggers

| Decision | Revisit only when |
|---|---|
| Codex local stdio App Server | A pinned supported version cannot meet an acceptance-critical behavior or an upstream contract changes |
| Node supervisor | Measured process/packaging/resource evidence warrants a native owner; do not rewrite workers unnecessarily |
| Current-Persona native thread reuse | Tests show instructions/visibility cannot be updated safely; use explicit reset rather than stale behavior |
| Code-context source | M53 task/language/freshness/license evidence favors another source |
| Native loop investment | A bounded hypothesis offers user value not supplied by best external execution |
| Offline durability | Demand and a supported executor justify safe local branching/reconciliation |

See [research register](runtime-research.md) for current source links and cautions, [experiment policy](runtime-experiment-policy.md) for removal gates, and [M45](../milestones/M45-hybrid-long-running-agent-runtime.md) for the concrete resume order. Retained historical documents are evidence, not competing release requirements.
