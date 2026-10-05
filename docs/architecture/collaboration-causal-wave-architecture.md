# Collaboration causal-wave architecture

> Cloud Collaboration is released; accepted Codex/Pi hybrid behavior is integrated in DEV.
> Future Team/work-record behavior belongs to [M55](../../milestones/M55-persona-teams-work-records.md), not a second concurrent scheduler.

## Ownership

Collaboration is a per-chat behavior above existing participant execution. Convex owns speaker selection, committed context, durability, cancellation and client truth. A selected speaker uses the normal cloud executor or an explicitly supported local Runtime Host route as those releases complete.

| Concern | Canonical owner |
|---|---|
| Saved Parallel/Collaboration preference | `chats.groupBehavior` |
| Exchange bounds and lifecycle | `collaborationExchanges` |
| Stable frontier and 0/1/N decision | `collaborationDecisions` |
| Published replies/causal provenance | Normal `messages` rows |
| Participant work | Existing generation runs and fenced attempts |
| Wave loop | Convex Workflow |
| UI state | Authenticated Collaboration/execution projections |
| Local/cloud placement | Resolved execution attempt; Runtime Host executes, not schedules |

The Workflow/component log is operational evidence, not the product transcript or work database. Keep the V8/Node execution boundary established in durable workload authoring.

## Causal waves

Each wave reads one committed frontier. Participants selected together may run concurrently, but cannot have seen their peers' unfinished answers. After their attempts settle, the next decision sees successful committed replies and human input queued for that safe boundary.

A frontier containing unanswered human input requires at least one eligible response. Afterwards zero speakers is valid convergence. Invalid provider output, unsupported required participants and unavailable routes are failures or explicit terminal conditions, not silent success.

The bounds are five causal waves, eight public participant messages and fifteen
minutes per exchange. The owner approved the fifteen-minute limit on 5 October
2026 for this integration; production retains its released behavior until deployment.
Each wave, scheduler model call, decision helper and native input/permission wait
uses the remaining persisted exchange deadline. Unfinished work times out and
uses normal fenced run-tree teardown; completed replies and partial text remain
in the transcript. The exchange reports “Collaboration timed out.” A later wave
does not reset the budget. A native question's fifteen-minute or Never
preference does not extend the Collaboration exchange deadline. Standalone native
turns keep their existing question behavior. A bound is distinct from convergence.

## Scheduler contract

Apply deterministic eligibility before a bounded structured model decision. Inputs are public room participants, relevant role metadata, mentions, committed frontier, recent speaker/failure state and remaining bounds. Outputs contain eligible participant IDs, reply targets and diagnostic reason codes.

Validate before dispatch against run fence, frontier, participant membership and allowed bounds. Persist decisions idempotently. Raw scheduler output and hidden reasoning are not user messages. A malformed response produces an actionable failure/retry state, not a synthetic participant answer.

Mentions constrain the first wave. Later relevant public participants may react. Advisors, private subagents, tools and models outside the room are never automatically promoted to speakers. Their useful results enter through their public owner's deliberate output.

## Human input, cancellation and failure

Queue follow-up joins the next safe boundary. Send now and Stop interrupt through the existing fenced run tree. Active attempts retain their input frontier; they are not silently rewritten by new text.

A failed participant does not erase successful replies. Exclude repeated automatic reselection where failure is unchanged. If no eligible response can be obtained, fail visibly. The composer owns the common Stop control; activity panels show wave/waiting/queued/terminal state without creating contradictory lifecycle truth.

Collaboration and current Autonomous Discussion cannot own progression simultaneously. M55 will replace old progression only after parity and drain; until then preserve current mode transitions.

## Persona semantics

Stable participant identity and immutable wave/attempt records are necessary for causality. Persistent frozen Persona defaults are not. For current execution, new logical turns resolve the current Persona, with explicit compatible overrides. Replay/continuation retains the effective dispatched configuration. Revocation is immediate.

Historical messages retain attribution without forcing old settings onto new turns.
Current-Persona resolution and native-session compatibility are implemented and
qualified in the accepted DEV scope.

## Private helpers and context

Parallel/Collaboration use the existing chat-wide helper capability through the normal tool/deferred checkpoint path. Autonomous Discussion currently uses a direct streaming progression path and cannot simply expose `spawn_subagents` without the corresponding durable wait/resume behavior. M55 owns that parity work, with independent fixes allowed earlier.

`PreparedParticipantTurn` carries provider messages, policy/assembler identity, artifact/memory references, omission information and causal/reply provenance. Local packet materialization derives from that result. No adapter invents a different public history or makes the model fetch its ordinary context through MCP.

Local source paths, private native transcripts and hidden reasoning do not become room context by default. Capability preflight must be truthful for required parts. A shared database is not proof that an executor actually received the current frontier; acknowledgments and cursor tests remain necessary.

## Release map and future change

- [Codex bridge](../../milestones/M45-hybrid-long-running-agent-runtime.md): complete accepted DEV scope.
- [Multi-harness runtime](../../milestones/M53-multi-harness-runtime.md): complete accepted DEV scope.
- [Runtime productization](../../milestones/M54-runtime-host-productization.md): complete accepted DEV scope; public release remains separate.
- M55: work records, requirement/review revisions, event/dependency-driven team progression and eventual Autonomous retirement.

M55 may let independent long tasks advance without waiting for an unrelated slow participant, while retaining explicit context versions. That is a deliberate future behavior change, not a claim about today's whole-wave barrier.

See [M50](../../milestones/M50-collaborative-multi-participant-chat.md), [runtime roadmap](../product/roadmap.md), [execution control plane](execution-control-plane.md) and [experiment policy](../development/runtime-experiment-policy.md).
