# Durable orchestration

Workflow/Workpool provides durable progression over canonical domain state.

For new workload implementation, follow
[durable-workload-authoring.md](durable-workload-authoring.md). This document
describes the workload map and current rollback boundaries. Legacy continuation
handlers and their drain sentinel have been retired.

## Execution ownership

NanthAI uses Convex Workflow for ordered durable sequences and Convex Workpool for independent queued work. The existing OpenRouter round executor remains the model/tool engine. Convex application tables remain canonical; component history is never exposed as the product API.

The important runtime rule is simple: one participant action performs one complete model/tool round. When that round is safely stored, Workflow starts the next round in a fresh action. The agent loop can therefore run far beyond ten minutes without allowing any single action to exceed the Convex action budget.

This preserves the user's safety concern about being mid-stream near expiry: a step does not keep starting new unpredictable work until a timer is nearly exhausted. The durable boundary is the completed round, and every new round receives a fresh action budget.

## Component layout

| Component | Global parallelism | Work |
|---|---:|---|
| Workflow manager | 10 | Ordered research, generation, video polling, autonomous sessions |
| Interactive Workpool | 6 | Advisor calls, presentation studios/repairs/curators, research queries, and scheduled fan-out |
| Background Workpool | 3 | Post-processing, title generation, memory extraction |
| Maintenance Workpool | 1 | Embeddings and relationship rebuilds |

The configured total is 20. This is the Starter/S16 production
profile: it preserves the priority order while leaving headroom around S16's
eight concurrent scheduled-job executions and shared component coordination.
The numbers are global queue capacity, not per-user limits. Accepted PAYG work
queues durably under load. Raise them only from observed queue age and scheduler
lag, or after moving to a deployment class with materially more scheduled-job
capacity.

Automatic action retry is disabled by default in every component. Retries are enabled only where the execution-control-plane effect policy proves them safe. These are system queues, not per-user limits: accepted PAYG work waits under pressure instead of being rejected by an application allowance.

## Implemented workload order

| Order | Existing workload | Result on this branch |
|---:|---|---|
| 0 | Component foundation | Workflow plus three named Workpools mounted; compact IDs, operation links, cancellation, and retry-off defaults established |
| 1 | Memory maintenance | Embedding, relationship, and bulk-page work route through the maintenance pool with stable item/page ownership |
| 2 | Post-generation work | The response claims and enqueues post-processing atomically; title and memory extraction then use the background pool |
| 3 | Research paper/search | Workflow owns ordered planning/depth/synthesis phases and Workpool owns independent queries; persisted phase/session rows remain canonical |
| 4 | Scheduled jobs | Native scheduling owns recurrence only; every occurrence creates a fenced execution run and starts one ordered Workflow |
| 5 | Core chat | Each participant Workflow performs one complete model/tool round per action. Bounded component journals atomically chain successors, so there is no conversation round limit |
| 6 | Advisors | A batch Workflow owns the barrier and downstream handoff; independent consultations run in the interactive pool and signal one durable terminal event |
| 7 | Subagents | Each child owns a fenced child execution run and round Workflow; bounded journals chain successors and the parent checkpoint/event resumes exactly once |
| 8 | Presentations | One Workflow owns plan → studio fan-out/join → curator/repair → finalizer → snapshot; Workpool owns independent studio and repair work; revision-safe domain rows remain canonical |
| 9 | Autonomous chat | One Workflow owns ordered participant turns, durable delays, stop conditions, and terminalization; conversation order is deliberately not parallelized |
| 10 | Video/media | One child Workflow owns submit → sleep → poll → collect/upload → publish/terminalize; one-shot image/audio/document tools intentionally remain bounded direct calls |
| 11 | Analytics/charts | Data Python tools defer to a child Workflow with prepare, hydrate, execute, collect, normalize, persist, attach, resume, and cleanup phases. Deterministic artifact intents prevent replay duplicates and binaries stay in storage |

Choose the primitive by workload ownership and ordering requirements; the table is
a domain map, not a required sequence for unrelated new features.

## Why advisors, subagents, and presentations retain domain join state

Workflow/Workpool replace execution dispatch and action chaining, not product truth. Advisor partial-result reuse, subagent parent resumption, and presentation revision/repair selection are visible domain semantics. Removing those tables in favor of opaque component history would weaken recovery and client contracts.

The component operation ID is stored on the domain record for cancellation and observability. Completion still commits through the existing idempotent domain mutation. Before a deferred child starts, the parent Workflow creates an event and persists the parent checkpoint containing that event ID. The child terminal callback commits its result and signals that event; the same parent Workflow resumes without scheduler re-entry or a completion-before-wait race.

## Chart and uninterrupted-process boundary

The Pyodide and Vercel Sandbox tools now checkpoint before execution and run as
owned child analytics Workflows. Execution writes a raw, bounded envelope to
Convex storage. Later steps collect chart/output bytes into deterministic
artifact intents, normalize a bounded result, attach once, and signal the
parent. Workflow history contains only IDs and small summaries.

Workflow cannot make a single uninterrupted process live longer than Convex's action limit. If a chart, repository build, browser session, or in-memory workspace genuinely needs that:

1. prepare a canonical execution operation and predetermined artifact identities;
2. issue a runtime command to a user-owned or separately billed persistent executor;
3. return from the Convex action;
4. receive bounded heartbeat/events and storage-backed artifacts;
5. reconcile/attach exactly once;
6. start the next Workflow round.

The Runtime Host implements Codex App Server and Pi RPC on the user's Mac. NanthAI does not keep an uncharged hosted VM open per user. The adapter order does not alter this Workflow detachment boundary.

## Lifecycle and rollback

```mermaid
flowchart TD
    T["Native mutation or recurrence trigger"] --> W["Participant Workflow"]
    W --> R["Fresh action: one complete round"]
    R --> D{"Terminal or deferred?"}
    D -->|"more tools"| K["Commit checkpoint + next fresh action"]
    K --> W
    D -->|"deferred child"| C["Persist event ID + start child"]
    C --> X["Child commits result + signals event"]
    X --> W
    W -->|"bounded journal full"| H["Atomically link successor Workflow"]
    H --> W
    D -->|"terminal"| F["Finalize message and execution run"]
```

Rollback procedure:

1. deploy the last known-good routing revision if new Workflow dispatch itself must be stopped; there is no undocumented runtime flag;
2. never switch an existing attempt between engines;
3. allow active component operations to finish or cancel them through centralized teardown;
4. retain the canonical run/attempt projection and effect journal;
Current rollback uses a known-good canonical
execution-control-plane revision and never restores the retired handlers.

## Source map

- Managers and queue policy: `convex/execution/components.ts`
- Generation Workflow/queue: `convex/chat/generation_workflow.ts`, `convex/chat/run_generation_queue.ts`
- Deferred generation events and successor handoff: `convex/chat/workflow_events.ts`
- Research: `convex/search/research_workflow.ts`, `convex/search/research_fanout_*`
- Video: `convex/chat/video_workflow.ts`
- Autonomous: `convex/autonomous/session_workflow.ts`
- Advisors: `convex/advisors/advisor_workflow.ts`, `convex/advisors/workflow_steps.ts`
- Subagents: `convex/subagents/subagent_workflow.ts`, `convex/subagents/subagent_workflow_handoff.ts`
- Presentations: `convex/presentations/presentation_workflow*.ts`
- Analytics/charts: `convex/analytics_workflows/*`
- Child fan-out: `convex/execution/fanout_queues.ts`
- Background/maintenance: `convex/execution/workload_queues.ts`
- Component start/cancellation: `convex/execution/workflow_starts.ts`, `convex/execution/teardown.ts`
