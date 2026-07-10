# Persona Advisors

Persona Advisors let a Pro user privately consult up to three of their existing
Personas before a text response is generated. A Persona remains the only
configurable entity; there is no Advisor profile or Advisor Skill.

Official transport references: [OpenRouter Advisor](https://openrouter.ai/docs/guides/features/server-tools/advisor)
and [Responses API](https://openrouter.ai/docs/api/reference/responses/overview).

## Shared API

- `advisors.queries.listChatAdvisors({ chatId, participants?, selectedPersonaIds?, turnIntegrationOverrides? })`
  returns `{ advisors, eligibility }`; `selectedPersonaIds`, when supplied, is
  evaluated as the exact turn selection rather than merged with kept Advisors.
- `advisors.queries.getBatchView({ batchId })` returns the batch projection with
  its ordered runs, or `null` when unauthorized.
- `advisors.mutations.setChatAdvisors({ chatId, advisors })` replaces kept
  assignments. Each item contains only `personaId` and `allowWebSearch`.
  Existing assignments that have since become unavailable may remain in the
  replacement and may still be removed; a newly added unavailable Persona is
  rejected.
- `advisors.mutations.removeChatAdvisor({ chatId, personaId })` removes one kept
  assignment without deleting historical advice.
- `advisors.mutations.cancelBatch({ batchId })` stops only unfinished Advisor
  consultations. Completed advice is preserved and the deferred main response
  is still scheduled exactly once.
- User-initiated chat and Research Paper sends accept `advisorSelections` and
  `advisorBrief`. A selection contains only `personaId`, `keepAvailable`, and
  `allowWebSearch`. Omitting `advisorSelections` inherits the chat's kept
  Advisors; supplying it is an exact turn snapshot, so `[]` explicitly runs
  without Advisors. This distinction lets queued sends preserve compose-time
  intent even when kept assignments later change.
- Assistant messages expose optional `advisorBatchId`; all siblings in one
  multi-model turn share the same batch.

The backend resolves ownership, entitlement, eligibility, Persona prompt,
model, parameters, instance name, and web-search mapping. Clients must never
send resolved prompts, model IDs, names, or entitlement state.

## Durable workflow

One batch is created per user message and one run per selected Persona. Runs
execute independently through `POST /api/v1/responses`; the barrier schedules
the deferred main generation exactly once after all runs become terminal.
Successful advice is injected into every text participant as one bounded
`<private_advisor_notes>` system block. Partial or total Advisor failure never
blocks the final response.

Each request uses a low-cost dispatcher, exactly one named `openrouter:advisor`
tool, `tool_choice: "required"`, `forward_transcript: true`, nested web search
only when explicitly enabled, and a bounded output. Advice streams into a
throttled Convex writer. Network idle and absolute action deadlines are
separate; timeouts are not automatically retried.

Provider and SDK failures are normalized before persistence. Request dumps,
transcripts, Persona instructions, memory, briefs, and tool context are never
part of the client error contract. Known concise provider messages remain
available; unsafe or backend-generic diagnostics are omitted from the public
projection so each client renders its localized terminal fallback. The same
projection sanitizes historical rows and chat copies.

The newest 40 messages from the active branch window, compatible attachments,
Persona/global memory, and brief form the request. `forward_transcript: true`
supplies that context to the private Advisor, so prior Responses Advisor output
items are not replayed a second time. Assistant transcript items carry the
Responses API's required stable `id` and completed `status`. Legacy Persona
model IDs ending in `:online` are normalized and opt into nested
`openrouter:web_search`.

## Eligibility and lifecycle

Advisors are Pro-only, capped at three distinct Personas, and restricted to
user-initiated text-output turns. They are unavailable for ZDR,
Google-protected, scheduled, autonomous, and media-output turns. A Persona
cannot be a public participant and a private Advisor in the same turn.

Kept assignments expose canonical `isAvailable` and
`unavailableReasonCode` fields. A Persona whose resolved model is missing or no
longer text-output remains visible and removable in every client but is skipped
for new turn snapshots. If every selected/kept Advisor is skipped, the main
response runs normally without creating an empty Advisor batch. In multi-model
chat every text participant receives the same successful private notes;
Advisors cannot be assigned to individual participants.

All three internet-search paths keep the same ordering contract: the shared
Advisor batch finishes first, then normal OpenRouter web search, advanced web
search, or the Research Paper workflow begins. Search planning, query
generation, and source retrieval remain evidence-focused and do not receive
private Advisor notes. The final synthesis/writer runs through the shared chat
generation pipeline and injects the same successful notes into every text
participant. This prevents a Persona opinion from narrowing source discovery
while still letting it shape the answer or paper. Research Paper therefore
supports Advisors without giving them control of its search plan.

Normal response and Research Paper retries reuse a terminal batch without a
second Advisor charge. Editing the user message creates a new batch. Chat
copy/fork deep-copies kept assignments and reachable terminal history. Persona
edits or deletion do not alter stored snapshots; chat/account deletion removes
Advisor data and cancels delayed work.

Advisor usage is stored once per run with source `advisor`, included in chat
totals, and exposed in the `advisors` Advanced Stats bucket.

Backend PostHog events cover `advisor_consultation_started`,
`advisor_consultation_completed`, and `advisor_consultation_failed`; kept-chat
changes use `advisor_kept_for_chat` and `advisor_removed_from_chat`. Events use
batch/run/Persona identifiers plus model, web-search, duration, status, cost,
and normalized error metadata where applicable.

## Legacy Skill migration

The retired `openrouter-advisor` system Skill and progressive `advisor` profile
must be removed in two dev deployments so old rows remain schema-valid during
cleanup:

1. Deploy with the decode-only `v.literal("advisor")` still present.
2. Run `npx convex run skills/actions:seedSystemCatalog`. The action pages
   through legacy `advisor` profiles, removes retired Skill references from
   preferences, Personas, chats, and scheduled jobs, then deletes the retired
   system Skill row.
3. Verify no legacy profile/reference rows remain.
4. Remove the decode-only literal, regenerate bindings, and deploy again.

Production deployment is a separate explicit operation.
