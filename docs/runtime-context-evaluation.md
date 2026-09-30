# Context advantage evaluation protocol

> Owner: M53. Status: protocol only; no paid experiment has run as part of this documentation update.
> Recorded screening proposal: $25 incremental metered inference total, separate from the approved M60 testing budget. This document does not authorize spending; confirm a runtime-evaluation budget and supported account/environment before dispatch.

## Questions in order

1. Does NanthAI-prepared context improve a strong existing coding harness on a relevant development workflow?
2. What additional value comes from a code-intelligence source rather than from NanthAI assembly?
3. Later, does a native NanthAI loop improve on the best external harness plus the same context?

M53 answers the first two. It does not build a native worker to answer them. M57 owns the third only after an explicit entry decision. Passing a contract test is not passing the product hypothesis.

## Task selection and leakage control

Choose one small/medium real multi-file task at a pinned repository revision with executable acceptance tests. Include an accepted human correction, a useful previous investigation/test result, one genuinely superseded fact and a resumed or fresh-executor implementation step. Avoid a contrived corpus full of nonsense that a normal user would never supply.

Prepare the context corpus before any run. The same underlying task information, source tree and allowed evidence are available in each comparison. Keep hidden grading tests and the expected implementation outside agent-visible context. The grader may accept different correct edits; it must not demand one exact patch or reward touching too few files.

Use independent clean workspaces/native sessions and block access to other arms' artifacts. Record the actual base revision, dirty-tree state, generated files, dependency cache and tools. A task completed during setup cannot contaminate the candidate index or later prompt. Optional cold/short-history control helps identify when context overhead is not worthwhile.

## Comparison matrix

| Layer | Comparison | What can be inferred |
|---|---|---|
| Within Codex | Ordinary Codex versus same Codex with NanthAI context | Context/delivery effect within the pinned executor, subject to native visibility |
| Within Pi + OR | Ordinary Pi versus same Pi/model/provider with NanthAI context | More controllable context and metered-cost comparison |
| Within Copilot CLI | Ordinary Copilot versus same supported CLI with NanthAI context | Within-executor context effect; unavailable account/API is not an experimental failure |
| Source ablation | Baseline, baseline + chosen source, source + NanthAI | Distinguishes code-indexing contribution from conversation/evidence assembly |
| Later native | Best external + NanthAI versus native + same context/source | Incremental inner-loop benefit; belongs to M57 |

Cross-harness scores with different models/providers are product comparisons, not causal evidence for context superiority. Fix model, reasoning effort, sampling, tool availability, permissions, Persona text and repository inputs within each pair wherever observable. Record any setting the provider will not expose. Pin the Persona for the evaluation run as an input record; this does not reintroduce persistent Persona snapshots in the product.

## Session history and transport controls

Test continued-session and fresh-handoff cases separately. In a continued baseline, let the harness use its ordinary native history, caching and compaction; do not force an inflated transcript on every request. In the fresh-handoff case, supply a reasonable complete task/history package from the same corpus, compared with selected NanthAI evidence.

If introducing the NanthAI adapter changes message delivery independently of selection, include a small pass-through/no-selection control before attributing gains to the assembler. If native retained context cannot be inspected or replaced, record that limitation and verify injection points; do not claim shorter supplied text means the internal context shrank.

Capture three different things: prepared context; actual submitted adapter payload; reported request usage/native context events. They are not automatically identical. Prompt caching, native hidden instructions, retries, provider routing, summaries and source calls can change the final cost. A fresh reset may reduce context length yet lose cheap cached tokens.

## Budget and run scheduling

The $25 cap includes paid context summarization, code enrichment, provider attempts, retries and model judging. Treat Convex/compute overhead as a separately reported infrastructure component, not invisible zero cost. Subscription-backed Codex/Copilot use is reported in provider quota/requests; API-equivalent prices are estimates and never added as actual bills.

Before the first paid request, read current provider pricing and set per-run input/output/time limits plus a pessimistic remaining-cost reserve. Serialize the small screening matrix or reserve costs atomically; delayed usage reports cannot justify overspending. Stop launching new work when the reserve would exceed the envelope. Refunds/unknown usage require reconciliation before claiming remaining budget.

Aim for repeated matched pairs, normally two or three when affordable. Run a cheap calibration first. If the matrix will not fit, narrow it or report an unrun arm; do not weaken correctness checks or use an unapproved extra budget. The code-source bake-off can begin with deterministic retrieval/freshness queries without paid generation.

One bounded diagnosis/improvement/retest is allowed only within unused budget or after a separately approved increase. Define the modification and keep the original results. Do not choose the best seed or extend until the hypothesis passes.

## Required measurements

Primary outcome is correct completion against acceptance and regression tests. Then report human interventions, unnecessary changes judged against requirements, time to accepted result, whole-run uncached/cached input and output tokens, paid provider cost, and known infrastructure overhead.

Measure repeat reads/searches and discovery before the first correct edit as diagnostics, not success substitutes. An agent may need a fresh read because code changed; distinguish justified revalidation from waste. Record stale-fact mistakes and exact requirement retention.

For code intelligence, record cold index time/size, warm query latency, source freshness after uncommitted edit/rename/delete, returned token/byte volume, location accuracy, unsupported languages, external network/telemetry and install side effects. A compiler/LSP test may require installed project dependencies; note the condition.

Store adapter/provider versions, effective request settings, code-source versions, accepted source state, context hashes/omissions, usage sources, warnings, completion status and grader results for every attempt. Unknown is a valid measurement value; do not backfill reported model identity from the user's selected model.

## Decision procedure

Before reading results, choose target dimensions and correctness/reliability guardrails for this task. Avoid post-hoc universal percentage thresholds. After the screen, report each paired result, effect size, variation and limitations. A handful of runs cannot establish general statistical superiority or a production reliability rate.

- Positive: repeatable product-significant benefit in the scoped workflow without a material correctness/reliability regression. Propose the smallest M56 feature that uses it.
- Inconclusive: insufficient runs, price/usage visibility, task stress or adapter control. Diagnose one bounded issue and retest if authorized; otherwise retain an honest hold decision.
- Negative: no relevant benefit or worse correctness/cost. Simplify or suspend the optimization; preserve basic context correctness and the independently useful multi-harness release.

All outcomes retain the original result set and avoid marketing unsupported generalizations. A new native hypothesis remains a separate M57 decision, not an automatic reward for a positive context screen or an emotional response to a negative one.

## Evidence package

Keep a small manifest, input-corpus hashes, source revision, tool/model configurations, per-run outputs and usage ledger, grader commands/results, paired summary and go/hold/no-go rationale. Redact credentials and do not publish private source/native transcripts without authorization. Record retained evidence location and retention scope.

Reuse test-container/evaluation patterns from [Harbor](https://github.com/harbor-framework/harbor) and [SWE-bench](https://github.com/SWE-bench/SWE-bench) only where they reduce work. This screen does not require building a new benchmarking service.

The [research register](runtime-research.md) covers Graft, Serena, repo maps, provider caching and supported harness interfaces. The [experiment policy](runtime-experiment-policy.md) governs cleanup of launchers, temporary schema, indices, configuration changes and copied dependencies.
