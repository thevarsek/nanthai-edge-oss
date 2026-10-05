# Data model

## Schema ownership

[`convex/schema.ts`](../../convex/schema.ts) composes the active schema modules.
The source validators and indexes are authoritative; this chapter explains ownership
instead of maintaining milestone-era schema snapshots. Shared validators live in
`convex/schema_validators.ts` and domain-specific validator modules.

| Schema module | Domain |
|---|---|
| [schema_tables_advisors.ts](../../convex/schema_tables_advisors.ts) | Advisor consultations |
| [schema_tables_analytics.ts](../../convex/schema_tables_analytics.ts) | Analytics/report execution |
| [schema_tables_catalog.ts](../../convex/schema_tables_catalog.ts) | Model/skill catalogues and message memory caches |
| [schema_tables_collaboration.ts](../../convex/schema_tables_collaboration.ts) | Exchange and speaker progression state |
| [schema_tables_core.ts](../../convex/schema_tables_core.ts) | Chats, messages, Personas, documents, files and memories |
| [schema_tables_execution.ts](../../convex/schema_tables_execution.ts) | Canonical runs, attempts, commands, events and effects |
| [schema_tables_external_mcp.ts](../../convex/schema_tables_external_mcp.ts) | External client authorization and receipts |
| [schema_tables_mcp.ts](../../convex/schema_tables_mcp.ts) | Connections to remote MCP servers |
| [schema_tables_presentations.ts](../../convex/schema_tables_presentations.ts) | Presentation projects and workflows |
| [schema_tables_reports.ts](../../convex/schema_tables_reports.ts) | Published reports |
| [schema_tables_runtime.ts](../../convex/schema_tables_runtime.ts) | Cloud workspace/runtime capabilities and state |
| [schema_tables_runtime_host.ts](../../convex/schema_tables_runtime_host.ts) | Paired hosts and transport state |
| [schema_tables_runtime_native_agents.ts](../../convex/schema_tables_runtime_native_agents.ts) | Native child attribution and lifecycle |
| [schema_tables_runtime_offline.ts](../../convex/schema_tables_runtime_offline.ts) | Saved-result import identities and reconciliation |
| [schema_tables_runtime_permissions.ts](../../convex/schema_tables_runtime_permissions.ts) | Native question and permission state |
| [schema_tables_runtime_routing.ts](../../convex/schema_tables_runtime_routing.ts) | Persona routes and conversation bindings |
| [schema_tables_search.ts](../../convex/schema_tables_search.ts) | Search orchestration |
| [schema_tables_user.ts](../../convex/schema_tables_user.ts) | Preferences, credentials, entitlements, schedules and devices |

## Identity and conversations

User-facing data is scoped to the authenticated Clerk identity. Convex record IDs
are canonical identities; display labels are not interchangeable keys. Queries,
mutations and actions own access checks. Clients do not gain authority by possessing
an ID or cached DTO.

Chats own branch selection; messages form the public conversation graph through
parent references. `activeBranchLeafId` is the persisted branch-selection field.
Canonical assistant messages retain completed content and provenance; active token
updates use `streamingMessages` overlays. Stable participant IDs distinguish
participants even when names or models match.

Personas hold current defaults. New logical turns resolve the current accessible
Persona and compatible overrides, while active turns/replay retain their effective
configuration. Historical attribution does not authorize a future route.

## Context, artifacts and memory

Durable tool artifacts retain call/result provenance and storage-backed large
payloads. Compact tool memories and context assembly records support selection,
rehydration and debugging. Shared memory ownership, scope, lifecycle and source
access remain independent of which harness created an answer.

Documents have canonical identity and immutable versions. Generated files/media
link through ordinary artifact and storage owners. Large extracted text and file
bytes stay in storage, not oversized lifecycle events. Quote-bearing source records
support client citations without exposing private native reasoning.

## Execution and local state

Canonical runs, attempts, fences and owned components define lifecycle. Workflow,
Workpool and runtime-session identities are linked implementation components, not
replacement product truth. The retired `generationContinuations` table and scheduled
handoff fields are not active architecture.

Runtime host tables cover pairing, routes, native requests/children and receipts.
Disconnected results import through dedicated identities and current ownership;
the Mac's private saved-task files are not a replica of Convex tables. See
[saved tasks](../runtime/saved-tasks.md).

## Client decoding

iOS uses Codable DTOs; Android uses serializable transport DTOs mapped into domain
models. Convex `v.number()` is an IEEE 754 double. Android DTO numeric fields use
`Double`/`Double?`, then convert in mapping code; live-shaped tests use `3.0`, not
`3`. Swift can coerce integral doubles, but consistent wire types are preferred.
Nullable/future fields follow the intended compatibility contract.

See [client contract](client-convex-contract.md),
[context assembly](context-assembly.md) and [execution](execution-control-plane.md).
