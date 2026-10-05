# Architecture

## Product boundaries

Convex is the shared API and source of truth for web, iOS and Android. The standalone
Mac Runtime Host executes selected Codex/Pi work through the same product and
execution contracts. Clients display canonical subscriptions and submit intent;
they do not independently derive shared filtering, defaults, eligibility or lifecycle.

Clerk owns identity. Native credentials use secure platform storage; recoverable
server credentials use the shared encryption/rotation contract. OpenRouter provides
cloud inference. Local harness provider authentication remains with Codex/Pi.

## Layers

| Layer | Responsibility |
|---|---|
| Views and route owners | Platform rendering, navigation and local presentation state |
| Client services and DTOs | Typed access to the common Convex API |
| Convex domains | Conversations, Personas, sources, artifacts, schedules and entitlements |
| Execution control plane | Runs, attempts, fencing, effects, commands and teardown |
| Workflow / Workpool | Durable progression and independent owned fan-out |
| Provider / runtime adapters | Execute an authorized prepared turn and report attributable results |

Domain state remains authoritative when an adapter disconnects or a workflow retries.
Native session state is a cache, not another canonical transcript. A stopped process
and a closed writer fence are different facts; cancellation owns both boundaries.

## Application state

The Swift application uses `AppDependencies` for injected protocol-based services,
`@Observable` state owners and structured concurrency. Navigation uses the shared
selection and coordinator contracts. Android uses its native StateFlow/Compose
owners, and web uses its React route/component state. All three consume the same
backend behavior and live-shaped DTOs.

[Client state and performance](client-state.md) covers streaming overlays,
subscription reuse, batching and ownership. [Client services](../clients/service-layer.md)
and [Android architecture](../clients/android-architecture-notes.md) cover platform details.

## Domain chapters

- [Context assembly and sources](context-assembly.md)
- [Conversations and memory](conversation-domains.md)
- [Tools, skills and connected applications](tools.md)
- [Search, chat interaction and notifications](chat-interactions.md)
- [Scheduled work](schedules.md)
- [Billing and onboarding](billing-onboarding.md)
- [Audio and generated media](audio.md)
- [Knowledge Base](knowledge-base.md)
- [Data model](data-model.md)

## Execution and runtime

Use [workload authoring](durable-workload-authoring.md),
[execution ownership](execution-control-plane.md) and
[durable orchestration](durable-orchestration-rollout.md) for asynchronous work.
Legacy scheduled-action handoffs and continuation tables have been retired.
The retained `legacy_scheduler` literal exists only for historical decoding.

The [Runtime Host](../runtime/architecture.md) extends the selected executor;
[Collaboration](collaboration-causal-wave-architecture.md) still chooses who acts.
Persistent conversation summaries and future external ingress are planned separately
from the current [compaction behavior](conversation-compaction.md).
