# Client-Convex Contract

> NanthAI Edge has three product clients — iOS, Android, and web — backed by one shared Convex product API. Convex is the source of truth. Client UIs are thin rendering layers over shared backend behavior.

## Core Rule

For any product feature that exists on more than one client, the default implementation is:

1. expose the behavior in Convex
2. reuse the same Convex query/mutation/action on every client
3. keep client logic focused on presentation, local interaction state, and platform-specific affordances

Do **not** create separate client-specific business logic when the behavior can live in Convex.

## Canonical Gating

- Pro unlocks come from active rows in `purchaseEntitlements`.
- Runtime capabilities such as `mcpRuntime` come from `userCapabilities` / `accountCapabilities`. **Note (M27):** `sandboxRuntime` was removed — workspace and analytics tools are now available to all Pro users without an additional capability grant.
- Clients should use the Pro-specific preference query for Pro gating and `accountCapabilities` for runtime capability gating. Do not treat generic capability grants as a second Pro source.

## Intentional Gaps

- In-chat text search is intentionally not a shared product feature. Web can rely on the browser's native find-in-page behavior; iOS and Android do not provide a custom in-chat search UI.

## What Belongs In Convex

Put shared product behavior in Convex when it affects any of the following:

- filtering, grouping, sorting, default resolution, or eligibility rules
- derived labels, counts, statuses, or gating state
- capability checks, entitlement checks, and provider/tool compatibility rules
- reusable projections used by more than one client
- workflow state transitions (pending, approved, active, failed, archived, etc.)

Examples:

- pending memories use `isPending` from Convex, not per-client `status === "pending"` heuristics
- pinned chat ordering comes from Convex ordering fields and reorder mutations, not per-client local sorting rules
- default participant resolution belongs in Convex/preferences-backed data, not separate iOS/web/android implementations
- branch pill switching belongs in Convex (`chat/manage:switchBranchAtFork`), not per-client leaf-selection heuristics
- video generation progress, terminal status, and provider-facing failure details come from the shared `videoJobs` contract and message payloads, not per-client heuristics that suppress failed states or rewrite backend errors

## What Belongs In Clients

Keep client code limited to:

- rendering returned data
- platform-native navigation and layout
- local ephemeral UI state (expanded sections, focused field, open modal)
- platform input/output seams (photo picker, drag-and-drop, media recorder, haptics, push permission prompts)

Clients may adapt presentation, but they must not reinterpret shared domain rules differently.

## Reuse Rules

### 1. Reuse Existing Convex Functions First

Before adding a new query/mutation/action, check whether an existing function already covers the use case.

If a client needs one extra field or filter, prefer:

- extending the existing Convex function args or payload

instead of:

- creating a parallel client-specific function
- re-deriving the missing value locally

### 2. Standardize Shared Shapes

If two or more clients need the same derived field, add it to the backend payload explicitly.

Examples:

- `isPending`
- `pendingCount`
- `guidanceMatch`
- `accountCapabilities`
- `lastMessagePreview`

Avoid undocumented client-only interpretations of raw backend fields.

### 3. One Use Case, One Canonical Path

Each feature should have a canonical Convex path that all clients use.

Examples:

- memories list: `memory/operations:list`
- favorites list: `favorites/queries:listFavorites`
- model summaries: `models/queries:listModelSummaries`
- account capabilities: `capabilities/queries:getAccountCapabilitiesPublic`

If a second path is added for the same use case, document why the first path was insufficient.

### 4. Prefer Backend Args Over Client Post-Processing

If clients keep filtering the same list in the same way, add backend args instead.

Good:

- `list({ pinnedOnly: true })`
- `list({ limit: 50 })`
- `list({ includeArchived: false })`

Bad:

- three clients each fetch the broad dataset and implement slightly different filtering rules

## Review Checklist

For any new feature or bug fix, verify:

- is there already a Convex function for this use case?
- are iOS, Android, and web using the same function name for the same data?
- is any client deriving a shared business rule locally that should move to Convex?
- if a new backend field was needed, was the existing payload extended instead of inventing a new path?
- if one client changed behavior, did the other clients need the same backend change?

## Red Flags

Stop and rethink if you see any of these:

- a client introduces a new query for something another client already loads differently
- one client filters by `status`, another by `isPending`, and a third by string matching
- one client computes counts locally while another uses backend counts
- a bug fix is applied only in UI code when the actual rule is shared across platforms
- the same feature is named differently across clients because the backend contract is vague

## Preferred Change Order

When implementing or fixing a shared feature, use this order:

1. update Convex contract if needed
2. add or update backend tests
3. update iOS, Android, and web to consume the same contract
4. verify parity at the UI layer

## Documentation Requirement

When a shared feature adds or changes its canonical Convex path, document it in one of:

- this file, if it changes the general contract or introduces a new reusable rule
- the relevant feature doc in `docs/` or milestone spec, if it is feature-specific

The goal is simple: shared behavior should be solved once in Convex, then rendered consistently by every client.

## Error Format Contract

All Convex mutations and actions use structured `ConvexError` with a `{ code, message }` payload:

```typescript
throw new ConvexError({ code: "NOT_FOUND", message: "Chat not found" });
throw new ConvexError({ code: "UNAUTHORIZED", message: "Not authenticated" });
throw new ConvexError({ code: "FORBIDDEN", message: "Not the chat owner" });
throw new ConvexError({ code: "VALIDATION_ERROR", message: "Name is required" });
```

This replaced the previous `throw new Error(string)` pattern across ~370 throw sites. The `code` field enables programmatic error handling; the `message` field is user-facing.

### Cross-Platform Error Extraction

Each client has a dedicated extractor that unwraps the nested `ConvexError` JSON structure into a display-ready string:

| Platform | File | Usage |
|----------|------|-------|
| iOS | `Utilities/ConvexErrorExtractor.swift` | `ConvexErrorExtractor.message(from: error)` |
| Android | `data/ConvexErrorExtractor.kt` | `ConvexErrorExtractor.extractMessage(throwable)` |
| Web | `lib/convexErrors.ts` | `convexErrorMessage(error)` |

All three extractors handle the same nested JSON shape (`data.data.message` or `data.message`) and fall back to the raw error string when the structured payload is absent.

## Retry Contract

### What it is

Every assistant message stores a `retryContract` field — a read-only snapshot of the participant/config state that was active when the message was sent. Its shape:

```typescript
{
  participants: RetryParticipantSnapshot[],  // models/personas at send time
  searchMode: RetrySearchMode,               // "none" | "basic" | "web" | "paper"
  searchComplexity?: number,                 // 1 | 2 | 3
  enabledIntegrations?: string[],
  subagentsEnabled?: boolean,
  turnSkillOverrides?: { skillId: string, state: string }[],
  turnIntegrationOverrides?: { integrationId: string, enabled: boolean }[],
  videoConfig?: RetryVideoConfig,
}
```

### Client rules

1. **Read-only.** Clients must not write to or mutate `retryContract`. It is a backend-generated snapshot.
2. **Use as base config for retry.** When a user retries a failed message, clients should use the `retryContract` from the failed assistant message as the starting config — not reconstruct participants from current chat state. This prevents retries from silently inheriting chat-level changes made after the original send.
3. **Do not re-derive failure state from `message.status` alone.** Use `message.terminalErrorCode` for the canonical failure reason:
   - `"stream_timeout"` — generation exceeded the timeout budget
   - `"provider_error"` — upstream provider returned a hard error
   - `"cancelled_by_retry"` — a retry was initiated, so this generation was cancelled
   - `"cancelled_by_user"` — user explicitly stopped generation
   - `"unknown_error"` — unclassified failure
4. **All three clients use the same fields.** Do not invent per-client failure-classification heuristics based on status strings.

### Canonical Convex path

`retryContract` is assembled in `convex/chat/retry_contract.ts:buildRetryContract()` and stored by the send/retry mutations. There is no client-side equivalent — if a client needs any retry-related derived state, add it to the backend payload.
