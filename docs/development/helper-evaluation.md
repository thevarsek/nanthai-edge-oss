# Structured helper evaluation

Jev Decisions supplies bounded judgments for Collaboration speaker/reply targets,
autonomous consensus versus stalled repetition, moderator intervention and memory
reconciliation/explicit forgetting. Convex retains eligibility, ownership, replay,
validation, source admission and publication. Model judgments do not approve new
product policy or override human approvals.

## Runtime contract

The adapter uses the user's OpenRouter credential and effective zero-data-retention
policy. It validates bounded answers, has a timeout and no internal retry. Missing,
malformed, unavailable or uncertain output uses the existing eligible domain helper.
Decision request IDs are attributed separately from generation IDs; unknown cost
stays unknown.

Memory reinforcement/supersession preserves scope and provenance. Explicit forget
resolves an owned target through canonical deletion/embedding/relationship cleanup;
inferred contradiction does not authorize hard deletion. Existing approval, pins,
manual edits and preferences remain authoritative.

## Evaluation method

Use human-labelled cases for false consensus, stalled repetition, required replies,
moderator evidence and memory identity/scope. Separate selector latency from whole
helper latency and from user-visible time to first token. Deterministic tests cover
malformed output, timeout, privacy, ownership, stale edits/deletion and replay.

A repeated tuned development corpus is not an independent holdout. Preserve failed
rubric rounds, uncertainty behavior, attributable spend and unknown costs. Historical
results and deployment limits are recorded in
[Jev integration](../../milestones/M60-jev-integration.md). Reusable cases remain in
`convex/decisions/evaluation_cases.ts`; raw reports do not belong in `docs/`.
