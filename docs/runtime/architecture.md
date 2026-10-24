# Local runtime architecture

The Mac Runtime Host runs Codex and Pi workers for the same conversations used by
web, iOS and Android. Convex owns product state and durable execution. Native
sessions cache execution context; they are not canonical conversation history.
The integration branch contains the accepted development implementation. Release
status and qualification limits belong in the [milestone index](../../milestones/README.md).

## Ownership

| Concern | Owner |
|---|---|
| Chats, branches, Personas, source permissions and published results | Convex domain tables |
| Context selection and prepared turn | Shared chat context assembly |
| Speaker selection and causal waves | Convex Collaboration scheduler |
| Runs, attempts, leases, fences and cancellation | Convex execution control plane |
| Replayable effects and ambiguous outcomes | Operation journal and provider adapters |
| Native processes, transport spool and local saved tasks | Runtime Host |
| Inner model/tool loop and provider authentication | Selected Codex or Pi harness |
| Lifecycle and results displayed by clients | Canonical Convex projections |

The executable, Node supervisor, workers, packaging and Swift menu app live under
[`runtime-host/`](../../runtime-host/). Shared server functionality remains under
`convex/runtime_host/`; client controllers call the same product API. The Mac app
is a separate application from the iOS app running on macOS.

## Transport and workers

The host connects outbound to Convex using scoped, revocable device authority.
Codex uses its local stdio App Server; Pi uses RPC. A supervisor owns an isolated
worker/process tree for each active attempt. Provider credentials stay in the
native provider's supported storage; pairing does not copy them into Convex.

An idle host does not poll for work. After its presence heartbeat it asks
`/runtime-host/v1/realtime` for the deployment URL and subscribes over the Convex
WebSocket to `runtime_host/host_watch:pendingWork`. That query authenticates the
device credential and online presence like the HTTP routes, and returns only
pending command and model-discovery record IDs. When a list changes, the host
runs one HTTP poll and claim for that kind. Payloads, claims, fencing and
completion stay on the HTTP routes. Work that stays pending after a claim attempt
is retried with backoff up to 30 seconds. If the realtime endpoint is missing, the
URL is not HTTPS (except local development), or the subscription is disconnected
or failing, the host falls back to one-second polling until push is live again.
An idle host's remaining traffic is the 60-second presence heartbeat (an HTTP
route and its mutation) and one re-run of the watch query per heartbeat, about
three billed calls a minute. The presence lease is 150 seconds, tolerating one
missed beat. Expiry is not scheduled per heartbeat: a one-minute
`expireStaleRuntimePresences` cron marks lapsed leases offline for all hosts,
while authentication already rejects an expired lease on its own.

`PreparedParticipantTurn` is the semantic preparation result. Local dispatch
serializes it through the strict runtime packet with run/attempt/fence identity,
stable participant IDs, ordered typed content, instructions, source references,
capabilities, commands and integrity metadata. Cloud inference uses the prepared
turn directly. Large content uses authorized fetch handles, length and hash
checks, then local materialization. Required unsupported input fails explicitly.

The process contract is `nanthai.runtime.process.v1`; executor-neutral schema
ownership remains with `nanthai.runtime.v1`. Capability advertisements reflect
implemented adapter behavior. A representable capability is not automatically
available. Version compatibility is checked against the selected executable.

## Sessions and context

A native session belongs to a stable room participant and compatible effective
route. Two participants do not share it just because they use the same Persona
name or model. The canonical delivered frontier is tracked separately from real
native session/turn IDs. Acknowledged fenced boundaries advance that frontier.

New logical turns resolve current Persona instructions and route. Active turns
and durable replay keep their captured execution configuration. Reuse requires
compatible route, instructions, branch, visibility and context policy. When the
native API cannot safely replace context, the adapter rebuilds the session.
Unrelated native-client advancement is not silently imported into the chat.

Thread names are display provenance. Selected and actual models remain distinct;
unknown actual model stays unknown. Context selection, source excerpts and native
continuity are covered in [context assembly](../architecture/context-assembly.md).

## Lifecycle and publication

Cancellation closes the writer fence before remote acknowledgement, then tears
down owned descendants. A sent stop request alone does not prove process exit.
The bounded spool supports transport replay, acknowledgement and ordered events;
it does not own an independent cloud conversation or execution state machine.

Streaming deltas use the content overlay. Coarse run events contain bounded
lifecycle data, not raw native transcripts or binary output. Publication uses the
existing artifact and usage owners. Consequential effects are journaled before
dispatch; ambiguous external writes are reconciled instead of blindly resent.

Native children belong to their adapter attempt. NanthAI delegated children have
separate durable run ownership. Usage, approvals and origin remain attributable,
without counting native descendants twice. A working directory is provenance;
process ownership does not imply a filesystem sandbox. Native approvals and OS
denials remain authoritative.

## Helpers and route availability

With OpenRouter connected, shared cloud helpers retain their configured routes.
Without it, supported Codex title/memory helpers run as isolated Workflow-owned
native attempts. Pi helper work retains its supported source route/model. Helpers
do not share the public Persona's native thread. Memory storage and retrieval
remain common across runtimes.

Embeddings use the shared 1536-dimensional model. The platform key is an
absence-only fallback when the user's OpenRouter key is unavailable; it does not
change privacy rules or supply every other cloud capability. Native Codex Basic
search is supported. Pi has no certified NanthAI Basic-search binding; its own
configured tools do not imply that capability. Research/media/integrations keep
their advertised provider requirements.

See [setup](setup.md), [Persona routing](personas.md), [saved tasks](saved-tasks.md),
[operations](operations.md) and [Collaboration](collaboration.md).

## Source map

| Surface | Starting point |
|---|---|
| Persona and effective route | `convex/runtime_host/persona_routes.ts`, `route_resolution.ts` |
| Shared preparation | `convex/chat/actions_context_assembly_integration.ts`, `prepared_participant_turn.ts` |
| Packet and typed input | `convex/runtime_host/production_packet.ts`, `protocol_packet.ts` |
| Native frontiers | `convex/runtime_host/conversation_bindings.ts` |
| Streaming and publication | `convex/runtime_host/chat_event_ingestion.ts`, `chat_terminal_ingestion.ts` |
| Host ownership | `runtime-host/src/runtime_host.ts`, `session_supervisor.ts` |
| Adapter discovery | `runtime-host/src/adapter_registry.ts` |

The [execution control plane](../architecture/execution-control-plane.md) and
[workload authoring rules](../architecture/durable-workload-authoring.md) also
apply to local execution.
