# Maintaining the documentation

## One book, current state

`docs/README.md` is the table of contents. Chapters are organized by durable product
or technical topic, with subchapters where a concern needs its own explanation.
Update an existing chapter first. Split a broad chapter by responsibility when
necessary and connect both parts through the chapter index.

Documentation describes current architecture, behavior, goals and user journeys.
Clearly label future scope and link its milestone; do not present a discarded
proposal or a historical test result as current implementation.

## Names and artifacts

Use stable subject names. Do not name documentation files or folders after dates,
milestones, branches, agents, decisions, audits, closeouts, evidence runs or
before/after comparisons. Dates may appear inside a chapter to qualify an observation;
they are not a documentation versioning scheme. Git owns revision history.

Keep `docs/` text-only Markdown. No screenshots, image folders, diagrams exported
as images, raw JSON/CSV, lint inventories, benchmark dumps, logs or generated reports.
Use prose, tables and small inline Mermaid diagrams when useful. Reusable test
fixtures and evaluation inputs/results live with the owning test/evaluation code
under stable descriptive names. Private receipts, credentials and native logs stay
outside the repository. Do not relocate clutter to a new documentation archive.

## Milestones and component guides

Keep one Markdown file per milestone plus the shared index and instructions.
Put concise acceptance history, exact scope and qualification limitations in that
file. Do not create auxiliary amendments, evidence files or decision reports.
Milestones link to current topic chapters; chapters may link back to milestones
without organizing their content around milestone numbering.

A component README explains its purpose, setup and commands. The Mac app, host,
packaging and component guide belong under `runtime-host/`; shared architecture
belongs in the book. Do not append chronological development journals to READMEs.

## Reconcile a change

1. Update the current topic and the owning milestone, if scope/status changes.
2. Remove superseded proposals and fold useful content into its maintained owner.
3. Update inbound links, local anchors, indexes, instructions and any scripts that
   generate or consume moved material. Preserve paths in immutable historical
   fixtures when those paths describe an old Git revision.
4. Check that referenced code exists and current/qualified/released/planned states
   are distinct. Record unavailable verification honestly.
5. Perform one focused content/link/diff check. Documentation-only work does not
   restart model evaluations, require new inference or reopen completed acceptance.

The root [approval and evidence rules](../../AGENTS.md) continue to apply. Editing
documentation is not authority to change the product behavior it describes.

## Feature delivery evidence

Shared app changes include web, iOS and Android, including menu placement, localization,
empty/loading/error states and provider dependencies. Verify the rendered controls on
each platform as well as the shared API. Use current consumer terminology and existing
navigation/settings patterns; do not ship raw translation keys or development labels.

Keep screenshot galleries and illustrated user workflows as chat delivery artifacts
outside the repository. Label fixture-backed native renders separately from authenticated
end-to-end evidence. Update the documentation book with current behavior and limitations,
not screenshots or a chronological test journal. Leave ordinary user connections in a
usable state, with QA conversations clearly separate from normal account history.
