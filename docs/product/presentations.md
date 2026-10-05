# Chat-First Presentation Contract

> Presentations are generated artifacts inside an ordinary NanthAI chat. They
> are not a separate product area, route, library, or conversation mode.

## Product Boundary

The main chat is the only entry point. A user can:

- ask NanthAI to create a presentation from a topic
- attach source material or a reference deck and ask for a new presentation
- attach an external PPTX and ask NanthAI to interpret and rebuild it
- continue the same chat to revise a generated presentation
- open the generated-file card in the existing chat side panel
- select a slide or stable element in that panel and target the next chat turn
- export the current presentation as editable PPTX or PDF/print output on web,
  iOS, and Android

There is no `/app/presentations` route, presentation library, creation wizard,
or presentation-specific AI transcript.

## Clarification Before Creation

Clarification is ordinary assistant/user conversation for the first slice. The
assistant should ask one compact set of questions when material choices are
missing, covering only what is relevant:

- purpose and desired outcome
- audience, including technicality or explanatory depth
- tone and visual character
- approximate length or speaking time
- examples, reference presentations, source documents, or assets to reuse
- one final ambiguity that could materially change the result

The assistant can offer short example choices and must accept free text. It can
proceed without further questions when the user supplied enough information or
explicitly asked it to use its best judgment. A future structured question card
may improve this exchange, but it must use a generic message contract rather
than introduce a presentation mode.

## Chat Tool Workflow

The presentation skill exposes the workflow through the normal tool loop:

- `create_presentation` receives a compact creative brief: audience, outcome,
  tone, length, direction, image mode, and special composition decisions. It
  must not copy factual source already present in the triggering user message.
  Convex appends that message authoritatively; `sourceContent` is reserved for
  factual source that exists only in an earlier turn.
- `read_presentation` returns the current project, slide, and stable-element
  context for questions or edits.
- `edit_presentation` applies a revision-checked edit to the requested slide or
  selected element.
- `read_pptx` remains the input path for an attached external PowerPoint file.

Structurally invalid generation and editing responses each allow one bounded
repair call. A generation response whose structure and HTML are safe but whose
layout fails is repaired differently: Convex keeps the original deck candidate
private, sends only the offending slide and concrete error to a fresh action,
and accepts deterministic `set_style` patches only. Up to three small layout
patch attempts may repair the reported elements; after every patch the slide is
revalidated by the same HTML, stable-ID, asset, order, and layout checks. A
structurally safe candidate is released after the third local attempt rather
than failing the whole deck. Valid slides are never regenerated merely because
one text pair collided.

The deferred chat creation path is a durable fan-out workflow. Planning is the
single creative-director pass and stores shared visual DNA, deck rhythm, the
whole composition map, and per-slide focal/spatial guidance. Generation then
uses one studio for 1–5 slides, two for 6–10, three for 11–15, and four for
16–20. Studios run in parallel over disjoint slide IDs while receiving the same selected model,
visual DNA, full composition map, adjacent-slide context, and source material.
Their HTML remains private until the whole deck is curated and committed.

A revision-scoped run pins the selected model and privacy requirement. Each
studio records the effective model returned by OpenRouter, so use of the
existing app-default failure fallback is observable rather than silent. One
transactional exact slide-ID barrier accepts each batch at most once and queues
the curator only when the completed ID set exactly equals the planned set.

The curator first performs deterministic content and composition analysis. If
the deck is already coherent it queues finalization without a model call.
Otherwise, disjoint curator tasks run in parallel. They use the same stable-ID
patch operations as normal slide editing and target existing components first;
a full slide recreation is a bounded last resort after patching cannot produce
a valid distinct composition. A second exact task barrier queues one atomic
whole-deck validation and publication.

The creative-direction plan also carries exact typography-role tokens selected
by the user's chosen model. Studios tag semantic text, and backend candidate
normalization reapplies only the planned `font-family` and `font-weight` for
recognized display-title, slide-title, body, label, kicker, sequence-number,
and footer roles. Color, font size, line height, and placement remain
slide-specific so section changes and purpose-built compositions are preserved.
This adds no extra model call. Older plans without structured role tokens pass
through unchanged.

Every studio receives non-blocking spatial authoring guidance to reserve text
and visual zones, keep decorative paths away from readable glyphs, route
connectors through whitespace, and attach labels to their intended diagram
nodes. These checks improve output quality without turning decorative box or
geometry overlap into a new hard publication failure.

Only genuine content duplication may remove a slide. The consolidation task
must prove that the survivor retains every significant fact, number, source
label, visible SVG/text label, and speaker-note token before atomic deletion
and reindexing. When retention cannot be proven both slides remain. Visual
similarity alone schedules recomposition and never deletion.

Static wrapper elements do not become false containing regions for nested
absolute text. Layout validation follows CSS containing-block semantics and
uses the nearest positioned ancestor, while repair errors include the estimated
wrapped height and remaining space so the patch model can make a measured fix.

Generation requires explicit bounds for every absolutely positioned text box,
including text nested inside positioned cards. It estimates wrapped line height
before checking its containing bounds and sibling text overlap. Related
metadata/headline/body text is directed into normal flow inside positioned
containers, leaving absolute text for independent regions. Each repair action
renews the revision-scoped workflow lease; its private candidate is deleted on
success/failure and also has a bounded timeout cleanup.

Deferred planning, generation, and repair model requests may run for up to nine
minutes. Each phase is a separate action and reserves the final minute below
Convex's ten-minute action ceiling for parsing, validation, persistence, and
cancellation cleanup.

One assistant turn may create only one presentation project. A deferred failure
already reflects the bounded backend repair policy, so the model cannot respond
by starting another full project in that same turn. Argument validation may
still fail before any project is created and can be corrected once.

The active chat participant and its current privacy/provider requirements are
used for presentation model work. A tool must not silently switch to a separate
user-default-model experience.

### Multi-participant and Ideascape writes

Multiple participants may read and review PPTX and DOCX artifacts, but their
parallel tool loops must not create competing editable files or race to update
one canonical artifact. Convex therefore blocks `create_presentation`,
`edit_presentation`, legacy PPTX generation/editing, DOCX generation/editing,
and tracked-change proposals whenever the triggering user turn has more than
one participant. The model receives the same recovery guidance as the client:
open `+ → Participants`, remove participants until one remains, retry, and add
the others back afterward.

This is enforced in the tool registry before execution. Skill instructions and
client copy explain the rule but are not the authorization boundary. Web also
blocks a known staged presentation target before send; it does not guess intent
from arbitrary message text.

Ideascape is a review surface for existing PPTX/DOCX artifacts. Compact artifact
rows open the existing presentation or document side panel without selecting or
dragging the node. Presentation preview is view-only there, and AI artifact
edits must return to normal chat with an explicit staged target. Convex rejects
existing PPTX/DOCX edit tools on Ideascape turns even when only one participant
is active. Single-participant creation may still produce a normal artifact node.

## Artifact Lifecycle

Convex is the source of truth for both the user-visible file and the editable
source:

1. A successful creation tool stores a valid PPTX blob in Convex `_storage`.
2. Normal chat finalization inserts a `generatedFiles` row and appends its ID to
   the assistant message's `generatedFileIds`.
3. The generated-file row links to the editable `presentationProjects` record.
4. The existing `GeneratedFilesCard` renders the artifact in the assistant
   message.
5. Clicking the card opens the existing `ChatPageView.sidePanel` slot.
6. The side panel subscribes to the linked project and renders its latest slide
   revisions, even after later chat edits.

HTML or project JSON must never be named or served as a `.pptx`. A stored PPTX
is a revision snapshot; the HTML project remains the canonical editable source.
Creation and AI edits first persist a valid server-generated fallback snapshot
so the generated-file lifecycle is complete. Presentation cards intentionally
do not expose that lower-fidelity fallback as a second download. They open the
side panel, where the single PowerPoint action exports the current sanitized
browser HTML shown in the preview. The panel also uploads that editable PPTX and
revision-safely replaces the stored snapshot with
`snapshotKind: "browser_html"`. Direct side-panel saves advance the project
revision and trigger the same refresh. iOS and Android use the same pinned
HTML-to-PPTX runtime in a private native web surface, upload those exact bytes,
and perform the same revision check before replacing the snapshot.

Presentation tool results do not give the model a direct download URL, and the
skill instructs it to use the generated-file card as the delivery surface. Web
also replaces historical internal PPTX markdown links on project-backed
presentation messages with a card instruction, so an older assistant message
cannot keep advertising a stale fallback download.

## Shared Data Model

`presentationProjects` is an internal, chat-provenance owner rather than a
standalone library item. It stores:

- user and originating chat identifiers
- optional originating message and imported-source identifiers
- resolved brief, status, model, plan, and project revision
- source kind (`scratch` or interpreted PPTX rebuild)
- allowed reusable asset storage IDs
- the current PPTX snapshot storage ID, revision, size, and fidelity kind
- creative-direction metadata plus selected/effective presentation model IDs

Private orchestration state is stored separately:

- `presentationGenerationRuns` owns the revision, selected model/privacy,
  exact expected/completed slide IDs, barrier status, and continuation IDs
- `presentationGenerationBatches` owns disjoint studio assignments, repair
  state, private candidate blob references, and effective model IDs
- `presentationSlideCandidates` stores validated unpublished slide HTML
- `presentationCuratorTasks` owns disjoint in-place recomposition or
  consolidation work and its second barrier state

These rows are never a client-side presentation mode. Candidates are removed
on final publication or terminal failure, repair blobs have bounded cleanup,
and all four tables participate in project and account deletion.

`presentationSlides` stores independently revisioned leaves:

- stable `slideId` and zero-based position
- title, optional speaker notes, and constrained HTML
- slide revision and timestamps

`generatedFiles` may link a PPTX snapshot to its `presentationProjectId` and
project revision. Clients must use this link rather than infer editable state
from MIME type or assistant prose.

`presentationAssets` records the ownership and provenance of images available
to a project. An asset can be a user attachment or an image extracted from an
owned reference PPTX. The public project payload resolves those canonical
storage IDs to temporary URLs plus filename, MIME type, size, alt text, and
kind. Clients must never treat an arbitrary URL or storage ID as an allowed
slide asset.

## Side-Panel Review and Editing

The presentation panel is a branch of the existing file-preview experience. It
uses the same header, close behavior, and chat layout. On desktop its left edge
is resizable within bounded widths, and the slide rail can collapse without
changing the active slide. The header has one current-canvas PowerPoint download
and one print/PDF action; it does not expose a second stored-snapshot download.
It may provide:

- a compact slide rail and current-slide preview
- explicit view, select, and edit interaction states
- direct text/move/resize editing with revision-checked saves
- selection of a stable `data-element-id`
- an “Ask in chat” action that stages a normal composer target chip

Selection alone must not mutate a slide. Direct editing must be an explicit
state so clicking an element to target a question cannot accidentally move or
delete it.

The next user message can carry typed context:

```ts
{
  projectId,
  projectRevision,
  slideId?,
  slideRevision?,
  elementId?
}
```

Convex stores that context on the user message and injects it into the normal
model request as hidden context. Presentation tools still authenticate the
project and validate revisions; client-provided IDs never grant access.

## Editing Semantics

Edits are scoped by default:

- element target: change that stable element and only the surrounding layout
  needed to preserve balance
- slide target: replace or revise that slide while preserving other slides
- no target: resolve the most recent relevant presentation in the chat and ask
  for clarification if the requested scope is ambiguous; editing without an
  explicit target fails when the chat contains more than one ready presentation
- explicit “start over” request: create a new project/file rather than silently
  destroying the existing artifact

Stable IDs and expected revisions protect concurrent edits. A stale write fails
with `REVISION_CONFLICT`; it must not overwrite a newer human or AI change.

The legacy whole-document `edit_docx` finalizer also rechecks that its source
version is still the document's current version. A concurrent replacement that
has already advanced the document fails with `SUPERSEDED_VERSION` instead of
making a late result current.

AI edit responses are deterministic patch programs, not replacement slide
documents. The supported operations are `replace_text`, `set_style`,
`set_attribute`, `replace_element`, `insert_before`, `insert_after`, and
`append_child`, each addressed by stable `data-element-id`. The backend applies
the patch to canonical HTML and then revalidates every stable ID and the full
safe-HTML contract. Element-targeted edits reject sibling insertion and reject
any difference outside the selected target.

## Constrained HTML Contract

- exactly one `div.slide-root` or `section.slide-root`
- root geometry is 1280×720 with relative positioning and clipped overflow
- bounded markup size, element count, and nesting depth
- allowlisted text, shape, image, and inline-SVG elements only
- every editable descendant has a unique stable `data-element-id`; inert `br`
  line breaks are the sole ID-free descendant
- inline allowlisted CSS only
- image sources use canonical `asset:<storageId>` placeholders and must name an
  asset owned by the project
- no scripts, handlers, forms, frames, embedded objects, style blocks,
  `@import`, JavaScript URLs, or arbitrary CSS `url()` values

The backend validates all generated and edited HTML. Web still renders it in a
sandboxed iframe without script permission. Web replaces an allowed canonical
asset placeholder with the matching URL from the authenticated project payload
for rendering/export, then restores the placeholder before a direct save.

Generation-only layout validation is intentionally stricter than a direct user
save: every model-authored absolute text box must declare explicit pixel bounds,
and its estimated wrapped height may not collide with absolute-text siblings in
the same containing region. Direct editing remains revision checked and user
controlled rather than silently reflowing a user's chosen geometry.

Tool traces stay visible for transparency, but expanding a tool first shows a
compact status summary. Raw input/output requires a second explicit Details
disclosure, is length bounded, and redacts internal object/storage identifiers,
credentials, and internal file URLs. This is presentation-independent chat UI
policy; backend authorization remains the actual security boundary.

## External PPTX Inputs

An attached PPTX first goes through the ownership-gated `read_pptx`. The result
includes extracted text, notes, order, slide size/aspect, layout names,
normalized text/image/shape/chart/table geometry, theme colors and fonts,
backgrounds, and reusable embedded images with slide/placement provenance. The
model uses those traits as source material for a new HTML-backed project. The
source storage ID is retained for provenance, and selected embedded images are
passed to creation as owned asset storage IDs.

This flow is **interpret and rebuild**, not lossless decompilation. NanthAI must
state that distinction when fidelity matters. Direct arbitrary OOXML/template
editing remains a separate future capability.

## Cross-Platform Boundary

Convex owns project state, provenance, stable IDs, revisions, validation, and AI
operations. Clients own safe rendering and platform-native interactions. Web,
iOS, and Android consume the same project/file/query contracts rather than
recreate presentation business rules.

The canonical client paths are:

- `presentations/queries:getProject({ projectId })` for the owned project,
  ordered slides, allowed asset metadata/URLs, and current snapshot URL
- `presentations/mutations:saveSlide(...)` for direct, revision-checked edits
- `presentations/actions:persistSnapshot(...)` after uploading a browser/native
  PPTX derived from the matching project revision
- the normal chat send path with typed `presentationContext` for AI targeting;
  clients do not call a second presentation transcript

The project payload is authoritative. Clients do not locally decide asset
ownership, infer a presentation from MIME type, advance revisions, or merge
stale writes.

### Native thin-client implementation

iOS and Android now:

1. decode the existing project/slides/assets/snapshot payload with Convex
   number wire values and forward-compatible optional fields
2. open project-backed generated-file cards in a native full-screen branch of
   the existing chat preview surface, with explicit View, Select, and Edit state
3. resolve only project-authorized `asset:<storageId>` references for rendering
   and restore canonical placeholders before a direct save
4. stage typed `presentationContext` into the ordinary composer and preserve it
   through queued/retried sends; multi-participant writes show the shared
   remove-participants guidance
5. save direct text/geometry edits through revision-checked `saveSlide`
6. export editable PPTX with the same pinned HTML exporter used by web and
   upload those exact bytes through revision-checked `persistSnapshot`
7. expose PDF sharing on iOS and the Android system print/save-PDF surface
8. open Ideascape presentation artifacts in the same renderer with writes and
   target staging disabled

Creation, imported-reference interpretation, and AI edits still run only in the
normal shared chat tool loop. Native clients do not implement OOXML parsing,
model calls, patch semantics, ownership decisions, or revision merging.

## Current limitations

- External PPTX support is an interpreted rebuild, not lossless OOXML,
  animation, SmartArt, master-layout, or embedded-object editing.
- HTML-to-PPTX export preserves the current editable composition on all three
  clients, but PowerPoint font substitution and unsupported CSS details can
  still create small renderer-specific differences.
- Static generation checks catch explicit absolute-text collisions and likely
  wrapping overflow; they are not a full browser font-shaping or visual-diff
  engine, and direct human edits are not automatically reflowed.
- PDF output remains client-rendered: web and Android use system print surfaces,
  while iOS creates a shareable PDF from its native web renderer. There is no
  canonical server PDF snapshot.
- Generic structured clarification remains a possible normal-chat enhancement;
  ordinary conversational clarification is still the supported contract.
- Native direct editing is intentionally surgical and form-based (leaf text and
  element geometry). Web retains richer pointer interactions; AI changes use
  the same deterministic server patch path on every client.
- Native HTML/PPTX/PDF work depends on WKWebView/Android WebView availability
  and a current authenticated project payload for temporary owned asset URLs.

## Non-Goals for This Slice

- a separate presentation dashboard or navigation item
- a second AI conversation embedded in an editor
- lossless editing of arbitrary external PPTX packages
- a presentation-only clarification wizard
- claiming the interpreted rebuild is lossless arbitrary-PPTX editing
- exposing a hardcoded sample asset as if it were user-provided material
