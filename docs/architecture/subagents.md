# Delegated subagents

## Product behavior

A parent assistant can delegate one to three focused tasks through `spawn_subagents`
and later synthesize terminal child results into the same visible assistant message.
The tool is exposed through the progressive subagent profile and existing backend
capability/entitlement checks. Availability is chat-wide rather than Persona-owned.
Child tools exclude `spawn_subagents`, preserving the existing depth boundary.

The parent records its tool round and displays delegated work while children stream.
It resumes when every child is terminal, including failed or cancelled children;
partial results remain available. Resume does not create a second assistant bubble
or resume the original network stream mid-token.

## Durable ownership

`subagentBatches` and `subagentRuns` own product linkage, child results and parent
resume data. Each child has a fenced child execution run and Workflow-owned rounds.
Bounded Workflow journals chain successors; their chunk size is not a product
conversation/tool-round quota. There is no scheduled-action continuation engine.

The parent persists its checkpoint and durable completion event before child work
starts. Terminal child publication and the batch join signal that event exactly
once. The parent reconstructs the tool result and continues through its existing
Workflow. Cancellation uses centralized run-tree teardown and closes writer fences.

The deferred tool remains available in V8-safe coordination without activating
Node merely because it could be called. Node-required work crosses its explicit
action boundary. See [workload authoring](durable-workload-authoring.md).

## Context and UI

Children inherit the dispatched participant/model/settings and allowed integrations,
with private child context and explicit parent-result promotion. Shared context
assembly preserves ownership, source provenance and branch visibility.
The delegated-work panel shows child progress, output and failures; chat-wide
controls use canonical backend state.

NanthAI delegated children and Codex/Pi native children have different owners.
Native children belong to their adapter attempt and do not become independent
NanthAI subagent runs or duplicate usage records.

See [execution ownership](execution-control-plane.md),
[context assembly](context-assembly.md) and
[tool access](../product/tool-skill-access.md).
