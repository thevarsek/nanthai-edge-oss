# Runtime Host contract and Codex transport decision

> **Status:** Executor-neutral contract complete; local stdio App Server selected; macOS foreground-host plus web routing, permissions, and native-agent activity implemented and live-proven on DEV; packaged tray, native clients, remaining capabilities, soak, and release remain M45 work
> **Date:** 2026-08-15
> **Scope:** Versioned contracts and transport proof plus the unreleased macOS foreground host, Convex control plane, and web pairing/routing vertical slice

## Decision

Freeze `nanthai.runtime.v1` as the executor-neutral turn boundary and
`nanthai.runtime.process.v1` as the local Host-to-worker boundary. The same
`RuntimeTurnPacket` can represent cloud and local participant turns. Process
messages narrow start, resume, and turn delivery to the local placement variant.

Select Codex App Server instead of the measured TypeScript SDK as the
production-depth Codex interface, using its default local stdio transport. It
is the only measured candidate that preserves NanthAI's native
instructions, approvals, diffs, richer streams, model/account state, and
native-agent events. Retain the measured TypeScript SDK path only as disposable
comparison/reference code; it is not a user choice, production fallback, or a
second transport NanthAI must maintain to feature parity.

Convex M46/M47 remains the only execution state machine. The 45.1–45.2 contract
freeze itself added no production dispatcher, released client projection,
pairing endpoint, or live paired-Host connection. The subsequent unreleased
branch vertical slice adds the local routing/control records and DEV dispatch
needed to bind those same canonical runs, attempts, components, fences, and
teardown domains to a paired host; it does not add a second execution engine.

The Runtime Host package began as disposable comparison code and now also owns
the unreleased foreground macOS host. It makes explicit opt-in Codex calls,
owns each worker process tree, and keeps the SDK path comparison-only. Coarse
lifecycle becomes bounded M46 events; the separate fenced chat ingestion path
applies streamed content to the canonical message without turning deltas into
`runEvents` or a second transcript.

The contract barrel is `convex/runtime_host/protocol_v1.ts`. Every object is a
strict Zod schema, every collection and payload is bounded, identifiers are
plain JSON strings at the wire boundary, and all non-text input parts require an
opaque expiring fetch handle with hash, byte length, and bounded chunk size.

The released cloud path still assembles provider-shaped
`OpenRouterMessage[]`. The unreleased local route now serializes the structured
prepared-participant turn and M50 causality into the frozen packet, registers
its immutable hash/fetch handles, and dispatches it only after route and host
preflight. This is forward integration, not a historical-chat or execution-run
migration.

## Invariants

1. Packet array order plus contiguous `ordinal` is canonical. Role and name are
   not flattened into a prompt.
2. Image, audio, video, document, file, and tool evidence are never omitted to
   accommodate an adapter. Unsupported input fails preflight.
3. The immutable placement records the selected model. Only adapter events can
   report the actual model or reroute; projection never mutates placement.
4. `personaId` is nullable for existing cloud bare-model participants, but a
   local placement requires a Persona.
5. Cloud and local packets share one context and causality shape. The Runtime
   Host executes a selected participant; it never selects M50 speakers.
6. Text/reasoning deltas, command chunks, tool progress, heartbeats, local paths,
   and full structured input content stay off `runEvents`.
7. Permissions and structured input are distinct. Allow/deny decisions cannot
   represent `request_user_input` or MCP elicitation responses.
8. Structured input is finite-depth, size-bounded JSON. Empty answer strings are
   valid. The coarse event contains only bounded/redacted request metadata.
9. Native session start/resume owns one immutable canonical packet seed. The
   first turn carries only its command ID and packet hash; it cannot carry a
   second packet or alter context after native thread creation.

## Field ownership map

“Wire only” means process-local transport data, not a new durable owner.
“M45 extension” means the milestone already calls for that product state, but
this spike deliberately does not add its schema.

### Runtime placement

| Field | Canonical owner / mapping |
|---|---|
| `protocolVersion` | `executionAttempts.protocolVersion`; adapter protocol compatibility preflight |
| `runId` | `executionRuns._id` |
| `attemptId`, `fence` | `executionAttempts._id`, `executionAttempts.fence`; every consequential writer uses both |
| `placement` | `executionAttempts.placement` (`cloud` or `local`) |
| `executorKind` | `executionAttempts.executorKind` |
| `orchestrationEngine` | `executionAttempts.orchestrationEngine`; immutable for the attempt |
| `adapter.adapterId`, `adapter.adapterVersion` | `executionAttempts.adapterId`, `adapterVersion` |
| `selectedModel.mode` | Assembly/routing decision; `adapter_default` means no selected provider/model is stored |
| `selectedModel.provider`, `selectedModel.modelId` | `executionAttempts.provider`, `modelId`; selected intent, never actual reroute data |
| `device.deviceId`, `device.displayName` | Local: `executionAttempts.deviceId` plus M45 paired-device display state. Cloud: `device` is exactly `null` |
| `workingDirectory.mode` | Local: explicit discover-at-start policy. Cloud: not applicable. It is not `workspaceId` and is not authorization |

### Runtime turn packet

| Field | Canonical owner / mapping |
|---|---|
| `protocolVersion` | Versioned contract; also checked against placement and adapter capability versions |
| `runId`, `attemptId`, `fence` | Same M46 identity above; packet validation requires placement parity |
| `chatId`, `sourceMessageId` | `chats._id`, source `messages._id`, and linked `generationJobs` |
| `participantId` | Stable `chatParticipants` row / route-snapshot identity propagated through decision, message, attempt, and dispatch; not Persona ID or model ID |
| `personaId` | Persona-backed participant identity; `null` only supports current cloud bare-model execution |
| `messages[].ordinal` | Canonical branch order from context assembly; not a new stored sequence |
| `messages[].messageId` | `messages._id`; source/head/visible references must exist in the packet |
| `messages[].role`, `name`, `participantId` | Existing message role and participant projection assembled for this participant |
| `content[].type`, `partId` | Typed context part and stable assembly-local identity |
| `text.text` | Existing message/context text; later output streams through `streamingMessages` |
| Non-text `name`, `mimeType` | Message attachment, generated file, or `toolExecutionArtifacts` metadata |
| Non-text `fetch.handle`, `expiresAt` | Ephemeral authorized fetch capability; never a durable public URL |
| Non-text `fetch.byteLength`, `maxChunkBytes`, `sha256` | Existing attachment/artifact/storage metadata plus transport integrity and bounded reads |
| `image.altText` | Existing attachment/context description |
| `audio.transcript`, `video.transcript` | Existing extraction/context output when present; bytes remain behind the fetch handle |
| `document.extractedText` | Existing document extraction/context output; original bytes remain fetch-backed |
| `tool_evidence.toolName`, `summary` | `toolExecutionArtifacts` / tool-memory evidence projection; full evidence is fetch-backed |
| `instructions.system[]` | Existing system/context assembly output |
| `instructions.persona[]` | `personas` and participant-scoped assembly output |
| Instruction `instructionId`, `name`, `text`, `sourceHash` | Stable assembly provenance and integrity; no worker-owned prompt history |
| `context.assemblerVersion` | Existing context-assembly implementation/version provenance |
| `context.canonicalHeadMessageId` | Canonical branch head in `messages` |
| `context.references[].id`, `kind`, `version` | Existing artifacts, memories, graph nodes, and tool results selected by assembly |
| `context.omissions[].sourceId`, `kind`, `omittedPartCount`, `reason` | Existing context omission/degradation accounting; ledger total must reconcile |
| `context.omittedPartCount` | Explicit sum of the omission ledger; never an implicit adapter drop count |
| `capabilities.nanthaiTools[].id`, `name`, `version`, `effect`, `inputSchemaHash` | Existing tool registry and M46 operation effect policy |
| `capabilities.skills[]` | Existing `skills` selection/version from participant assembly |
| `capabilities.integrations[]` | Existing connected-integration selection from participant assembly |
| `capabilities.adapterNativePolicy` | Locked M45 preserve-native-capabilities policy; adapter tools/plugins/MCP/skills are not reimplemented |
| `placement.*` | Immutable placement mapping above |
| `causality.replyToMessageIds`, `visibleThroughMessageId` | Existing message graph/frontier; M50 supplies the stable visible frontier |
| Spike-only `causality.liveDiscussion.*` | M50 renames this unreleased field to Collaboration terminology before first production use; it remains M50 durable exchange/wave state, not Runtime Host state |
| `command.commandId`, `commandInputHash` | Existing `runtimeCommands.commandId`, `inputHash`; the eight-hex command replay hash remains unchanged and is not a packet-integrity digest |
| `command.packetHash` | SHA-256 of canonical packet JSON with only `command.packetHash` omitted, recursively sorted object keys, and preserved array order |
| `command.idempotencyKey` | M46 command/operation idempotency identity; same key cannot mean different input |
| `command.cancellationId` | M46 cancel command/fence correlation and centralized teardown |

### Adapter capabilities and models

| Field | Canonical owner / mapping |
|---|---|
| `protocolVersion`, `adapterId`, `adapterVersion`, `transport` | Live adapter probe; broad adapter/version snapshot later belongs to M45 device presence |
| `inputModalities`, `eventTypes` | Live preflight only; no continuously synchronized user model catalogue |
| `operations.listModels`, `cancel`, `resume`, `permissionResponse`, `inputResponse` | Live capability negotiation before sending the relevant command |
| `adapterNative.tools`, `plugins`, `mcpServers`, `skills` | Truthful probe of preserved harness-native capabilities |
| Model `provider`, `modelId`, `displayName` | Ephemeral `listModels`; only an explicit selected model is persisted on an attempt/Persona route |
| Model `availability`, `unavailableReason` | Live revalidation result; an unavailable explicit selection fails without fallback |
| Model `inputModalities`, `supportsTools`, `supportsReasoning` | Live model preflight, not a durable personalized catalogue |

### Adapter events

| Field | Canonical owner / mapping |
|---|---|
| Common `protocolVersion`, `eventId` | Version check and `runEvents.eventId` idempotency for projected events |
| Common `sequence`, `occurredAt` | Adapter ordering evidence; M46 assigns its own monotonic `runEvents.sequence` and `createdAt` |
| Common `runId`, `attemptId`, `fence` | M46 active-attempt assertion on every consequential write |
| Common `sessionId` | `runtimeSessionBindings` lookup; not client lifecycle truth |
| Session `nativeSessionId`, `resumed` | Attempt-scoped `runtimeSessionBindings` plus a new durable conversation binding for one chat participant/route snapshot, its native thread, canonical frontier, and last owned native turn |
| Session `workingDirectory`, `repository.root`, `revision` | M45 binding/projection provenance extension; not historical `workspaceId`, not permission scope |
| Text `messageId`, `delta` | `streamingMessages`; never `runEvents.adapterDetail` |
| Reasoning `delta` | `streamingMessages.reasoning`; never `runEvents.adapterDetail` |
| Tool `toolCallId`, `toolName`, `summary`, `progress`, `outcome` | `executionOperations`, tool artifacts, and bounded `tool_activity`; progress itself is not projected |
| Command `toolCallId`, `stream`, `chunk`, `isFinalChunk` | Wire/local spool only; durable evidence must be an artifact or bounded tool result |
| Evidence `evidenceKind`, `summary`, `artifactIds` | `toolExecutionArtifacts`, storage, and coarse artifact/tool event |
| Evidence `localPath` | Wire only and intentionally excluded from durable event detail |
| Permission `permissionRequestId`, `toolCallId`, `permissionKind`, `prompt`, `choices`, `expiresAt` | Existing `waiting_for_permission`, bounded `runEvents` detail, and `runtimeCommands.permission_response` |
| Permission resolved `permissionRequestId`, `decision` | Permission response command disposition and bounded activity event |
| Input `inputRequestId`, `source`, `prompt` | Existing `waiting_for_input`; source distinguishes user input, MCP elicitation, and native input |
| Input `requestSchema`, `sensitiveFieldPaths` | Bounded wire request. Coarse event persists only sorted top-level keys and sensitive-field count |
| Input resolved `inputRequestId`, `outcome` | A distinct event; projection creates a fixed redacted summary and never places the full answer in `runEvents` |
| Artifact `artifactId`, `artifactKind`, `name`, `mimeType`, `byteLength`, `sha256` | Existing `toolExecutionArtifacts` / storage plus `artifact_created` |
| Usage `actualModel` | Nullable adapter-reported identity plus bounded model activity. The measured SDK usage event has tokens but no actual model; selected attempt model is never substituted or overwritten |
| Usage `tokens.input`, `output`, `cachedInput`, `reasoning`, `total` | Existing `usageRecords` token fields; nullable means adapter did not report the dimension |
| Usage `cost.source`, `amount`, `currency`, `pricingVersion`, `reason` | M45.10 usage extension. Current `usageRecords.cost` alone cannot preserve truthful source/currency/version |
| Model `actualModel`, `reason` | Bounded `model_activity` and later usage/session provenance; records initial, reroute, or resume observation |
| Heartbeat | Existing M46 heartbeat/lease path, not a new `runEvents` row |
| Terminal `outcome`, `summary`, `errorCode`, `checkpointRef` | Existing M46 terminalization, attempt error/checkpoint, and coarse terminal event |

### Process wire and pairing

| Field | Canonical owner / mapping |
|---|---|
| Wire `wireVersion`, `messageId`, `sequence`, `sentAt`, `kind` | Wire only; request correlation and per-direction process ordering |
| `probe_request`, `list_models_request` payloads | Empty strict controls; results contain live health/auth and ephemeral models |
| `start_session_request.placement`, `packetSeed` | Local placement plus the immutable canonical packet/context seed required before native thread creation; schema requires exact placement parity |
| `send_turn_request.sessionId`, `commandId`, `packetHash` | Active binding plus exact seed reference. It carries no alternate packet and the worker permits one matching first send |
| `cancel_request.sessionId`, `cancellationId`, `reason` | M46 cancellation command/fence and centralized teardown |
| `permission_response_request.*` | Existing permission response command, kept separate from generic input |
| `input_response_request.sessionId`, `inputRequestId`, `response` | Distinct process command. Integration may encode it as an existing M46 `prompt` command payload; full content is bounded and never copied to `runEvents` |
| `resume_request.placement`, `packetSeed`, `nativeSessionId`, `checkpointRef` | New attempt/turn seed, prior native binding, and committed M46 checkpoint; placement must exactly match the seed |
| `close_request.sessionId`, `reason` | Binding release and component teardown |
| `worker_ready.workerId`, `processId`, `capabilities` | Wire/process ownership and live probe; no product lifecycle state |
| Result `requestMessageId`, health/auth/models/session/status/code/summary` | Wire correlation; `session_result.nativeSessionId` is nullable because SDK thread ID is unavailable before `thread.started`. Do not bind a fabricated ID; canonical `session_started` later supplies it. App Server returns non-null |
| Event/terminal envelope `sessionId`, `event` | Active binding lookup followed by fenced event handling |
| Protocol error `requestMessageId`, `code`, `message`, `recoverable` | Wire error; a consequential failure maps to bounded M46 failure, never raw worker output |
| Pairing `protocolVersion`, `pairingId`, `oneTimeCode`, `expiresAt` | M45 pairing exchange; one-time secret is not presence or event data |
| Claim `hostNonce`, `hostPublicKey`, device display/platform/host version | M45 pairing proof and paired-device identity |
| Grant `deviceId`, `credentialId`, `credential`, `issuedAt` | M45 device record stores only a credential hash; opaque credential remains local |
| Presence device/credential/session IDs, owner, timestamps, host/platform | M45 paired-device presence/lease. Presence is ephemeral and contains no credential secret |
| Presence adapter identity/auth/capabilities | Broad live snapshot only; no personalized model catalogue |
| Revocation device/credential IDs, time, reason | M45 paired-device revocation and active binding teardown |

## Coarse execution-event projection

`session_started`, tool start/completion, permission/input waits and resolutions,
artifact/evidence, usage, actual-model observation, and terminal events map only
to existing `started`, `tool_activity`, `waiting_for_permission`,
`waiting_for_input`, `artifact_created`, `model_activity`, and terminal types.
The M46 writer still assigns sequence, checks the attempt/fence, and enforces
idempotency. Projection does not write or terminalize anything itself.

Unicode-safe truncation guarantees every valid adapter event produces either a
valid bounded projection or `null`. Oversize detail becomes valid JSON with a
deterministic truncated preview; it is never a broken partial JSON string.

App Server `warning` notifications are not adapter events. A payload with a
required string `message` and optional nullable string `threadId` is validated
against its session, deduplicated by distinct message, Unicode-safely bounded
to 2,000 UTF-16 code units, and sent only to the worker's injectable local
diagnostic sink. It creates no Convex event or chat message and never logs the
native thread ID. Any valid warning text is non-fatal; malformed warnings and
unknown notification methods remain fail-closed.

## Selected Codex transport and release gate

Local stdio App Server is the selected Codex product transport. Current OpenAI
documentation explicitly directs deep product integrations needing auth,
history, approvals, and streamed events to App Server, while directing
automation and CI to the SDK. It also documents a stable-by-default core API.
However, the same page retains a production-support caveat for the
`app-server` command and the pinned `codex-cli 0.147.0` help still labels the
command experimental. WebSocket is explicitly experimental/unsupported and is
not a candidate.

NanthAI accepts that command-maturity risk for local stdio because the SDK's
measured surface cannot meet the approved experience. The selected path uses
stable core methods and opts into pinned `experimentalApi` only for the
measured native-agent notification shapes. It pins the executable and generated
schema, runs deterministic and guarded live compatibility probes before every
upgrade, refuses incompatible versions visibly, and never falls back silently
to the SDK or cloud. Provider/support status and the native-agent experimental
surface remain release-review items, not unresolved transport choices.

The process spike verified that SDK `turn.completed` can report
token usage without reporting actual model or reroute identity. The contract
therefore preserves that usage with `actualModel: null`; it does not invent an
adapter report from immutable selected placement. Without actual identity, a
model-priced estimate remains unpriced unless a later storage/UI contract
labels selected-model provenance and estimate assumptions separately.

The pinned identity is `@openai/codex-sdk@0.147.0`,
`@openai/codex@0.147.0`, and App Server v2 schema SHA-256
`f3dec1e031d99a420b137b903f02196d4325eece57620c925bb7130b25f168d2`.
The authorized 2026-08-15 personal-subscription probe measured:

| Candidate/path | Result |
|---|---|
| SDK text | Canonical session, text, usage, and completed terminal |
| SDK resume | Completed on the same native thread ID |
| SDK cancel | Accepted and terminated as interrupted |
| App Server text | Canonical session, actual model, streamed text, usage, and completed terminal |
| App Server resume | Completed on the same native thread ID |
| App Server cancel | Accepted and terminated as cancelled; process group drained |
| App Server approval, raw protocol | Numeric request ID observed, denial delivered, command target absent |
| App Server approval, canonical worker | Completed through tool start, permission request, denial/resolution, tool completion, usage, text, and terminal; command target absent; process group drained |
| Production DEV native permission loop | A destructive command produced the fixed web control; deny/Stop/cancel preserved their targets, Allow once executed, and the host drained healthy. Native `acceptForSession` did not suppress a later different destructive request, so it is not presented as blanket authorization |
| App Server model discovery and explicit route | One explicit request returned seven live models through an isolated discovery worker; a GPT-5.6-Luna Persona route then served a fresh Local chat and local usage attributed the turn to `gpt-5.6-luna`; no reusable model catalogue was retained |
| App Server native agent, production DEV path | A root turn spawned one backstage child, web rendered bounded child activity/output, authoritative child completion became `Completed`, and only the parent published a chat reply |
| Parent Stop with active native child | Stop interrupted a child during `/bin/sleep 30`, persisted the group as cancelled and child as interrupted, drained the spool, and left the host online with zero active attempts and no last error |
| Six-session churn | Every process group drained; supervisor descriptor delta zero; bounded RSS only |

The exact opt-in command, deterministic test coverage, resource ranges, and
unsupported rows are recorded in `runtime-host/README.md`. Codex's warning
stated that its discovered skill descriptions had been shortened to fit the
skills context budget. This is a non-fatal Codex catalogue diagnostic, not an
App Server limitation or a NanthAI skill-binding failure. NanthAI validates and
logs it locally without creating a canonical event; real fatal transport or
protocol failures still produce sanitized canonical terminal evidence and must
be visible to the end user in the full M45 implementation.

Public App Server turn input currently documents text, image URL, and local
image. Although the generated schema contains other audio-related shapes, this
adapter does not advertise or map turn audio without a supported public
contract and live proof. The selected App Server path now normalizes the
measured native-child start/activity/completion shapes; the SDK comparator does
not. Children remain backstage, parent-owned activity with no per-child control
or public message. The measured notification path supplies no nickname, so the
web falls back truthfully to `Agent 1` rather than issuing an unproven
enrichment request.

Before the production Codex adapter is approved, run App Server against the
same checked-in fixtures and record pass/fail evidence for:

1. lossless role/name order, instructions, all supported modalities, fetch
   handles, tools/skills/integrations, placement, and M50 causality;
2. text/reasoning, tool lifecycle, command output, file/diff/test evidence,
   permission, structured input/MCP elicitation, artifact, usage, actual-model
   reroute, and terminal normalization;
3. prompt/turn cancellation with stale-fence rejection and complete child-tree
   teardown;
4. resume only from a committed checkpoint/native session that the candidate
   proves resumable;
5. preserved Codex plugins, MCP servers, native tools, and approvals;
6. adapter-reported tokens/model identity and truthful provider-reported,
   API-equivalent-estimate, or unpriced cost labelling; and
7. bounded queues, output, descriptors, memory, orphan processes, and clean
   session close under churn; and
8. non-fatal local warning diagnostics, visible fatal transport/protocol
   failures, plus Codex collaboration/subagent child identity, events,
   approvals, cancellation, usage, and process cleanup.

App Server must pass every acceptance-critical row. If it does not, M45 Codex
execution stays unreleased; the contract is not weakened and no SDK/cloud
fallback is added. The TypeScript SDK remains useful only for regression
comparison and for proving which observations are transport-specific. It can
be removed after the App Server vertical slice and upgrade gates are stable.

Both measured transports inherit the installed Codex CLI authentication.
ChatGPT sign-in consumes the user's subscription access; API-key sign-in is
billed at standard API rates. App Server is preferable because its account API
can expose the active auth method, account/workspace, plan, rate limits, and
explicit login/logout. M45 must show that safe identity in `nanthai doctor` and
the tray so a user can detect a work-versus-personal login before execution.

### Native conversation continuity

Use one persisted App Server thread for each stable NanthAI chat participant
and route snapshot. Different Personas in the same NanthAI chat use different
native threads even when they share a machine and repository. Name each thread
`<Persona> · <chat title>` through App Server's `thread/name/set` method. Normal
message dispatch already seeds a canonical chat title synchronously from the
first user message before participant execution, so native thread creation does
not wait for the later AI-refined title. If no non-placeholder title exists,
use `<Persona> · Chat <short chat ID>` and rename the thread when the canonical
title becomes available or changes. A rename is metadata-only: failure is a
bounded diagnostic and never delays or fails the turn, because durable IDs—not
the display name—own the binding.

The existing `runtimeSessionBindings` remains attempt-scoped and is released or
revoked with its fence. A separate durable conversation binding owns the native
thread ID, owner/chat/chat-participant identity, route-snapshot hash, adapter,
device, last synchronized canonical frontier, last NanthAI-owned native turn,
status, and timestamps. Each new attempt temporarily binds to it.

The first turn seeds full canonical context. Later public turns may resume only
after the host proves the stored native state has not advanced elsewhere and
injects the canonical delta since that participant's cursor. Missing,
incompatible, externally advanced, or route-changed native state starts a new
thread with recorded provenance rather than silently merging histories.
App Server persists `appServer`-source threads, but other Codex clients decide
whether to display that source; direct Codex-app visibility is not guaranteed.
Direct turns made outside NanthAI are not imported in the first release.

One paired machine may own multiple active public Persona attempts
concurrently. Parallel multi-model chat and a Collaboration wave therefore do
not collapse into machine-wide serialization. Every local participant keeps a
separate worker process tree, App Server session, native thread, attempt/fence,
and event stream, so text/reasoning/tool output can interleave safely in the
canonical streaming projection without sharing Persona-private native history.
The host reports resource pressure or an attempt-start failure explicitly and
never reroutes to cloud. It does not invent repository worktrees: concurrently
active harnesses see the machine and filesystem access the user approved, and
any resulting file conflict remains a visible execution outcome.

## Development-only lifecycle observer

The fixed-fixture lifecycle observer is available only in a development web
build at `/app/__dev/m45-runtime`. Its action is inert unless the development
deployment has `M45_SPIKE_ENABLED=1`, still requires Clerk authentication and
an owned, non-deleting chat, and accepts only the checked transport/scenario
selectors. It has no free-form prompt, command, or path input. The observer is
bounded and redacted and reads backend-authored lifecycle state; it does not
pretend its deterministic fixtures are live Codex transport proof.

The measured development workflow is:

```bash
CONVEX_URL=<development-deployment-url> npx convex env set M45_SPIKE_ENABLED 1
CONVEX_URL=<development-deployment-url> npx convex dev --once --typecheck disable
cd web && npm run dev
```

Then open the authenticated development route and run the fixed scenarios. Do
not enable or deploy this driver as a production feature. Production web builds
run `verify-no-development-surfaces.mjs`, which fails if the route marker or
page sentinel survives bundling.

## Remaining decisions and gates

### 2026-08-16 implementation evidence

The post-spike branch now implements the first real macOS/web vertical slice,
without changing the executor-neutral contract or deploying to production:

- one-time web pairing, macOS Keychain credential storage, revocation, leased
  presence, capability/account probe, foreground CLI ownership, and single-host
  locking;
- authenticated outbound command polling, immutable packet fetch, fenced
  claims/events, durable outbound spool, exact replay, heartbeat, completion,
  cancellation, and centralized run-tree teardown;
- atomic Persona machine/adapter binding, immutable per-chat participant route
  snapshots, send-time preflight, and visible Local/Cloud web provenance;
- production packet materialization, native App Server start/resume, durable
  per-participant conversation binding and canonical-frontier cursor, native
  thread naming, streaming text/reasoning, actual-model and token events, and
  normal NanthAI message finalization;
- real ChatGPT-subscription turns that read this repository and another local
  repository, resumed the same native Persona thread, and preserved the
  backend-authored `<Persona> · <chat title>` name;
- two concurrent public Personas on one Mac with distinct attempts, process
  trees, App Server sessions, threads, and streams; one shared Stop cancelled
  both while the host remained online and the durable spool drained to zero;
- restart replay of exact cancellation events under the same device credential,
  with stale claimant/fence checks retained and no duplicate canonical write;
- local monthly token history with unknown prices left explicitly unpriced.
- packet-bound authenticated image fetch, exact length/SHA verification,
  private attempt-scoped materialization, and App Server `localImage` delivery;
  fresh and same-thread resumed DEV turns read visual-only text exactly, while
  an unsupported Markdown attachment failed visibly without cloud fallback or
  residual host temp state.
- App Server native-agent start, bounded backstage activity/output,
  authoritative completion, parent-only publication, and parent Stop while a
  child was executing. Stop persisted cancelled/interrupted projection state,
  drained the spool, and left the host online.

This evidence establishes the macOS foreground text/image/concurrency/
cancellation/permission/native-agent slice only. It is not evidence for the
packaged menu/tray app, Run at login, native client UI, non-image modality
transport, NanthAI tool/skill binding or local helper routing, native-child
usage attribution, Pi, scheduled local jobs, Windows/Linux, or the release
soak.

- M45.6 must approve native-thread retention, reset/archive behavior, and how
  users inspect NanthAI-created `appServer` threads. This does not block M50,
  and the first release must not promise that another Codex client lists them.
- Product must approve retention and visibility for full structured elicitation
  responses before integration persists them. This slice transports them only
  in a bounded process message and emits a redacted coarse event.
- The initial advertised Runtime Host OS is macOS. Windows and Linux remain
  protocol targets but require their own process-tree ownership, packaging,
  live adapter, and soak evidence before being advertised.
- Canonical `usageRecords` must support monthly and longer-range views. The
  exact offline tray-cache window remains a task 45.10 decision and must not
  become the retention policy for canonical usage history.
- M45.10 must extend usage storage before cost source, currency, pricing version,
  device, adapter, and actual reroute attribution can be claimed durable.
- Pairing credential rotation and revocation are implemented; lifetime,
  recovery, installer handoff, and threat-review remain release gates.
- Numeric wire bounds constrain one packet/message/chunk, not user upload or
  conversation policy. Larger durable inputs remain storage-backed and chunked.
- The measured churn run proves bounded cleanup only. The 24-hour memory and
  descriptor soak remains M45.15 work.
