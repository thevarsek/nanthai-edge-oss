# Runtime experiment and release policy

> Applies to M45 and M53–M58. Accepted planning rule, 2026-09-09.
> Purpose: experiments may inform releases, but may not become unowned production code or a substitute for user value.

## Before adding an experiment

Create an experiment record in the active milestone or an isolated experiment directory. It must name:

| Field | Required content |
|---|---|
| Question | Falsifiable hypothesis and the decision the result changes |
| Owner | Named milestone/task responsible for promotion or deletion |
| Budget | Engineering bound and separately authorized inference/quota envelope |
| Entry/exit | Preconditions, success/guardrail measures, stopping condition and retest rule |
| Footprint | Source paths, packages, endpoints, flags, test fixtures, data, external configuration and generated assets |
| Isolation | How production imports/builds/deployments cannot reach it |
| Evidence | Reproducible inputs, versions, result location and permitted retained data |
| Disposition | Promote, delete, or transfer to a named owner by a defined gate/date |
| Recovery | How to restore modified local resources without deleting user changes |

Do not invent a schema migration or always-on process just to test a context idea when an isolated fixture can answer it. Use the smallest path that exercises the real behavior. A mock can verify a contract, not prove real provider cost, model quality or OS cleanup.

## Isolation requirements

Experiments must not be imported by shipping entrypoints, discovered as advertised capabilities, included in production dependency bundles, or deployed as accessible DEV endpoints. A feature flag is not adequate isolation if the underlying module still executes at startup or its API remains callable.

Reuse production behavior through narrow interfaces instead of copying the implementation into the experiment. Keep fixtures read-only and exclude secrets/native private transcripts from checked-in evidence. Version providers/models/harnesses and record unavailable features honestly.

Prefer temporary workspaces for model-written code. Never reset a user's working repository or overwrite global harness configuration as routine cleanup. Where an experiment deliberately alters a file, record its original content/hash and merge or restore only when safe against subsequent edits.

## Closeout dispositions

### Promote

The capability passed its gate and is required by a release. Move it into the supported ownership tree; add behavioral tests, capability/error handling, docs, observability and compatibility. Remove the experimental flag/comparator where it is no longer needed. Retaining a useful regression fixture is promotion, not dead-code retention.

### Delete

Remove the failed/superseded implementation, unreachable branches, launchers, imports, dependency/lockfile entries, flags, temporary API routes, copied fixtures that test nothing supported, and CI scripts that exist solely to run it. Retain a compact decision and measured evidence, not an executable fallback nobody supports.

Persisted state needs a separate safe drain/removal procedure. Stop new creation, identify active owners and retained user data, migrate/reconcile references, verify compatible readers, then remove unused schema and cleanup code at the named gate. Never delete the canonical results of real work to make a revert easy.

### Transfer explicitly

Only when a specific next milestone genuinely needs the experiment. Record the receiving task, bounded remaining question, expiry/closure gate, dependencies and the intended deletion/promotion path. Keep it outside shipping imports/builds and production deployment. 'Maybe useful later' is not a transfer reason. The receiving milestone cannot close while the asset remains unowned.

## Initial M45 inventory to reconcile

This is an implementation inventory, not a claim that cleanup has occurred.

| Asset | Intended treatment | Owner |
|---|---|---|
| Selected Codex App Server adapter and canonical packet/event/fence paths | Promote supported portions after preview checks | M45.1 / 45.6 / 45.17 |
| `runtime-host/src/transports/codex_sdk_transport.ts` and comparator-only wrappers/tests/dependencies | Preserve measurement document; remove from shipping graph and delete unused comparator | M45.2 / 45.17 |
| `convex/runtime_host/spike_*` endpoints | Remove or isolate from deployment; promote only named real product capability under supported owner | M45.17 |
| Development-only web driver/observer and launch routes | Replace with preview product flow; remove inaccessible demo surfaces and verify production artifact | M45.17 |
| `fixtures/m45` | Keep fixtures that test the supported protocol; delete comparator-only/obsolete representations | M45.1 / 45.17 |
| Old persistent chat/Persona route-snapshot implementation | Migrate to current-Persona resolution; retain execution provenance and required historic decoding, delete superseded writers | M45.7 |
| Tiny Pi/ACP transport experiments | Promote in M53 or explicitly transfer, never advertised before support | M53.1–53.3 |
| Menu/tray foundations not needed by foreground preview | Named transfer to M54, excluded from unsupported packaged behavior | M54.1–54.2 |

Trace exact callers and dependency ownership before deleting a file. A prefix match is an inventory aid, not proof that every matching file is unused. Generated bindings and public-mirror packaging also need checking when endpoints or modules disappear.

## Release certificate

Every release certificate must include:

- artifact/version/commit and the actual user journey it adds;
- supported platforms, controllers, executors, modalities and limitations;
- checks executed, evidence links, unavailable toolchains and skipped checks;
- credentials, data publication and permission behavior;
- upgrade/rollback/uninstall and in-flight-work handling;
- the complete experiment manifest with final dispositions;
- confirmation that shipping imports/dependencies/routes contain no unowned experiment;
- retained data/schema cleanup owner and final removal gate where a safe staged drain is required.

A preview is a smaller supported release, not permission to defer pairing security, operation replay safety, cancellation, truthful usage or correct context. A cancelled conditional milestone records its decision and cleanup; it is not marked completed as though users received a feature.

## Value-first delivery

An independently useful correctness, compatibility, artifact, Persona or setup change should ship as soon as it meets its own release gates. It must not depend on a benchmark winning or carry an experimental SDK into the normal cloud path.

Do not repeatedly rework a proven release merely for a cleaner diagram. Follow the repository's evidence-first scope and critical-path stop rules in `AGENTS.md`. One focused content/link/diff check is sufficient for a documentation change unless an actual contradiction remains.


## M45 disposition — 2026-09-11

The SDK comparator/dependencies, old probe scripts, spike Convex endpoints and web observer are deleted. App Server is promoted as the single preview implementation. A bounded opt-in smoke exercises production adapter code and remains outside shipping entrypoints; package metadata verifies that old experimental imports are absent. Contract/process fixtures that protect supported behavior remain.

Persistent chat-route snapshot writers are retired. Historical schema/decoding is retained for existing records; M54.9 owns final removal after deployment reference/drain checks. No deployment data is deleted by this branch. Foreground CLI is the sole packaged owner; tray/native setup and other harnesses remain unimplemented, owned by M53/M54. See the [implementation review and release handoff](runtime-host-local-work-2026-09-11.md).
