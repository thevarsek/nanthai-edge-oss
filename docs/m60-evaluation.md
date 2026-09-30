# M60 evaluation and release

Status: labels and development thresholds explicitly approved by the user on 2026-09-30. Release code will be active for everyone after sign-off, without feature flags.

Experiment: test whether Jev can improve decision quality and helper latency/cost while keeping existing fallback, ZDR, evidence and lifecycle rules. Run the 23 synthetic cases below twice against Jev and the relevant existing path. No existing private chats are evaluation inputs. Live calls use the signed-in DEV test account; total spend ceiling is $10. Stop on credential/privacy failures or unexpected cost; stop well below the ceiling if quality misses the frozen target. Owner: this M60 task. Remove temporary DEV probe code after evaluation.

Approved thresholds, frozen before live evaluation: discussion 100% of these cases and zero false consensus stops; speakers 100%, zero missed required replies or invalid targets; memory at least 90%, zero wrong-target supersessions/deletions; moderator at least 75%. The original gate also required every slice to improve measured cost or latency. On 2026-09-30 the user accepted the additional selector latency, subject to preserving the memory timing ceiling. Inspection confirmed the 250 ms generation cache-wait allowance is unchanged: Jev reconciliation runs through the background post-generation extraction Workpool, outside that allowance. No timing ceiling was raised. Cost overhead remains recorded in the release report. These small samples establish a development gate, not broad statistical proof. Uncertainty counts as fallback and is reported separately.

| Case | Input | Expected result |
|---|---|---|
| d1 | SQLite explicitly meets a local prototype requirement; both agree with reasons | consensus |
| d2 | A/B preference repeats, measurements missing, positions unresolved | stalled |
| d3 | Speakers politely agree arithmetic matters but never calculate requested sum | continue |
| d4 | A costs $3, B $8, both identify A as cheaper | consensus |
| d5 | New benchmark reverses an earlier latency opinion | continue |
| d6 | Italian SQLite discussion agrees with substantive reasons | consensus |
| d7 | One favors shipping, another requires resolving a still failing test | continue |
| m1 | Short answers + evidence requesting concise explanations | reinforce old fact |
| m2 | Works at Acme + explicitly left Acme and now works at Beta | supersede Acme fact |
| m3 | General brief-answer preference + detailed legal research preference | preserve both |
| m4 | Lives in Rome + visiting Milan this weekend | ignore transient visit candidate; preserve residence |
| m5 | Uses Python + explicitly no longer uses Python | supersede old fact |
| m6 | Lives in Rome + “Could I move to Milan?” | ignore hypothetical candidate |
| m7 | English short-answer memory + Italian concise-answer preference | reinforce old fact |
| m8 | Two equivalent old memories plausibly match one new fact | ambiguous target; preserve facts separately, no automatic replacement |
| m9 | Explicitly forget Python preference | classify forget; existing deletion/cleanup mutation owns cleanup |
| c1 | Choosing by throughput with no supplied evidence | request evidence |
| c2 | Privacy/cost tradeoff remains unresolved | clarify tradeoff |
| c3 | Unsupported 100% conversion assumption drives forecast | challenge assumption |
| c4 | Fresh test results and implementation are progressing | no intervention |
| s1 | Human requests concise draft; writer owns writing | writer replies |
| s2 | Writer finished; no outstanding question or changed work | quiet |
| s3 | Writer hands changed draft to assigned reviewer | reviewer replies |

Full request states and rubrics: `convex/decisions/evaluation_cases.ts`. Additional deterministic tests cover malformed output, timeout, ZDR, unavailable speakers, frontier validation, conflicting judgments, pending approval, manual edits, pins, deletion, stale writes and replay.

DEV compatibility: shared DEV already contains M45 schemas and code. Deploy M60 as a three-way patch over the parked runtime branch in a temporary checkout, preserving M45 schemas, functions and data. The release branch stays based on main; the DEV overlay is not part of the production patch.

Release behavior: no feature flags. Every qualified integration is active for all users after release; transport/schema/uncertainty fallback uses the existing domain helper. Temporary DEV-only scoping in the deployment overlay protects unrelated runtime/test traffic and is excluded from the release patch. Rollback is a code revert/redeploy, retaining additive decode compatibility for stored statuses.

Measured results, validation, limitations and pending qualification decisions: [M60 release report](m60-release-report.md). Full synthetic comparison answers and all rubric rounds: [CSV](m60-live-comparisons.csv).
