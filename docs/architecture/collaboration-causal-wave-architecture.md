# Collaboration causal-wave architecture

> Cloud Collaboration is released; accepted Codex/Pi hybrid behavior is integrated in DEV.
> Optional Team work records and event progression are implemented in DEV under [M55](../../milestones/M55-persona-teams-work-records.md).

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

Each wave reads one committed frontier. Participants selected together may run concurrently, but cannot have seen their peers' unfinished answers. Ordinary discussion waits for that wave’s committed replies. With work records, independent eligible work advances after its own required inputs commit; unrelated slow work remains active and cannot satisfy a dependency. A completed job with a still-streaming message is not committed evidence. Work changes and completion signal the owned Workflow event instead of polling.

A frontier containing unanswered human input requires at least one eligible response. Afterwards zero speakers is valid convergence. Invalid provider output, unsupported required participants and unavailable routes are failures or explicit terminal conditions, not silent success.

Ordinary bounds are five causal waves, eight public participant messages and fifteen
minutes per exchange. Optional work settings are editable, with a sixty-minute,
fifty-wave and fifty-reply preset. Consensus auto-stop defaults off; zero substantive
speakers and completed work criteria still stop progression. The owner approved the fifteen-minute limit on 5 October
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

Collaboration and Autonomous Discussion cannot own progression simultaneously. Both use the common conversation Workflow driver with explicit policies. Existing Autonomous API/record names preserve saved controls and history; the duplicated progression loop is removed. DEV has no active legacy sessions. Production deployment/drain remains outside feature-branch qualification.

## Persona semantics

Stable participant identity and immutable wave/attempt records are necessary for causality. Persistent frozen Persona defaults are not. For current execution, new logical turns resolve the current Persona, with explicit compatible overrides. Replay/continuation retains the effective dispatched configuration. Revocation is immediate.

Historical messages retain attribution without forcing old settings onto new turns.
Current-Persona resolution and native-session compatibility are implemented and
qualified in the accepted DEV scope.

## Private helpers and context

Parallel/Collaboration use the existing chat-wide helper capability through the normal tool/deferred checkpoint path. Autonomous Discussion now dispatches through the same owned participant generation and deferred wait/resume path, preserving discussion pause/resume, moderator, human intervention and optional consensus controls.

`PreparedParticipantTurn` carries provider messages, policy/assembler identity, artifact/memory references, omission information and causal/reply provenance. Local packet materialization derives from that result. No adapter invents a different public history or makes the model fetch its ordinary context through MCP.

Local source paths, private native transcripts and hidden reasoning do not become room context by default. Capability preflight must be truthful for required parts. A shared database is not proof that an executor actually received the current frontier; acknowledgments and cursor tests remain necessary.

## Release map and future change

- [Codex bridge](../../milestones/M45-hybrid-long-running-agent-runtime.md): complete accepted DEV scope.
- [Multi-harness runtime](../../milestones/M53-multi-harness-runtime.md): complete accepted DEV scope.
- [Runtime productization](../../milestones/M54-runtime-host-productization.md): complete accepted DEV scope; public release remains separate.
- M55: work records, requirement/review revisions, event/dependency-driven team progression and eventual Autonomous retirement.

Goal execution advances independent ready work while retaining required slow work and explicit context versions. Ordinary discussion retains its committed-wave barrier.

See [M50](../../milestones/M50-collaborative-multi-participant-chat.md), [runtime roadmap](../product/roadmap.md), [execution control plane](execution-control-plane.md) and [experiment policy](../development/runtime-experiment-policy.md).

## Optional shared work

Work records, immutable human requirements and exact evidence/review revisions are
product state in Convex. Atomic claims bind a participant role to a job, attempt and
fence. Publication stages a proposal until its public response commits; failures
remain blocked for explicit retry or reassignment. A changed requirement retains
older evidence and marks it for revalidation rather than rewriting a running turn.

Cloud `update_collaboration_work` and native `nanthai_update_collaboration_work`
reach the same owned publication handler. Only hosts advertising the bridge capability
receive that contract. Optional read-only cloud review enforces tool-effect policy;
general Codex/Pi access is not falsely described as external-write isolation. Jev is
an advisory selection/consensus/stall input, with no acceptance or permission authority.

### Goal-aware coordination

Optional goals extend the same speaker scheduler. The bounded scheduler context includes
eligible objectives, free-text criteria and permitted owners/reviewers. Jev, the cloud
fallback and the local helper return the same optional `workId` in speaker selections.
Dispatch rechecks readiness/ownership and creates exactly one fenced claim per goal.
Ordinary discussion contributions are still allowed alongside goal assignments.

Explicit assignments use deterministic dispatch when no unanswered human input or
unassigned ready goal requires judgment. Committed replies identify answered human
frontiers, preventing repeated replies to an already answered message retained in a
work frontier. A human follow-up at the last goal's completion returns to ordinary
coordination rather than being discarded by goal completion.

An unreviewed goal completes only after its staged result and message commit against
current requirements; reviewed goals keep the existing versioned review boundary.
Start/resume names actual unfinished objectives in system events, with no synthetic
user request. The backend derives `canResume` for every client. Runtime waits use the
owned Workflow event and matching presence wake; execution deadlines remain unchanged.

Goal-start events carry `collaborationGoalAction: start_or_resume`. They remain system
records in the transcript, while canonical request assembly materializes their authored
objective as user-request content with its source ID. The objective never becomes
provider system policy, and local packets retain the same canonical source as cloud turns.
Explicitly deferred goals are absent from AI execution scopes. A start captures the goal
and transitive required inputs in `workIds`; ordinary new messages do not restart parked
or paused goals. Active scopes still accept human input and explicitly added goals.
