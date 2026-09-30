# Persistent conversation compaction: audit and M59 contract

> Reviewed 2026-09-18. Static source audit of M45 branch `fb6b1c811ccafe8dfd140d188a1a35e5439babd7`, compared with main `68e23215a7fdc3a58f5c56a8408073bb4fa69166`. No runtime tests or production-data checks were run for this documentation change.
> Follow-up 2026-09-30: the ascending `.take(5000)` query and ordinary tool-loop compaction distinction remain visible on main `17ffd001`. This focused static recheck measured no production incidence and reran no runtime tests.
> Target owner: [M59](../milestones/M59-telegram-persona-conversations.md). This document separates current behaviour from proposed implementation.

## What the current source does

| Path | Verified source behaviour | Consequence for long conversations |
|---|---|---|
| `convex/chat/actions_run_generation_context.ts` → `queries_handlers_internal.ts:listAllMessagesHandler` | Loads ascending chat messages with `.take(5000)` | After the cap, newer messages including the generation anchor can be absent. This is a reachable growth condition; production incidence was not measured. |
| `convex/chat/helpers.ts:buildRequestMessages` → `helpers_utils.ts:truncateMessages` | Walks parent ancestry, optionally expands sibling responses, projects roles/content, then applies an estimated token budget | Excess messages are skipped by the budget selection. No persisted conversation summary is loaded on this path. A missing excluded assistant anchor returns an empty request array. |
| `actions_context_assembly_integration.ts` → `context_assembler.ts` | Adds authorised tool memory/artifact/MCP context to the prepared messages | Useful retrieval, but it does not supply a durable summary covering the omitted ordinary conversation. |
| `actions_run_generation_loop.ts` / `compaction.ts` | Tool-loop overflow/timeout handling prunes older outputs or summarises the full loop conversation; the helper rebuilds system prompt, summary and last user input | Compaction exists inside an execution. Simple non-tool completions return without that cycle. It is not the cross-turn summary cursor required here. |
| `schema_tables_core.ts` generation continuation records | `requestMessages`, assembled checkpoints, counts and fence fields preserve execution continuation state | Recovery of an in-flight execution is distinct from selecting a summary on the next human turn. Do not revive legacy orchestration because compatibility names remain. |
| `runtime_host/chat_dispatch_context.ts` | Uses the same history builder and then prepares a local packet | Local delivery inherits upstream history selection. Source omission is rejected by `production_packet_content.ts`, rather than knowingly materialised as a valid empty turn. |
| `runtime_host/context_receipt.ts` | Checks policy/instructions/capabilities and ordered message ID/content hashes; a removal/change prevents reuse | This is a useful existing reset seam. It does not itself summarise history. |
| `runtime-host/src/codex_worker_backend.ts` / `native_context_reuse.ts` | Verifies expected native frontier, otherwise replaces the native session; compatible reuse filters already-delivered message IDs | Preserve this machinery. Summary replacement must become a proven context transition, not an appended instruction to ignore old history. |

The ordinary history query, truncation helper, compaction engine, generation-loop wrapper and their reviewed compaction tests have identical blobs on main and the branch. Local receipt/frontier logic is branch work. Header comments describing ordinary chat as “middle-out” are not the behavioural authority; the executed helper performs budget-based message selection.

Conclusion: the existing code has reusable execution compaction and native continuity components, but the audited ordinary-turn path does **not** establish persistent summary-plus-uncovered-history semantics. M59 must implement or verify that shared contract after taking the latest main. This finding is not a claim that every old detail can be retained verbatim in a lossy summary.

## Required context contract

For a prepared turn at authorised causal frontier H:

`effective context = current instructions + committed summary S through frontier F + all eligible raw messages after F through H + authorised selected memory/artifacts`

Before the first summary, the raw history begins at the conversation root. Coverage is an ordered lineage/causal boundary, not a timestamp-only offset or Telegram message number. The summary and raw tail must not leave a hole or represent the same covered messages twice. System/persona policy is resolved separately; a summary of user conversation cannot grant capabilities or become system authority.

“All eligible” means all messages allowed by the selected branch, participant and visibility rules. Policy exclusion is recorded; a token cap must not silently reclassify uncovered messages as excluded. Raw history remains canonical and readable/searchable under authorisation. Exact quotations or omitted detail require source retrieval, not a claim that the summary preserves everything.

## Proposed persisted state

Use a shared conversation-domain owner, not channel tables or a host transcript. Proposed records contain:

- Chat, branch/lineage and participant/visibility scope; policy/source revision; immutable summary version/ID and previous-summary reference.
- Coverage start/base and committed end frontier, plus bounded source manifest or digest with resolvable message IDs. Store large manifests/text in domain storage; do not build an ever-growing ID array in Workflow history or a single row.
- Summary text and references to relevant source/artifact records; known omissions; protected unresolved work and decisions. Preserve corrections, ownership and uncertainty.
- Summariser model/config, input/output usage, creation time, status, attempt/fence and idempotency key. A scope has one atomically selected committed head.

Extend the prepared-turn evidence and native context identity with summary version, coverage frontier and source/policy revision. Durable active executions retain their captured version/tail snapshot on replay; a new logical turn reads the latest valid head. Revocation/deletion still invalidates access immediately.

## Trigger and publication algorithm

1. Resolve current persona/route and authorised causal frontier. Read a valid committed summary and page the uncovered branch history, including the current user input and assistant anchor. Never load only the oldest fixed-size chat prefix or replace that with a newest-only slice that loses the middle.
2. Budget the full request: instructions, selected memory/artifacts, raw tail, tools, media and output reserve. Use observed provider usage when available and conservative estimates before dispatch. Local routes use known negotiated limits or a documented conservative bound. Telegram character length is unrelated to model context capacity.
3. Below the trigger, reuse the same summary unchanged. A new ordinary message does not schedule a summariser. Native delta delivery and API prompt caching are separate from summary generation.
4. When needed, choose a stable completed prefix of the uncovered history; protect the current input, recent complete turns and unresolved tool call/result pairs. Compact `previous summary + newly covered prefix`, not every original message since the beginning. Choose enough headroom to avoid immediately triggering again; configure thresholds/reserve at the shared owner and test the boundary.
5. Create/adopt an owned fenced compaction operation keyed by scope, previous version, target frontier and source revision. A replay reuses its committed result. A very large uninitialised conversation is bootstrapped in bounded pages/chunks with explicit progress through one durable workflow, not an oversized provider call.
6. Publish the replacement summary and coverage atomically after verifying the old head, source revision and authority still match. A competing stale result cannot move the head backwards. Messages appended during summarisation remain after the fixed target frontier and are reloaded into the tail.
7. Reprepare against the committed summary and all remaining eligible tail messages. If there is still too much protected content, surface a bounded context-limit error or an explicit recovery choice. Do not fall back to arbitrary message dropping. Never return the compactor's empty-summary placeholder as a successful persistent summary.

At most one summary version is committed for a given idempotency key. External summarisation requests may have an unknown result after a crash; do not promise exactly-once provider billing. Record attempts/cost and use the existing effect/recovery policy.

On failed/cancelled compaction, retain the prior committed head. Continue only if the complete valid context fits; otherwise pause/fail with a retry path. No uncovered cursor advances on failure. Ordinary action-duration continuation is not a reason to regenerate the cross-turn summary; reuse existing in-flight recovery checkpoints independently.

## Branches, edits and permissions

- A fork may reuse a summary only when its coverage is wholly within the new authorised ancestry. Otherwise rebuild the applicable prefix from raw history. Do not import a sibling's private messages.
- Edits/deletions within covered history invalidate the affected source revision; reprepare or rebuild before further use. Invalidation covers in-flight publication and cached native sessions, not just future database reads.
- Keep summaries scoped to the visibility/participant policy that produced them. Shared conversation memory and persona-wide memory are different objects.
- Summary publication never deletes canonical messages. Chat/account deletion and access revocation cover summaries, stored manifests, pending compaction jobs and delivery bindings through existing teardown.
- Do not turn the current helper's per-message 8,000-character summariser truncation or text-only media projection into silent source coverage. Large sources need bounded chunking or explicit referenced omissions; current media/artifact IDs remain retrievable.

## Codex and native compaction

Same summary version plus appended tail: reuse the native session only if existing receipt and native-frontier checks pass; send only authorised undelivered context, with the source input exactly once.

Changed summary/coverage replaces old context. Prefer the existing receipt-based fresh-session path, seeded with summary plus complete uncovered tail, and a visible reset reason. Only use in-place context replacement if the supported adapter proves equivalent removal. Never append a new summary to stale history and claim the old material vanished. Stable canonical participant/chat identity survives a native reset.

Include summary version/coverage in compatibility evidence so even an identical summary text with a different boundary is not mistaken for unchanged context. Commit delivery receipts only at acknowledged fenced boundaries; an unacknowledged packet or summary is not “delivered”.

Codex may compact its private native session independently. That event does not prove a NanthAI coverage boundary and must not advance the canonical summary cursor or cause replay of already-delivered raw messages. Preserve compatible native state where verifiable; otherwise visibly rebuild from canonical summary/tail. Test native compaction and canonical compaction separately. Never export hidden native reasoning as canonical history.

## Required regressions

| Case | Required assertion |
|---|---|
| Below threshold | Many new turns reuse one summary version; zero extra summariser calls |
| First threshold crossing | One committed summary covers an exact completed prefix; newest input and all uncovered messages remain |
| Second crossing | Summariser receives the prior summary plus only the newly covered prefix; new head references the previous version |
| New turn/restart/interface switch | Telegram and NanthAI reconstruct the same authorised summary/tail; a fresh worker does not lose summary state |
| Over 5,000 raw messages | A 5,001+ fixture includes the current assistant anchor/user input, all eligible uncovered history or explicit compaction progress, and no fixed-prefix truncation |
| Concurrent appends/duplicate triggers | Fixed coverage frontier; later arrivals survive; stale publisher rejected; one committed version |
| Failed/empty summary, cancellation, crash/replay | Previous head and raw history retained; no cursor advance or duplicate accepted turn; costs tracked |
| Fork/edit/delete/revocation | Valid ancestry only; stale summary/session rejected; no cross-user/private-sibling leakage |
| Budget accounting | Include instructions/tools/media/output reserve; an oversized protected tail gives a visible failure, not missing messages |
| Tool-loop compaction then later turn | In-flight recovery survives; later canonical context uses the shared summary owner; no second channel-specific summary |
| Native resume/reset | Same version sends missing tail only; changed summary seeds a fresh session exactly once; receipt is committed after acknowledgement |
| Native private compaction | Does not change NanthAI coverage; native mismatch uses established reset without losing canonical tail |

Use deterministic fake summariser output with source sentinels and captured prepared requests/packets. Assert IDs/order, scope, call counts, committed versions, retries and recovery; do not infer correctness merely from a fluent model answer. Separately run a small real long-thread journey with an early constraint, a later correction and a tail-only instruction, recording summary quality limitations and actual cost.

## Scope boundary

This is baseline conversation continuity, not the M53 context-superiority experiment or M56 context-engine extraction. Validate the shared path on DEV for the M59-supported conversations across every client, then include it in the approved public release without audience feature flags. Existing short chats remain compatible. The original source can bootstrap missing summaries without bulk rewriting every chat. Keep the old in-flight recovery path until its required behaviour is covered; do not delete it as a presumed duplicate.
