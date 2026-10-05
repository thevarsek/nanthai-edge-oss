# Context evaluation

## Purpose

Measure whether NanthAI context improves a relevant whole task through an existing
harness. Separate context selection, adapter transport, code retrieval and model
answer quality. An owned executor is a separate product investment, not the
automatic response to a failed answer.

## Reusable suite

[`evals/runtime-context/`](../../evals/runtime-context/README.md) owns frozen cases,
registrations, graders, reports and sanitized comparison data. Reusable machine
inputs and outputs belong there, not in documentation. Private provider sessions,
credentials, receipts and raw traces stay outside the repository.

For matched comparisons, use the same model, reasoning, source facts, task checks
and harness on each route. Native baselines receive the public facts available to
NanthAI. Include continued work, handoffs, corrections and superseded facts. Grade
required facts, generated code, artifact contents and typed formats separately.
Hidden graders enter the isolated workspace after inference.

## Registration and accounting

Register cases, source revision, settings, budgets, stop conditions and acceptance
before inference. Keep every attempt and failed-work cost. Normal native recovery
must be accounted equally on both routes; evaluator retries are not favorable new
samples. Keep interrupted or authentication-failed cohorts separate from complete
answer-quality comparisons.

Usage belongs to exact owned sessions and native children. Unknown reasoning or
cost remains unknown. API-equivalent catalogue estimates are not subscription
invoices. Compare time/tokens only among accepted matched pairs, showing the
denominator, all-attempt totals and regressions.

## Reporting

Run deterministic fixture and saved-evidence checks before new inference. Export
only complete, audited, sanitized outcomes. Preserve original grades and apply any
rubric correction uniformly. A public example needs precise scope and owner review;
no cherry-picked or bug-affected cohort should stand in for the complete comparison.

The accepted study's outcomes, limitations and completion history are in
[context continuity and evaluation](../../milestones/M56-context-engine-handoffs.md).
The earlier bounded source screen is in
[multi-harness qualification](../../milestones/M53-multi-harness-runtime.md).
The [experiment rules](runtime-experiment-policy.md) govern any new investigation;
a completed historical budget is not permission to start another run.
