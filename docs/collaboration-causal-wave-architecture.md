# Collaboration Causal-Wave Architecture

## Decision

NanthAI Collaboration is a per-chat behavior above the existing participant
execution path. Convex owns speaker selection, causal-wave progression,
durability, cancellation, and client truth. A selected participant still runs
through the normal cloud generation executor or, later, its resolved Runtime
Host adapter.

Parallel remains the default. Collaboration is explicit and affects only new
eligible sends after it is selected.

## Why causal waves

Every speaker selected in one wave receives the same committed frontier. Their
turns may run concurrently and cannot observe replies still being generated in
that wave. Once every selected attempt is terminal, the next scheduler decision
sees all successful replies and any human messages queued for that boundary.
An unanswered human message on that frontier requires at least one available
participant response, including when the message was queued during an active
wave.

This models real conversational simultaneity without inventing access to
unfinished text. After the latest human input has received a participant
response, a wave may select zero, one, or several participants. Zero is
successful convergence and returns the floor to the human without creating a
placeholder assistant message. An invalid scheduler response or unavailable
required participant is a visible failure, not silence.

## Ownership

| Concern | Canonical owner |
|---|---|
| Saved Parallel/Collaboration choice | `chats.groupBehavior` |
| Exchange bounds and lifecycle | `collaborationExchanges` |
| Stable frontier and 0/1/N decision | `collaborationDecisions` |
| Published replies and causal provenance | normal `messages` rows |
| Participant turn execution | existing generation runs and attempts |
| Ordered multi-wave loop | Convex Workflow |
| Client state | authenticated Collaboration projection |
| Cloud/local placement | execution attempt and later Runtime Host adapter |

The Workflow/component log is operational evidence, not product truth.

## Scheduler contract

Deterministic eligibility runs before one compact structured model decision.
The scheduler receives only public participants already in the chat, a bounded
canonical frontier, recent speaker/failure state, direct mentions, and remaining
bounds. It returns participant IDs, typed reply targets, and bounded diagnostic
reason codes. It never publishes a chat message or exposes chain of thought.

Provider output is requested with a strict structured-response schema and then
validated against the current eligible participants and frontier. Malformed or
truncated JSON is treated as a recoverable no-speaker decision with a typed
terminal reason and a retry notice; it does not escape as an uncaught Workflow
exception. Raw provider output is neither a chat message nor a client error.

Direct mentions constrain the first wave. Later waves may select another public
participant already in the chat only for a substantive contribution. Advisors,
subagents, tools, and models outside the chat are never promoted to public
speakers.

Decisions are persisted before dispatch and validated against the active
execution fence, wave number, participant snapshot, and exact frontier. A replay
returns the existing decision/messages/jobs; a stale decision cannot write.

## Initial bounds

- five causal waves;
- eight published participant messages;
- ten minutes from exchange creation;
- existing participant token ceilings;
- no additional default cost cap.

Silence normally closes an exchange earlier. Reaching a bound is a distinct,
visible terminal state and is not reported as ordinary completion.

## Failure and interruption

One participant failure does not discard successful peers. Failed participants
are excluded from automatic reselection in the same exchange. If all selected
participants fail and no eligible participant remains, the exchange fails
visibly. Systemic scheduler/control-plane failure also fails the exchange rather
than fabricating a participant response.

Stop closes the root execution fence and tears down its owned participant runs.
Queue follow-up joins the next safe boundary; Send now uses the existing
interrupt-before-send path. Collaboration and Autonomous Discussion cannot own
progression in the same chat at the same time.

The web activity panel does not add another Stop action. During an active
exchange it shows the wave, active speakers, waiting state, and queued input;
the composer continues to own the same Stop button used by ordinary model
responses. The panel uses the same shared surface treatment as Autonomous
Discussion. Fresh terminal convergence and failures remain in that panel with
a Dismiss action, so silence and errors cannot look like a dropped send.

## Private helper boundary

The existing Subagents override is chat-wide. Parallel and Collaboration pass
it to every tool-compatible participant, and each owning response continues to
render the existing Subagent batch transcript. Helpers remain private and never
become Collaboration speakers.

Autonomous Discussion currently has a direct streaming progression loop rather
than the normal deferred tool-call/checkpoint loop. It must not advertise
`spawn_subagents` until it can durably pause, execute the existing child batch,
render that same transcript, and resume the owning turn. The saved chat setting
is preserved across modes; implementing that Autonomous tool loop is explicit
remaining M50 work.

## Web entry and status surface

For the steerable web slice, the existing `+` menu groups conversation controls
separately from added context and capabilities. Its Conversation section opens
the Conversation mode drawer (Parallel, Collaboration, Autonomous Discussion)
and the existing Participants, Advisors, and Subagents surfaces. This keeps an
intentional mode change discoverable without permanently consuming composer or
header space.

## Context and Runtime Host seam

`PreparedParticipantTurn` is the single Convex-owned result of participant
context preparation. The cloud path renders provider messages from it. The
later local path renders `RuntimeTurnPacket` from the same result, including the
bounded `causality.collaboration` projection. Neither executor chooses speakers.

The prepared result carries provider messages plus assembler/policy versions,
artifact and memory references, omission counts, safety output, policy decisions,
and Collaboration frontier/reply provenance. Subsequent slices enrich this seam
with the already-resolved instruction, capability, and route snapshot before
local production dispatch.

## Compatibility

All fields added to existing records are optional. Existing chats with no saved
choice behave as Parallel. Historical messages, groups, branches, favorites,
and Autonomous sessions are not rewritten. Web is the first steerable client;
iOS and Android later mirror the same Convex contract in native components.
