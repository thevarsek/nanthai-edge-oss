# Context assembly and supporting sources

## Canonical preparation

Cloud and local turns share Convex-owned selection of authorized conversation,
branch, memory and artifact context. `actions_context_assembly_integration.ts`
feeds the assembler and produces `PreparedParticipantTurn`. The local dispatcher
translates that semantic result into a runtime packet; adapters do not replace it
with an independently selected conversation.

Selection includes relevant current-task branch ancestors. This preserves public
facts needed by later turns and fresh executors rather than relying on a native
session to remember context that was never delivered. The branch-lineage rules
still exclude unrelated sibling context. Shared memory scope, access and source
provenance are applied before dispatch.
Selected shared-memory IDs and text travel with both cloud and local preparation,
so supporting-source quotes can be validated against the memory actually delivered.
Forks and duplicates remap copied participant and Retry identities to the new roster.
Provider-required role consolidation preserves each contributing message's source
identity and text; citations remain tied to the original messages.

## Durable tools and artifacts

Tool artifacts retain compact summaries and provenance with storage-backed raw
results when needed. Exact-result requests can rehydrate the authorized stored
artifact rather than treating the compact memory as a verbatim source. Context
assembly tracks selection, omissions, rehydration and timing in its diagnostics.
Large runtime content uses authorized fetch handles and integrity checks.
Selected generated images use their existing owned publication and storage metadata
for local fetch grants, alongside uploaded images, so a local follow-up can receive
the exact image produced by an earlier cloud turn.

Public artifact publication is explicit. Reading a local file does not publish it
to the chat automatically. Native private transcripts are not a second shared
source of truth.

## Native-session reuse

Native sessions are caches. Stable participant identity, route, current
instructions, branch, visibility and context policy determine compatibility.
Acknowledged canonical frontiers determine deltas. Rebuild when old context cannot
be safely replaced; sending a shorter prompt does not erase a native history.
External native-client advancement must not silently become a shared turn.
Growing supporting-source inventories are per-turn metadata and do not invalidate
an otherwise compatible session. Prior canonical message edits or removals, and
changes to actual Persona, memory or tool instructions, still require rebuilding.

The currently delivered source snapshot and the model's private internal context
are different observability boundaries. Supporting-source pills display validated
quotes from provided earlier messages/shared memories. They do not prove which
internal reasoning used them. Missing excerpts are not invented from tool activity.
There is no shipped full context inspector or handoff-preview screen.

## Compaction boundary

Tool-loop compaction and native harness compaction do not establish a persistent
canonical cross-turn summary. See [conversation compaction](conversation-compaction.md)
for current behavior and the separate planned work.

## Verification

Selection/replay tests cover branch ancestry, exclusions, artifact rehydration and
prepared-turn contracts. Runtime tests cover packet translation, native continuity,
input/permission handling and saved-result import. Client tests cover live-shaped
source decoding and rendering. The [evaluation method](../development/context-evaluation.md)
separates deterministic correctness from whole-task model comparisons; historical
outcomes belong in the [milestone](../../milestones/M56-context-engine-handoffs.md).
