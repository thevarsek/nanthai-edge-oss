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

## Google Data Protection Scope

Google Workspace integrations require protected provider routing for model calls that can receive direct Google Workspace data, including the main generation/tool flow and same-turn retrieval work that is part of that protected context. This Google-derived protection requirement is not transitive to later helper calls that only process assistant-generated prose or ordinary chat metadata.

Title generation, memory extraction, and text-to-speech/audio generation may use normal helper routing for Google-derived prose unless `userPreferences.zdrEnabled === true` or a helper-specific ZDR requirement is explicitly passed. Do not treat the absence of Google-derived `provider.zdr` on those helper paths as a privacy regression unless the helper starts sending raw Google payloads, Google tool artifacts, or direct Google API responses.

## Intentional Gaps

- In-chat text search is intentionally not a shared product feature. Web can rely on the browser's native find-in-page behavior; iOS and Android do not provide a custom in-chat search UI.

## What Belongs In Convex

Put shared product behavior in Convex when it affects any of the following:

- filtering, grouping, sorting, default resolution, or eligibility rules
- derived labels, counts, statuses, or gating state
- capability checks, entitlement checks, and provider/tool compatibility rules
- reusable projections used by more than one client
- workflow state transitions (pending, approved, active, failed, archived, etc.)

### Bounded document comparisons (M40)

M40 is backend-only and stays in the ordinary chat contract. The existing
`document-review` skill lists the documents scoped to the chat, proposes
comparison columns, discloses `documents × columns` work units and PAYG cost
drivers, then waits for a separate explicit confirmation. After confirmation it
uses the existing document tools in one bounded tool loop and returns a cited
Markdown preview plus a normal `generate_xlsx` file artifact. Clients require no
comparison-specific route, DTO, state machine, or renderer.

### XLSX thin-client contract

Spreadsheet improvements remain backend-only and retain the existing
`generate_xlsx`, `read_xlsx`, and `edit_xlsx` tool IDs. `read_xlsx` ownership
checks the requested storage object and returns bounded sheet/range pages;
targeted `edit_xlsx` operations preserve unrelated workbook parts, while full
sheet replacement is an explicit rebuild fallback. Workbook typing, formulas,
styles, validation rules, recalculation flags, and package QA are backend
concerns and must not be re-derived by clients.

Generated or edited XLSX output remains an ordinary `generatedFiles` artifact.
When server-side validation succeeds, its companion PDF is added through the
same existing generated-file extraction and subscription path. It has the
normal PDF filename/MIME/storage fields, not an XLSX-specific client DTO or
route. Released iOS, Android, and web clients therefore render the workbook and
preview as the generated-file cards they already support; a preview failure is
reported as an additive tool warning and never invalidates the primary XLSX.

Presentations follow this rule across web, iOS, and Android. Creation and
iteration run through the normal chat tool loop and generated-file lifecycle.
Projects, slide order, provenance, revisions, AI operations, and validation live
in the shared `presentations/*` Convex domain; each client branches its existing
chat file-preview surface for rendering and platform export. See
[`presentations.md`](presentations.md).

### Presentation thin-client contract (M41)

- `presentations/queries:getProject({ projectId })` is the canonical owned
  projection. It returns the authoritative project/revision, ordered slide
  records/revisions, project-allowed asset metadata and URLs, and the current
  snapshot URL. A missing or foreign project returns `null`.
- Chat creation and AI iteration stay in the ordinary tool loop through
  `create_presentation`, `read_presentation`, and `edit_presentation`. Clients
  never create a second AI transcript or call model helpers directly.
- A selected target is sent only through the normal user-message contract as
  `{ projectId, projectRevision, slideId?, slideRevision?, elementId? }`.
  Convex re-authenticates all IDs and checks revisions; context is not an access
  grant.
- Direct edits use `presentations/mutations:saveSlide` with the current slide
  revision. The returned project and slide revisions replace local values.
  `REVISION_CONFLICT` means reload/reselect; clients must not merge or retry the
  stale HTML silently.
- Safe slide HTML may reference images only as `asset:<storageId>`. The ID must
  be listed in the project payload. Clients resolve it to that row's temporary
  URL only while rendering/exporting and restore the canonical placeholder
  before saving.
- A high-fidelity client export uploads a valid PPTX and calls
  `presentations/actions:persistSnapshot` with the matching project revision.
  Convex validates ownership, PPTX package structure, size, and revision before
  replacing the project snapshot and linked generated-file blob.
- Project-backed presentation cards open the normal file side panel instead of
  downloading the initial fallback snapshot. Each client should expose one
  authoritative PowerPoint action derived from its current rendered revision,
  then persist those same bytes through `persistSnapshot`; it must not present
  fallback and current-canvas downloads as equivalent choices.
- `read_pptx` is the ownership-gated import seam. It exposes text/notes plus
  layout, normalized geometry, theme, backgrounds, and registered reusable
  embedded images for an interpreted rebuild. It is not a lossless editing API.
- AI edits are applied in Convex as explicit stable-ID patch operations with
  outside-target validation. Clients consume the resulting revisions; they do
  not reproduce patch semantics locally.
- Model-authored generation is also layout checked in Convex: absolute text
  boxes, including nested siblings, carry explicit bounds, wrapped height is
  estimated, and obvious containing-region overflow or text overlap enters the
  bounded repair path. A structurally safe candidate keeps its valid slides;
  Convex repairs only the identified slide through bounded style-only patches
  in fresh actions, then revalidates the entire deck. One assistant turn owns
  at most one presentation-creation project, so clients never reconcile
  competing same-turn retries.
  Clients do not add a separate layout-acceptance rule.
- Stateful PPTX/DOCX creation and editing are single-participant operations.
  Convex derives the triggering turn's participant count from the scheduled
  assistant group and rejects mutating artifact tools when that count is above
  one. Clients may preflight explicit staged targets, but must not reproduce the
  rule with natural-language intent classification.
- Existing PPTX/DOCX edits are unavailable from Ideascape turns. Ideascape may
  load the bounded, ownership-gated `chat/queries:getGeneratedFilesByIds`
  projection for visible message artifact IDs and open existing preview
  surfaces. It does not create an editor transcript or grant write authority.
- `edit_presentation` without an explicit/typed project target fails when more
  than one ready presentation exists in the chat. Clients must prompt the user
  to open and stage the intended artifact rather than choosing a branch-wide
  "latest" file.
- Whole-rewrite `edit_docx` finalization compares the original storage-backed
  version with `documents.currentVersionId`. `SUPERSEDED_VERSION` is terminal
  for that attempt; clients reload/reselect instead of treating the generated
  bytes as the new canonical version.

iOS and Android now consume these same paths and shapes. Their native preview
surfaces resolve only payload-owned assets, expose explicit view/select/edit
state, stage the same typed chat context, use revision-checked saves, generate
PPTX/PDF or print output through platform web renderers, and refresh the
revision-matched PPTX snapshot. They do not introduce a presentation route,
library, wizard, mode, or platform-specific business rules.

Native Ideascape renders compact artifact rows backed by one bounded
`getGeneratedFilesByIds` subscription per canvas. PPTX opens the same native
presentation preview read-only; DOCX/PDF retain the existing document preview.
Existing PPTX/DOCX AI edits remain a normal-chat operation on every platform.

Examples:

- pending memories use `isPending` from Convex, not per-client `status === "pending"` heuristics
- pinned chat ordering comes from Convex ordering fields and reorder mutations, not per-client local sorting rules
- default participant resolution belongs in Convex/preferences-backed data, not separate iOS/web/android implementations
- branch pill switching belongs in Convex (`chat/manage:switchBranchAtFork`), not per-client leaf-selection heuristics
- video generation progress, terminal status, and provider-facing failure details come from the shared `videoJobs` contract and message payloads, not per-client heuristics that suppress failed states or rewrite backend errors

## OpenRouter Image and Advisor Contract

- Convex owns dedicated image discovery (`/images/models` plus endpoint details),
  generation (`/images`), storage, stale-row pruning, and error normalization.
  Clients consume `listModelSummaries` and shared message/media payloads only.
- Image-output models never use chat completions. Text-only orchestration rejects
  media-output models; configurable title and memory helpers fall back to known
  text defaults for image, video, audio-output, or missing selections.
- Convex owns branch-aware image-reference projection. Current attachments and
  explicitly selected Ideascape parents take precedence, same-model branches
  remain distinct, older branch-local generated images survive intervening text
  turns, and cancelled/failed or inactive-branch images are excluded. Clients
  must not rebuild or resend generated images as ordinary attachments.
- Forked and duplicated chats retain assistant `imageUrls` and the backend-owned
  retry snapshot, including `imageConfig`, so copied image turns keep their
  original retry behavior.
- Successful image arrays are index-aligned: `imageMimeTypes[index]` describes
  `imageUrls[index]`. Clients prefer that explicit MIME value over URL suffix
  inference, including for SVG served from opaque storage URLs. The optional
  message-level `imageGenerationExpectedCount` is the model-capability-adapted
  request count used by every pending placeholder; clients must not display the
  raw global default as an executable count. The optional
  `imageGenerationResult` contains backend-authored `requestedCount`,
  `generatedCount`, and `failedCount`; all clients render the same localized
  partial-success state when at least one, but not every, requested image was
  stored.
- A saved/retry model ID missing from the authoritative catalog fails with
  `MODEL_UNAVAILABLE` before transport instead of being guessed as a text model.
- `listModels`, `getModel`, and `listModelSummaries` expose one canonical
  `mediaCapabilities` projection for image and video generation. Clients render
  these backend-authored arrays and booleans instead of re-deriving support from
  provider names. Image count enums are exposed as the exact `image.counts`
  array. `countMin`/`countMax` describe true continuous ranges and remain as a
  compatibility envelope for discrete enums so older clients keep rendering
  useful count information. New clients prefer `counts` when it is non-empty.
  Convex resolves a saved generic count to an advertised value before transport.
  Explicit image `isAvailable: false` overrides legacy
  `supportsImages`/architecture metadata; hybrid models retain only their
  remaining text role. Image capabilities are the safe intersection across all
  current OpenRouter endpoints. Full endpoint records remain retained for
  future routing, but clients use only the canonical projection until OpenRouter
  documents Images request endpoint pinning.
- Persona Advisors are a shared Pro orchestration contract, not a Skill or tool
  profile. Convex owns kept assignments, eligibility, Persona resolution,
  Responses API runs, streaming state, branch-aware history, the completion
  barrier, hidden-note injection, retry reuse, and cost accounting. Clients send
  only Persona selections, keep/web toggles, and an optional brief; all sibling
  text participants share the assistant message `advisorBatchId` and consume
  the same batch exactly once. ZDR, Google-protected, scheduled, autonomous,
  and media-output turns cannot consult Advisors. An omitted
  `advisorSelections` field inherits kept assignments, while any supplied array
  is the exact turn snapshot (`[]` means no Advisors); clients must preserve
  that distinction for queued sends. A kept assignment's canonical
  `isAvailable`/`unavailableReasonCode` state remains visible and removable but
  unavailable Personas are excluded from turn snapshots. A full-replacement
  save may retain an already-kept unavailable assignment but may not introduce
  a new one. `cancelBatch` stops unfinished consultations only; completed notes
  remain usable and the main response continues. Clients show Stop only while
  at least one consultation is unfinished, not during synthesis or after a
  terminal batch. Advisor SDK/provider errors are sanitized before persistence
  and again in the public projection. Clients never render raw request,
  transcript, Persona, memory, brief, or tool payloads; an omitted unsafe
  `errorMessage` uses the platform's localized terminal fallback.
- Clients persist only the seven generic `defaultImage*` preferences through
  `preferences:upsertPreferences` (`null` clears a field). Convex resolves them
  against the selected model's cached image capabilities. Ordinary sends and
  retries never send a client-composed `imageConfig`.

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

## M35/M36 Client Boundary Note

The M35 ownership splits were client-internal and did not create alternate product APIs. iOS owners, web route helpers/domain hooks, and Android route owners must continue to consume the same Convex functions for the same use case.

The M36 UI parity pass introduced shared status/tone semantics and skill catalog cleanup, not client-specific business rules. Status tone helpers are presentation mapping only; capability, default-skill, integration, and removed-system-skill cleanup decisions remain backend-authored.

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

Thrown action/mutation errors and persisted failed assistant messages are
separate seams. Convex now normalizes new generation failures before storing
assistant `content`/`error`. Clients recursively unwrap historical
`message`/`error`/`data` JSON only when rendering failed assistants, and must
preserve the raw value for unknown or malformed legacy formats.

## Retry Contract

### What it is

Every assistant message stores a `retryContract` field — a read-only snapshot of the participant/config state that was active when the message was sent. Its shape:

```typescript
{
  participants: RetryParticipantSnapshot[],  // models/personas at send time
  searchMode: RetrySearchMode,               // "none" | "normal" | "web" | "paper"
  searchComplexity?: number,                 // 1 | 2 | 3
  enabledIntegrations?: string[],
  subagentsEnabled?: boolean,
  turnSkillOverrides?: { skillId: string, state: string }[],
  turnIntegrationOverrides?: { integrationId: string, enabled: boolean }[],
  videoConfig?: RetryVideoConfig,
  imageConfig?: RetryImageConfig,          // backend-owned default snapshot
}
```

### Client rules

1. **Read-only.** Clients must not write to or mutate `retryContract`. It is a backend-generated snapshot.
2. **Use as base config for retry.** When a user retries a failed message, clients should use the `retryContract` from the failed assistant message as the starting config — not reconstruct participants from current chat state. This prevents retries from silently inheriting chat-level changes made after the original send. `imageConfig` remains backend-owned and is replayed by Convex; clients do not copy it into retry arguments.
3. **Do not re-derive failure state from `message.status` alone.** Use `message.terminalErrorCode` for the canonical failure reason:
   - `"stream_timeout"` — generation exceeded the timeout budget
   - `"provider_error"` — upstream provider returned a hard error
   - `"cancelled_by_retry"` — a retry was initiated, so this generation was cancelled
   - `"cancelled_by_user"` — user explicitly stopped generation
   - `"unknown_error"` — unclassified failure
4. **All three clients use the same fields.** Do not invent per-client failure-classification heuristics based on status strings.
5. **Research Paper is a first-class retry mode.** `paper` retries restart the
   durable research workflow from the original user message. They must never
   fall through to ordinary chat generation. Convex also recognizes malformed
   plain sibling branches created before the paper retry contract shipped.
6. **Artifact and agent retries stay on the canonical generation path.** DOCX,
   XLSX, PPTX/presentation, image/video, integration, Advisor, and subagent
   turns replay the stored contract and original user-message attachments.
   Built-in artifact tools are not external integrations and must not trigger
   the legacy missing-integration guard.

### Canonical Convex path

`retryContract` is assembled in `convex/chat/retry_contract.ts:buildRetryContract()` and stored by the send, Research Paper start, and retry mutations. `convex/chat/mutations_retry_handler.ts` is the public dispatcher; `convex/chat/mutations_retry_paper.ts` owns Research Paper retry recovery. There is no client-side equivalent — if a client needs any retry-related derived state, add it to the backend payload.
