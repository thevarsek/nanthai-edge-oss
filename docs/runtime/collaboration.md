# Local execution in shared discussions

Convex selects speakers and owns causal progression for cloud, Codex and Pi
participants. The Runtime Host executes an already selected turn; it does not
become a second discussion scheduler. No OpenRouter account is needed merely to
pair and use a supported local Persona.

Current Persona resolution, skipped-turn catch-up, typed context and publication
use the same product ownership as ordinary local chat. Each participant keeps its
own compatible native session and delivered frontier. Partial failure does not
turn one participant's private state into another participant's history.

Helpers retain their supported route and capability requirements. Local-only
conversation support does not certify arbitrary cloud tools, every native model,
or every optional review policy. Shared work records are implemented under
[their milestone](../../milestones/M55-persona-teams-work-records.md). Hosts advertising
`nanthaiCollaborationWork` can publish through the owned
`nanthai_update_collaboration_work` bridge. Claims and staged evidence follow the
canonical job/attempt/fence; offline saved tasks cannot commit shared work state.

The owner publishes evidence through its assigned work tool. Committing the
completed reply links that evidence automatically and makes it available to the
selected reviewers with the goal's success criteria. Users do not attach replies
or enter message IDs. They can view the linked result, retry or reassign work,
and use the existing human review controls. An owner reply without published
evidence remains blocked rather than being treated as proven completion.

DEV handoffs qualify cloud, Codex 0.160.0 and Pi 1.0.0 on the supported Node 22
host. Optional cloud read-only review enforces tool effects; native general machine
access is not advertised as read-only isolation. A requirement change during a turn
retains its result for explicit revalidation, and committed dependency evidence alone
unlocks subsequent work.

For speaker/frontier semantics see
[Collaboration architecture](../architecture/collaboration-causal-wave-architecture.md).
For worker ownership see [runtime architecture](architecture.md).

## Coordination without OpenRouter

The common Collaboration Workflow tests the account's existing OpenRouter connection.
Connected accounts retain Jev and the supported cloud decision fallback; local-only
accounts use `runLocalDecisionHelper` through an available participant's Codex/Pi route.
The helper is a fenced child execution and receives the bounded committed frontier,
actual participant roles and eligible goals. It cannot use tools or grant permissions.
Codex retains the existing small helper-model selection; other adapters retain their
configured route. Runtime/vendor usage applies; this is not an OpenRouter-funded call.

Both paths return the same validated speaker and optional work-ID selection. Automatic
assignment is claimed atomically at dispatch; explicit owners/reviewers and dependency
readiness remain deterministic. Completion requires a committed result against the
captured requirements. Reviewers remain optional; when selected, each must accept the
current requirement, evidence and source revision before automatic completion. Accepted
reviewers are not dispatched again for the same revision. Explicit human acceptance and
override remain available. Slow required work stays pending while independent work advances.

If the selected runtime is offline, the run remains waiting with `waitingReason:
"runtime"`. A matching ready presence wakes the existing Workflow event; no model
polling, generative cloud fallback, or false success occurs. Stop and the existing
absolute duration still govern that wait. Goals and results survive a duration limit
and may be explicitly resumed later.
