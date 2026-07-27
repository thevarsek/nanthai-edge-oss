# M48 Legacy-Orchestration Retirement Ledger

This is the durable audit record for completed M48. Every `delete-B`,
`delete-C`, and `delete-D` action passed its gate and was removed in that stage.
`retain` means the symbol is part of the canonical product or execution
contract, even when its name contains `scheduled`, `continuation`, or `resume`.

## Evidence window

The compatibility baseline for this inventory is Git revision
`38bbc1033a9a024d447b5bbcb088f972b2d54298` on the production deployment
(identifier omitted from the public mirror). The production runtime cannot report a Git SHA, so the
first Stage B deployment must record its exact revision and retain this baseline
revision as the rollback target before any runtime deletion is deployed.

| Horizon | Maximum | Code evidence |
|---|---:|---|
| Generation continuation lease and cleanup | 60 minutes | 12-minute lease in `chat/generation_continuation_shared.ts`; 45-minute streaming timeout in `jobs/cleanup_generation.ts`; 15-minute cleanup cadence in `crons.ts` |
| Presentation model phases | 45 minutes | 9-minute phase timeout and five-phase cap in `presentations/limits.ts`; a 30-minute execution lease is a repair bound, not an extra serial phase |
| Advisor completion/watchdog | 30 minutes | 7-minute absolute timeout and 7.5-minute initial watchdog in `advisors/constants.ts`; 30-minute watchdog recheck in `advisors/workflow_watchdog.ts` |
| Drive-picker retry | 30 minutes, excluding user wait | capped retry in `drive_picker/ownership.ts`; an active user wait is directly represented by `drivePickerBatches` and therefore cannot hide behind a zero drain result |
| Video polling | about 18 minutes | 40 Workflow-owned polls with the bounded intervals in `chat/video_workflow.ts` |
| Generic owned-component watchdog | 30 minutes | `execution/owned_workflow_watchdog.ts` and `execution/workpool_watchdog_schedule.ts` |
| Operational rollback | **7 days** | declared M48 rollback policy; a rollback to legacy routing resets the evidence window |
| Mandatory production canaries | less than 1 day | includes one deliberately near-term scheduled occurrence |

The code horizon is therefore 60 minutes. The minimum evidence window is the
maximum of 60 minutes, 7 days, and the canary duration: **7 days**. The
24-hour domain execution lease in `execution/domain_lifecycle.ts` belongs to
the canonical M46/M47 control plane; it is retained and is not a legacy callback
horizon.

The first production zero was 2026-07-19. The 7-day time requirement has
elapsed without a production rollback. Runtime deletion remains gated on the
canary matrix below, not merely on elapsed time.

## Production observations

Every listed source was individually zero in each complete observation:
`executionAttempts`, `generationJobs`, `generationContinuations`,
`autonomousSessions`, `searchSessions`, `advisorBatches`, `advisorRuns`,
`subagentBatches`, `subagentRuns`, `drivePickerBatches`,
`presentationProjects`, `presentationGenerationRuns`,
`presentationGenerationBatches`, `presentationCuratorTasks`,
`researchSearchBatches`, `researchSearchTasks`, `scheduledJobs`, and
`videoJobs`.

| Time (UTC) | Revision/deployment | Aggregate | Traffic since prior observation |
|---|---|---|---|
| 2026-07-19, post-rollout | deployed M46/M47 / production | complete, uncapped, 0 active | bounded orphan cleanup; exact CLI time was not retained |
| 2026-07-19T22:31:18Z | deployed M46/M47 / production | complete, uncapped, 0 active | independent same-day recheck |
| 2026-07-27T13:18:13Z | baseline `38bbc103` / production | complete, uncapped, 0 active | ordinary production traffic; mandatory canaries not yet run |
| 2026-07-27T13:28:14Z | baseline `38bbc103` / production | complete, uncapped, 0 active | health and insights audit; mandatory canaries not yet run |
| 2026-07-27T13:44:56Z | baseline `38bbc103` / production | complete, uncapped, 0 active | no-tool chat, multi-round Google tool call, and Drive-picker wait canaries |
| 2026-07-27T13:52:21Z | baseline `38bbc103` / production | complete, uncapped, 0 active | research fan-out plus Advisor and subagent completion canaries |
| 2026-07-27T14:40:34Z | hotfix `a4774c8e` / production | complete, uncapped, 0 active | presentation completion, autonomous ordered-turn stop, and two acknowledged Workflow drain boundaries |
| 2026-07-27T15:06:17Z | scheduled fixes through `93eac7de` / production | complete, uncapped, 0 active | persisted scheduled recurrence, one completed occurrence, and conversational deletion of the temporary job |
| 2026-07-27T15:23:56Z | `93eac7de` / production | complete, uncapped, 0 active | analytics child-Workflow resume, video submit/poll/collect, and queued chat deletion in progress on canonical Workflow ownership |
| 2026-07-27T16:47:52Z | Stage B `319a465a` / production | complete, uncapped, 0 active | immediate post-deploy health and drain; no index deletion |
| 2026-07-27T16:51:04Z | Stage B `319a465a` / production | complete, uncapped, 0 active | post-deploy chat `jh71a4…yr3` completed through canonical Workflow plus two background Workpool hooks |

At the last observation, `health:check --prod` returned `status: "ok"`.
`convex insights --prod` reported no resource-limit failure and five small,
automatically retried OCC-conflict groups in the preceding 72 hours: Workflow
or background Workpool `pendingStart`/`pendingCompletion` (4, 3, 6, and 4
conflicts) and message-embedding completion (2 conflicts). Queue age and
scheduled lag were subsequently checked in the signed-in production dashboard.

The signed-in production Health page confirmed the S16 deployment class and
showed no concurrency-limit incident. At 2026-07-27T15:23Z, the component
tables `pendingStart`, `pendingCompletion`, and `pendingCancelation` were empty
for the Workflow-owned Workpool and for the interactive, background, and
maintenance Workpools. The Schedules page showed only current or future
watchdogs and teardown callbacks; no overdue scheduled function was present.

Development had one active `executionAttempts` residue classified as legacy.
Provenance inspection identified attempt `ts7bw2…g7c` as the waiting execution
for scheduled Step 2 job `jn7dmz…970`; the domain job had already failed with
`Timed out (stale job cleanup)` while its run remained waiting without an
orchestration engine. At 2026-07-27T16:40:54Z it was terminalized through the
canonical execution mutation with its original fence and an explicit orphan
summary. No row was deleted or rewritten to masquerade as current Workflow
work. The immediately following development drain inspection was complete,
uncapped, and zero across all 18 sources.

The first Drive-picker cancellation canary exposed an acknowledged Workflow
teardown defect. Workflow `jd75sspzxk67p8dbx47p0parss8bbqez` had already
settled when the delayed teardown pass re-addressed it at the 11-minute action
drain boundary, producing `Workflow not found`. The periodic reconciler still
terminalized execution run `v97e15hygwbewmkeqg0hxe52d98bbjsd` at
2026-07-27T14:05:32.888Z.

Commit `b825a23c` stopped re-addressing an elapsed acknowledged component.
The first post-deploy canary then showed that duplicate legitimate Workflow
completion callbacks could re-stamp the acknowledgement and extend the drain
boundary. Commit `a4774c8e` made both completion paths preserve the first
acknowledgement and boundary. After that deployment:

- autonomous Workflow `jd72mh44946731aygqjfammkj58ban88` terminalized 218 ms
  after its original boundary;
- chat Workflow `jd78dck02p5rdag7e9nnm876b58bbtzx` terminalized 112 ms after
  its original boundary; and
- neither timestamp changed, while filtered production logs contained no
  `Workflow not found` or either Workflow ID.

The hotfix cancellation canary is therefore green. The queued-deletion canary
also synchronously fenced all four writers, requested canonical run-tree
teardown, and advanced each owned Workflow toward its acknowledged component
drain boundary. The drain is intentionally asynchronous and was accepted as
the deletion evidence for Stage A; completion latency is an operational
follow-up, not evidence of legacy routing.

The scheduled-job canary also found three public tool-contract defects before
the recurrence path passed. Commits `a21e7719`, `f6a645a0`, and `93eac7de`
respectively project tool-authored recurrence payloads onto the exact Convex
union, return the persisted canonical `nextRunAt`, and inherit the invoking
turn's model unless the user explicitly requests an override. The production
canary then created a `*/15 * * * *` job, started its occurrence 342 ms after
the 2026-07-27T15:00:00Z due time, completed in 5,678 ms with the exact
`SCHEDULE_CANARY_OK` response, installed the 15:15Z recurrence, and deleted
the temporary job conversationally.

## Public-client and automation inventory

- iOS, Android, and web call stable public chat, cancel/delete, Drive-picker,
  presentation, scheduled-job, autonomous, and video APIs. Stage B changes only
  backend routing behind those APIs.
- `infra_public_contract.test.ts` is the executable public-export inventory.
  No public function or required argument is approved for removal in Stage B.
- Native recurrence in `scheduledJobs`, cron entrypoints, bounded cleanup,
  notification, reconciliation, and one-shot Workflow triggers are canonical
  scheduler uses and remain.
- Generated `_generated/api` references are regenerated after each deletion
  group. A deleted internal identity must have no static caller and no active
  row in its associated drain source.
- The rollback runbook redeploys the recorded compatibility revision. It never
  changes the engine of an existing attempt.

## Symbol and persisted-field ledger

| Symbol or field (file) | Legacy owner / drain proof | Current replacement | Compatibility and action | Verification |
|---|---|---|---|---|
| `scheduleGenerationContinuation` scheduler branch (`chat/actions_run_generation_continuation.ts`) | pre-M47 participant handoff; generation jobs/continuations zero | `generation_workflow.ts` event/checkpoint continuation | stable callers remain, scheduler branch `delete-B` | chat continuation and replay tests |
| `setGenerationContinuationScheduled` export, args, handler (`chat/mutations.ts`, `chat/mutations_args.ts`, `chat/mutations_generation_continuation_handlers.ts`) | persists old callback IDs; generation rows zero | Workflow event ownership | writer/export deleted-B; persisted readers deleted-C | public contract plus deletion/cancel tests |
| generation `scheduledFunctionId` (`schema_tables_core.ts`) | old generation callback on terminal and active history | attempt/component ownership | deleted-C after bounded counts | drain, migration dry run, chat delete |
| `shouldUseLegacySchedulerResume` and fallback (`drive_picker/actions.ts`) | pre-M47 picker resume; picker batches zero | `workflowResumeEventId` signal | public picker API retained; `delete-B` | picker wait/resume and old-client contract |
| `scheduleResume` (`drive_picker/mutations.ts`) and generation-job schedule field writes | old picker callback; picker/generation rows zero | Workflow event retry in `resume_mutation_handlers.ts` | writer deleted-B; field reader deleted-C | picker retry/cancel/delete |
| absent-engine default to `legacy_scheduler` (`drive_picker/resume_mutation_handlers.ts`, `drive_picker/ownership.ts`) | predecessor adoption; picker batches zero | explicit `convex_workflow` attempt | historical literal retained; runtime default `delete-B` | missing-event fail-closed test |
| `scheduleLegacyDeferredGeneration` (`advisors/legacy_deferred_generation.ts`) and lifecycle branch | pre-M47 advisor final generation; advisor sources zero | advisor Workflow completion event | internal only; `delete-B` | advisor deferred completion/cancel |
| advisor `scheduledFinalGenerationId(s)` (`schema_tables_advisors.ts`) | old final callback IDs; advisor batches zero | Workflow ID/event | deleted-C | bounded counts and account/chat delete |
| advisor-run `scheduledFunctionId` and `watchdogScheduledFunctionId` (`schema_tables_advisors.ts`) | old run/watchdog callbacks; advisor runs zero | Workpool operation and owned watchdog | deleted-C; canonical watchdog component refs remain | timeout/cancel/replay |
| `adoptLegacyPresentationExecution` and ref (`presentations/legacy_execution_adoption.ts`, `generation_fanout_refs.ts`) | pre-M47 action adoption; presentation sources zero | supplied fenced execution identity | internal only; `delete-B` | action identity rejection tests |
| `resolvePresentationActionContext` fallback (`presentations/legacy_action_identity.ts` and curator/studio contexts) | adopts identity-less action | `generation_execution_identity.ts` | require canonical identity; fallback `delete-B` | curator/repair/finalization |
| `legacy_execution_lifecycle.ts` | terminalizes adopted legacy attempts | canonical run/attempt lifecycle | internal only; `delete-B` after callers removed | lifecycle and fence tests |
| deferred scheduler-chain exports (`presentations/deferred_workflow_actions.ts`, `deferred_workflow_repair_actions.ts`, `deferred_generation_repair_handler.ts`) | pre-M47 presentation phase callbacks | `presentation_workflow_steps.ts` | split retained DTO/helpers, then `delete-B` identities | generated API and workflow tests |
| snapshot scheduler fallback (`presentations/generation_finalization_handler.ts`) | pre-M47 snapshot callback; generation runs zero | Workflow snapshot step | `delete-B` branch | finalization/snapshot idempotency |
| presentation run `curatorScheduledFunctionId`, `finalizerScheduledFunctionId`, `snapshotScheduledFunctionId` (`schema_tables_presentations.ts`) | old callbacks; generation runs zero | Workflow/Workpool component IDs | deleted-C | bounded field counts and project delete |
| presentation batch/task `scheduledFunctionId` (`schema_tables_presentations.ts`) | old fan-out callbacks; batches/tasks zero | Workpool operation IDs | deleted-C | Workpool cancellation/finalization |
| `workflowManaged === false` self-scheduling (`autonomous/actions_run_cycle_handler.ts`, related error handlers) | pre-M47 ordered cycle; sessions zero | `session_workflow.ts` | public start/stop retained; fallback `delete-B` | ordered-turn stop/cancel |
| `workflowManaged === false` phase scheduling (`search/workflow_durable.ts`) | pre-M47 research phase chain; search sources zero | `research_workflow.ts` / regeneration Workflow | direct one-shot web search retained; fallback `delete-B` | research fan-out/replay |
| `workflowManaged === false` continuation scheduling (`subagents/actions_run_subagent.ts`) | pre-M47 child continuation; subagent sources zero | `subagent_workflow.ts` and resume event | public tool contract retained; fallback `delete-B` | child completion/parent resume |
| `workflowManaged === false` poll scheduling (`chat/actions_video_generation.ts`) | pre-M47 video poll chain; video jobs zero | `video_workflow.ts` | public video action retained; fallback `delete-B` | submit/poll/collect/cancel |
| scheduled-job recurrence `scheduledFunctionId` (`schema_tables_user.ts`, `scheduledJobs/**`) | canonical recurrence, not legacy | recurrence starts owned Workflow occurrence | `retain` | recurrence canary and occurrence linkage |
| `legacy_scheduler` validator/literal (`schema_tables_execution.ts`, `execution/runs.ts`) | historical attempts and rollback decoding | immutable attempt engine | `retain` through M48; terminal audit data need not migrate | historical decoding test |
| domain continuation/checkpoint rows and `workflowResumeEventId` | canonical Workflow checkpoints and joins | same symbols | `retain` | replay/cancel/delete |
| execution runs, attempts, fences, operations, events, component refs, runtime bindings | canonical M46/M47/M45 contract | same symbols | `retain` | control-plane suite |
| `inspectLegacyOrchestrationDrain` and validators/query/tests (`execution/legacy_drain.ts`, `execution/queries.ts`) | retirement sentinel over all 18 sources | none after retirement | deleted-D, last | post-Stage-C zero window |

## Stage B removal checkpoints

### Batch 1 — canonical Workflow routing

This branch checkpoint removes the proved-unreachable scheduler handoffs for
generation continuation, Drive-picker resume, Advisor completion, autonomous
cycles, research phases, subagent child/parent continuation, and video polling.
It also removes the duplicate internal generation and subagent action
identities and the legacy Advisor, autonomous, and subagent recovery modules.

The retained scheduler calls in these domains are one-shot Workflow starts,
Workflow-event delivery retries, analytics dispatch, bounded reconciliation,
and other ledger-classified canonical work. Persisted schedule-ID fields remain
readable for Stage B rollback and drain inspection; the remaining generation
schedule-ID writer is still required by the presentation compatibility slice
and is deferred to the next batch.

Verification for this checkpoint:

- Convex TypeScript typecheck and lint are clean;
- all 2,568 backend tests pass serially;
- the development deployment packaged and published successfully, its health
  check returned `status: "ok"`, and regenerated API bindings contain none of
  the three deleted modules;
- the development drain remains complete and uncapped but intentionally
  non-zero only for the previously documented `executionAttempts` fixture
  (`sampledActiveLegacy: 1`); every other source is zero and the fixture was
  not mutated to manufacture a green result;
- deleted-path tests were replaced with fail-closed ownership and
  Workflow-owned retry/cancellation assertions;
- the old public Drive-picker and scheduled-job contracts remain stable; and
- production deployment is intentionally deferred until the presentation
  routing/adoption batch completes and the full Stage B gate is green.

At this checkpoint, presentation predecessor adoption, deferred phase
callbacks, snapshot fallback, and their legacy execution lifecycle remained
for Batch 2. No Stage C field, validator, index, or historical row removal was
included in Batch 1.

### Batch 2 — presentation canonical ownership

This branch checkpoint removes the presentation predecessor-adoption helpers,
identity-less studio and curator action fallback, adopted-attempt lifecycle,
deferred scheduler-chain action identities, repair callback chain, snapshot
scheduler fallback, and the last generation schedule-ID writer that existed
only for that presentation compatibility path.

Presentation studio, curator, and finalizer actions now require the immutable
execution attempt and fence. Context queries reject mismatched identities.
Deferred completion requires the parent Workflow event and fails closed when
the event or checkpoint is missing. Finalization requires canonical Workflow
ownership before publishing any slides and signals only the Workflow terminal
event. The canonical presentation Workflow, Workpool fan-out, bounded
revision-expiry lease, repair-candidate cleanup, schema fields, historical
readers/cancellers, public APIs, and drain sentinel remain.

Verification for this checkpoint:

- Convex TypeScript typecheck and lint are clean;
- focused presentation, continuation, replay, and durable-orchestration tests
  pass;
- all 2,559 backend tests pass serially;
- the development deployment packaged and published successfully at
  2026-07-27T16:39:15Z and `health:check` returned `status: "ok"`;
- regenerated API bindings contain none of the retired presentation modules,
  callback identities, snapshot fallback, or generation schedule writer;
- the one development residue was provenance-checked and terminalized through
  the normal fenced execution lifecycle rather than deleted;
- the post-terminalization development drain at
  2026-07-27T16:40:54Z is complete, uncapped, and zero in all 18 sources; and
- Stage B production deployment and the repeated production canary/drain gate
  remain pending explicit production-deploy authorization.

At the Batch 2 checkpoint, Stage B tasks 48.4 and 48.5 were complete and task
48.6 had passed its development half. Stage C remained blocked until the
production half and its verification window passed.

### Batch 3 — Stage B production rollout

The production deployment accepted exact pushed revision
`319a465a666c5d5f89c74c4e1083354033e8b9de` on 2026-07-27 without deleting
indexes or changing the public client contract. The pre-deploy rollback target
is `93eac7de`.

Immediate and post-canary health checks returned `status: "ok"`. Both drain
inspections were complete, uncapped, and zero across all 18 sources. The
post-deploy log window contained no failed function, retired callback identity,
or legacy module name.

Live chat `jh71a4nr0mc0zrj18hh2pe48tn8bayr3` returned the exact
`M48_STAGE_B_PROD_OK` marker. Generation job `js74r…xvn` and run `v970p…d85`
completed. Both attempts were `convex_workflow`; owned Workflow
`jd756…ss1`, post-generation Workpool `k17d6…deb`, and memory-extraction
Workpool `k17c8…9q9` all completed. The focused public-contract, drain,
presentation ownership, and finalization suite passed 22/22 after deployment.

Task 48.6 completed before Stage C began. Persisted fields and the drain
sentinel were intentionally not removed in the same deploy as their last
runtime readers.

## Stage C and D closeout

Revision `fab7af6e` added a dry-run-capable, resumable migration that scanned
each candidate table in 100-row pages. Development found and removed legacy
values from three advisor batches, three advisor runs, four of seven
presentation generation runs, and all 25 presentation generation batches.
Generation jobs (1,153 scanned), continuations, and curator tasks were already
clean. A second full scan returned zero for every candidate field.

Production inventory scanned 950 generation jobs, two advisor batches, two
advisor runs, three presentation generation runs, three presentation
generation batches, and zero continuations or curator tasks. Every candidate
field count was already zero, so the production migration changed no rows.

Revision `1f699e5e` removed the persisted fields, readers, cancellers,
validators, and temporary migration helper. Production schema validation,
health, the complete uncapped 18-source drain, and the
`M48_STAGE_C_PROD_OK` Workflow/Workpool canary passed; all 2,559 backend tests,
TypeScript, and lint were clean.

Revision `159983e1` then removed the sentinel implementation, public internal
query export, validators, and tests. Development and production deployment and
health passed, all remaining 2,556 backend tests passed, and the final
production canary returned `M48_COMPLETE_PROD_OK` through canonical Workflow
and Workpool ownership. M48 is complete.

## Production canary record

The completed matrix records run/attempt linkage, component ownership, terminal
domain state, duplicate-effect checks, and the associated zero-drain
observations.

| Canary | Status |
|---|---|
| no-tool chat | pass: `jh7341…b37d`; completed fenced Workflow attempt plus terminal post-generation and memory Workpool operations |
| multi-round tool chat | pass: `jh7fnx…bktt`; reconnected Google Calendar call completed over three committed Workflow round offsets, with terminal background Workpool operations |
| cancel between rounds; delete with queued work | pass: direct cancellation and autonomous stop at `a4774c8e` settled at their original acknowledged boundaries without re-addressing; deleting queued chat `jh78k3…ba1ht` synchronously fenced all four canonical runs and advanced their owned Workflows through run-tree teardown |
| research/search fan-out | pass: `jh77na…bvdb`; two interactive Workpool search tasks and their owning Workflow completed with a zero drain observation |
| advisor and subagent deferred completion | pass: Advisor `jh743n…bfd6` and subagents `jh760d…bjf8`; Workflow/Workpool ownership and parent resume completed without schedule IDs |
| Drive-picker wait/resume | pass: current wait/cancel batch `qs72jw…b2jt` held a Workflow resume event and exposed the teardown defect above; post-M47 completed batch `qs7ea0…avk3n` attached exactly one picked file, signaled its Workflow event, resumed `jh7dhz…t05t`, completed the fenced parent run, and used no legacy schedule ID |
| presentation generate/curate/repair/finalize/snapshot | pass: `jh79xk…a15b`; project ready, generation run complete, Workflow plus studio/curator/finalizer Workpool refs completed, and all legacy schedule IDs absent |
| autonomous ordered turns and stop | pass: `jh78pv…bak8s`; one ordered turn completed before explicit stop, the session has no schedule ID, and its acknowledged Workflow settled at the original drain boundary |
| video submit/poll/collect | pass: `jh7c57…aath`; 5-second 720p `x-ai/grok-imagine-video` job `qd71qg…bsng` completed after five provider polls, media run `v978c5…aetf` and Workflow `jd7887…aseh` completed, parent resumed, and the web client rendered a playable video |
| scheduled recurrence and occurrence | pass: job `mn7djp…bdyn`, occurrence chat `jh7bwn…bjyd`, run `v972eh…b6xz`, and Workflow `jd7evc…a2e9`; exact due time persisted, occurrence completed, next recurrence installed, and temporary job deleted with no legacy schedule ID |
| analytics/chart child Workflow and artifact resume | pass: `jh7f0b…bxdt`; analytics run `ts749z…brr1` and Workflow `jd799c…bae1p` completed, two stored artifact intents rendered, and parent generation resumed with `ANALYTICS_CANARY_OK` |
| background Workpool | pass: post-generation and memory-extraction operations completed for both chat canaries |
| maintenance Workpool and dashboard health | pass: production logs show successful interactive/background/maintenance/Workflow Workpool healthchecks; S16 Health showed no concurrency incident, all four Workpool pending queues were empty, and Schedules showed no overdue callback |

All rows passed. The matrix, public-contract suite, drain sentinel, and health
checks were repeated after Stage B and Stage C before the sentinel was removed
last in Stage D.
