# Subagents

> Depth-1 delegated child runs for single-participant Pro chats.

## Summary

Subagents let a parent assistant delegate up to 3 focused tasks to child runs, wait for those runs asynchronously, and then resume into the same visible assistant message once every child reaches a terminal state.

This feature is:

- Pro-only
- disabled for multi-model chats
- disabled by default globally
- configurable per chat via `inherit` / `enabled` / `disabled`
- depth-limited to a single wave per parent message

## Product Behavior

### Availability

- `spawn_subagents` is only registered after a loaded skill unlocks the `subagents` profile
- the chat has exactly one participant
- the effective subagent setting is enabled
- the current user is Pro
- the selected model is tool-capable
- the current run is a parent run rather than a child run

If an older client or stale saved state still sends `subagentsEnabled` for a non-tool-capable model, the backend now downgrades that run to plain chat by stripping the flag instead of failing the request.

Child runs inherit the parent's participant config, model parameters, enabled integrations, and tool set, except that `spawn_subagents` is always removed from child tool access.

Subagents are always a chat-wide setting. Personas do not alter subagent availability; only the chat-level subagent override plus the global default participate in resolution.

### Parent message lifecycle

The UI keeps one parent assistant bubble throughout:

1. parent streams reasoning normally
2. if needed, parent loads a skill that unlocks the `subagents` profile
3. parent calls `spawn_subagents`
4. parent pauses cleanly and shows a delegated-work panel
5. child runs stream independently inside that panel
6. once all children are terminal, the parent resumes
7. the final synthesis continues in the same assistant message

No second assistant message is created for the resumed parent synthesis.

### Terminal-state rule

The parent resumes when every child is terminal, not only when every child succeeds.

Terminal child statuses:

- `completed`
- `failed`
- `cancelled`
- `timedOut`

Non-terminal child statuses:

- `queued`
- `streaming`
- `waiting_continuation`

This allows the parent to synthesize partial results instead of stalling indefinitely on one failed child.

## Backend Orchestration

### Parent pause/resume

`spawn_subagents` is implemented as an async-pausing tool:

1. the parent tool loop records the tool round
2. Convex creates a `subagentBatch` plus `subagentRuns`
3. the parent action exits without re-calling the model
4. each child runs independently
5. when all children are terminal, Convex schedules parent continuation
6. the parent continuation rebuilds the tool-call round and injects one synthetic tool result containing child summaries and statuses
7. a fresh OpenRouter request continues the parent workflow

This resumes orchestration state, not the original network stream.

### Long-running child runs

Child runs use the same compaction-aware generation loop as the main chat path.

If a child approaches the Convex action timeout:

1. the loop compacts to a safe continuation boundary
2. the run is persisted as `waiting_continuation`
3. the compacted conversation snapshot is stored on the child run
4. `continueSubagentRun` is scheduled immediately

This gives child runs cross-action continuation without trying to resume an in-flight OpenRouter stream.

### Continuation limits

Each child run has a bounded continuation count. If that limit is exceeded, the child is marked `timedOut` and still contributes a terminal result back to the parent.

## Persistence

### Chat-level controls

- `userPreferences.subagentsEnabledByDefault`
- `chats.subagentOverride`
- `messages.subagentsEnabled`
- `messages.subagentBatchId`

### Batch/run tables

- `subagentBatches`
  - parent message/job linkage
  - saved tool-call round metadata
  - saved parent conversation seed and params snapshot
  - child counters and batch status
- `subagentRuns`
  - child title and task prompt
  - live content and reasoning
  - tool metadata and generated files
  - continuation snapshot and continuation count
  - child terminal status and error state

## UI

The parent bubble renders a `SubagentBatchPanel` inline between tool metadata and final assistant content.

The panel shows:

- batch header status
- up to 3 child tabs/chips
- live child reasoning and content preview
- failure state per child when relevant

The `+` menu exposes a per-chat subagent override sheet only for single-participant chats. Its wording now explicitly calls out that personas do not affect the toggle so chat-wide override behavior stays consistent with other per-chat controls.

## Known Constraints

- Subagents are intentionally unavailable in multi-model chats to avoid multiplicative fan-out and UI noise.
- Child continuation only occurs at safe boundaries between model calls/tool rounds. A single long in-flight text stream cannot be resumed mid-token because OpenRouter does not support transport-level stream resume.
- One parent message may launch only one subagent wave.

---

*Last updated: 2026-03-31 — clarified tool-capability gating and silent backend downgrade for unsupported models.*
