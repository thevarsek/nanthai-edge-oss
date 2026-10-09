# Conversation compaction

## Committed summary and complete tail

Ordinary generation uses one Convex-owned summary contract across cloud and local
preparation. `conversation_context_actions.ts` plans against the current owned
chat, participant and causal ancestry. It pages the complete raw history in
128-message reads; the former oldest-5,000 limit is absent from generation.

An immutable `conversationSummaries` head records its previous version, exact
coverage count/end message, source digest, policy, model and writer fence. Source
IDs are staged in bounded manifest rows. The head publishes atomically only after
all chunks succeed, the staged coverage is complete, the source revision still
matches and no competing publisher has replaced the captured head. Raw messages
remain canonical and are never deleted by compaction.

A turn validates the covered prefix against its actual ancestry and source digest,
captures the head on its generation job/assistant anchor, and prepares that summary
plus every eligible uncovered message. Below the trigger it reuses the same head
without a summariser call. A later boundary summarises the previous summary plus
only the newly covered prefix. Forks with incompatible ancestry rebuild from raw
history. Deletion increments the source revision; digest validation also rejects
changed covered content, tool evidence or artifact references.

## Pressure and durable execution

The shared planner reserves up to 24,000 tokens (35% of the model window) for
instructions, tools, retrieved context and output. It triggers at 80% of the
remaining budget and aims for 45%, protecting the last twelve messages, the current
input and unresolved tool calls/results. Native preparation also respects the
existing packet message bound through compaction, rather than dropping history.
The estimate is conservative, not a provider tokenizer or a quality guarantee.

Historical failed and cancelled messages can be crossed by the coverage cursor.
Their IDs remain in the immutable manifest, but summary input contains only a
terminal-status marker, not their discarded content or tool payloads. Active
messages and unresolved calls in eligible content still protect the raw tail.

Bootstrap sources are split into at most 24,000-character chunks. Complete long
individual messages are split across chunks without the old 8,000-character cut.
Published tool evidence is included; referenced media is identified with an
explicit limitation rather than represented as inspected pixels or audio.

The existing generation Workflow owns planning and ordered chunk progression.
After 24 chunk steps it hands off to the existing linked successor mechanism;
this bounds component journals without imposing a conversation quota. Cloud
summarisation uses the configured compaction model and the owner's OpenRouter
connection/ZDR preference, with an operation journal and ancillary usage record.
Local conversations use an owned local helper on their selected runtime and model;
compaction does not introduce a cloud-key requirement for local-only users.

Empty, failed, ambiguous or fenced-out results cannot advance coverage. An
ambiguous provider dispatch is not automatically resent. The prior head and raw
history remain; the canonical turn exposes failure and the existing explicit retry
path. If protected content alone exceeds the usable window, generation reports a
context-size error instead of dropping uncovered messages.

## Native context identity

Cloud and native preparation consume the same captured summary and tail. Summary
ID and digest participate in prepared context compatibility, even if two versions
have identical summary text. A changed head follows the existing fresh-session
path; an unchanged compatible head can reuse the acknowledged native frontier.
The canonical chat and participant identity survive a native session reset.

Codex can compact its private session independently. That does not advance a
NanthAI coverage cursor, export hidden reasoning, or prove canonical delivery.
Private native state remains executor-owned cache state. Existing receipt/fence
checks determine whether to resume or rebuild from canonical context.

Chat/account deletion drains summary heads, manifests, staged chunks and pending
work through the existing teardown and purge owners. See
[context assembly](context-assembly.md),
[runtime ownership](../runtime/architecture.md) and
[M59 acceptance](../../milestones/M59-telegram-persona-conversations.md).
