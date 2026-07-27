# Durable Workload Authoring

This is the mandatory entry point for new or materially changed asynchronous
Convex workloads. Read it with [execution-control-plane.md](execution-control-plane.md)
and [durable-orchestration-rollout.md](durable-orchestration-rollout.md) before
changing orchestration.

## Non-negotiable direction

M46/M47 is the active execution surface. Legacy scheduler IDs, continuation
actions, and handoff chains remain only so work created before the production
rollout can finish safely. Do not extend them for new behavior.

Changes to a legacy path are allowed only when they:

- fix a correctness or security defect affecting legacy in-flight work;
- preserve released-client or rollback compatibility;
- improve drain inspection or terminal cleanup; or
- remove the path after the production drain gate is satisfied.

Any other exception needs an explicit architecture decision recorded in the
relevant milestone or pull request.

## Choose the execution primitive

| Work shape | Required primitive |
|---|---|
| One bounded, replay-safe operation | Direct mutation/action, still fenced if it belongs to an execution run |
| Ordered steps, waits, retries, or multiple model/tool rounds | Convex Workflow |
| Independent fan-out with bounded global concurrency | Interactive, background, or maintenance Workpool |
| One uninterrupted process or in-memory workspace beyond the action budget | M45 runtime adapter over the same M46 contract |
| Recurrence or delayed wake-up | Native scheduler may trigger the Workflow; it must not become a parallel orchestration engine |

Use the interactive pool for user-visible fan-out, the background pool for
post-response work, and the maintenance pool for bulk/index/repair work. These
queues provide backpressure; they are not user quotas.

## Required lifecycle

1. Keep domain tables as product truth. Workflow and Workpool history are
   orchestration details, not client APIs.
2. Atomically create or adopt an `executionRun` and its first
   `executionAttempt` before dispatch.
3. Set the orchestration engine once per attempt. Never switch a live attempt
   between Workflow and the legacy scheduler.
4. Pass compact domain/run/attempt/checkpoint IDs between steps. Store large
   prompts, results, and artifacts in application tables or Convex storage.
5. Link every Workflow, Workpool operation, or runtime session through an
   `executionComponentRef` so cancellation and deletion own the whole tree.
6. Fence every consequential write with the active attempt identity and token.
   Late, stale, cancelled, or superseded writers must fail closed.
7. Make step completion and successor creation atomic and idempotent. A replay
   must return the committed outcome without duplicating domain state.
8. Route tool/provider effects through the operation journal and declared
   effect policy. Never automatically resend an ambiguous write.
9. Terminalize domain state, the attempt, the run, and the component reference
   exactly once. Completion callbacks and watchdog reconciliation must agree.
10. On cancellation, close the writer fence synchronously and use centralized
    run-tree teardown. Do not add domain-local best-effort cancellation islands.
11. Expose lifecycle to clients through
    `execution/queries:listMyRunProjections`; keep streaming rows as the content
    overlay rather than a second lifecycle truth.

## Retry, callback, and event rules

- Use `failClosedProviderActionOptions` for a Workflow action that can cross a
  paid provider boundary before committing an idempotency claim or exact
  result. Automatic retry is allowed only for coordination, reads, or effects
  whose durable checkpoint makes replay provably safe.
- A successful Workflow or Workpool return is not product success. Completion
  callbacks must derive the outcome from canonical domain rows or a committed
  downstream-owner handoff. If neither exists, terminalize as failed instead
  of leaving a Workflow waiting for an event that will never arrive.
- Schedule a watchdog when dispatching every owned Workflow or Workpool item.
  Its reconciliation path must use the same canonical-state test as the normal
  completion callback.
- Treat delivery to an already-settled Workflow/event as an idempotent no-op
  with `isSettledWorkflowSignalError`. Do not let a late terminal signal roll
  back product state that was already committed in the same mutation.
- Reschedule only conditions that can change. A missing permanent owner
  (execution run, attempt, or required domain row) must terminalize the orphan
  and release its parent rather than poll forever.

## Canonical modules

- Component policy: `convex/execution/components.ts`
- Run/attempt lifecycle: `convex/execution/runs.ts`, `attempts.ts`,
  `control_plane.ts`, `domain_lifecycle.ts`
- Workflow starts and ownership: `convex/execution/workflow_starts.ts`,
  `workflow_lifecycle.ts`, `component_refs.ts`
- Workpool routing: `convex/execution/fanout_queues.ts`,
  `workload_queues.ts`, `maintenance_bulk_queues.ts`
- Cancellation/deletion: `convex/execution/cancel_fence.ts`, `teardown.ts`
- Effects: `convex/execution/operations.ts`,
  `convex/tools/effect_policy_inventory.ts`
- Client lifecycle: `convex/execution/projection.ts`, `queries.ts`
- M48 retirement audit:
  [M48 Legacy Orchestration Retirement](../milestones/M48-legacy-orchestration-retirement.md)
  and its retained symbol/data ledger

M48 completed the legacy deletion procedure and removed the drain sentinel
last. The ledger remains the historical proof; it is not a runtime extension
point.

Prefer extending these helpers or an existing domain Workflow over creating a
new parallel abstraction.

## Exact Convex validator boundaries

TypeScript structural typing does not remove runtime properties. Passing a
large Workflow payload to a helper typed as `Pick<Payload, "attemptId">` and
then spreading that helper argument into `runQuery`, `runMutation`,
`runAction`, or `scheduler.runAfter` still sends every property from the
original object. Convex correctly rejects the extras at runtime.

At every Convex function or scheduled-function boundary:

- construct a fresh object containing only fields declared by the destination
  validator, or use a named projector that does so;
- do not spread a structurally wider `args`, token, checkpoint, or context
  object into a narrower destination merely because TypeScript accepts it;
- omit undefined optional properties when building the projected payload;
- share the same validator constant when source and destination intentionally
  have identical shapes; and
- add a behavioral test with a fully populated wider source payload, asserting
  the exact keys sent to the destination.

This rule applies equally to argument and return validators. When a query
returns a persisted document through an explicit object validator, keep a
schema/return field-parity test so an additive schema field cannot become a
production `ReturnsValidationError`.

## Required tests

Every new durable workload needs focused coverage for:

- duplicate trigger and replay;
- stale attempt/fence rejection;
- cancellation before dispatch, during work, and after a committed handoff;
- completion/cancellation and callback/watchdog races;
- partial failure and resume from the last durable boundary;
- exactly-once domain finalization and artifact/effect publication;
- run-tree deletion and component cleanup;
- live-shaped canonical client projection when lifecycle fields change; and
- historical attempt-engine decoding where the workload exposes audit history.

Run the complete Convex test/typecheck/lint gates after the focused suite. Do
not add compatibility fields, scheduler handoffs, or predecessor-adoption
handlers in new workloads. M48 completed their staged removal after its
production client, data, rollback, call-graph, and drain gates passed.
