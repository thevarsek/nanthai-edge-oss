# Telegram conversations

NanthAI connects a private Telegram bot chat to one owned NanthAI conversation.
Convex owns the account mapping, conversation, participants, context and execution.
The bot is a transport for that conversation. Production configuration and publication
remain separate release operations; see [M59](../../milestones/M59-telegram-persona-conversations.md).

## Connect an account

On web, iOS or Android, open Settings → AI connections → Telegram. Choose Connect
Telegram, open the managed bot and press Start. The short-lived opaque start payload
identifies the pending link; users do not copy or construct it themselves. Return to
NanthAI and confirm the displayed Telegram account while signed in.

Choose an existing owned conversation or create a new one using the normal NanthAI
model/Persona defaults. A starter Persona is optional for a new conversation; an
existing conversation retains its complete participant roster. The selector is labelled
Pick a conversation, with a separate Create a new conversation option. Read the future
reply delivery notice, then press Connect this conversation or Create and connect.
That action acknowledges delivery; there is no separate mandatory checkbox. Selection
alone is an unsaved draft and does not change Telegram routing. Creating and connecting
creates one conversation immediately, which subsequent Telegram messages continue.
Earlier chat history and the user's own NanthAI messages are
not exported. Each person links their own account and chooses their own conversation;
using the same managed bot does not share accounts, memory or history.

The connected screen shows the conversation and participants, with Open conversation,
Change conversation and Disconnect actions. Setup, confirmation, selection and recovery
use the same Convex functions on all three clients, with native forms on mobile.
Switching conversations changes a versioned binding, without merging their histories.

The conversation picker initially shows the newest 20 conversations by creation date,
independent of sidebar pins or recent activity. Search uses the owned title/preview
indexes across history; Load More reads older creation-ordered pages. All three clients
use `chat/queries:listChats` with `order: "created"`, `searchQuery`, and an optional
`beforeChatId` cursor. Search candidates retain the existing bounded search-index
read budget (500 per title/preview index); it is not a scan of only the loaded page.

## Conversation behavior

Telegram input uses `sendMessageForActor`, with the same current participants and
Parallel/Collaboration mode as NanthAI. Additional AIs can be added or removed through
the usual participant controls. There is no Telegram-specific participant lock or
separate mandatory Persona selector. Final assistant replies carry the speaker's name
only when the conversation has more than one AI. Single-AI replies remain plain.

Ordinary replies have no chat URL footer. Action notices direct the user to authenticated
NanthAI for approvals, questions or recovery. Links are included only when the deployment
has a public app origin; localhost, loopback and private/LAN origins are not sent.
DEV never substitutes the production app origin for a local-only URL.

`/status` reports the selected conversation; `/stop` cancels its queued/active work,
including media preparation and spoken replies. `/new` starts a conversation using
normal app defaults. `/persona N` remains an optional shortcut to start with an owned
Persona; `/persona` lists those choices. `/disconnect` revokes the connection and
preserves canonical chats. Commands are controls, not model instructions.

## Photos, files and voice

Photos, documents, videos and audio are imported through owned chat upload sessions
and the existing attachment contract. The normal model/runtime capability checks
continue to apply. Telegram's hosted Bot API currently downloads files up to 20 MB;
files it cannot provide remain a visible retained-input failure, with the option to
send the file directly in NanthAI. This is a transport limit, not an app usage quota.
See the [Telegram Bot API](https://core.telegram.org/bots/api#getfile).

Voice messages and audio files use the sender's OpenRouter key with
`openai/whisper-large-v3` through the [OpenRouter transcription API](https://openrouter.ai/docs/guides/overview/multimodal/stt).
The sender's ZDR preference is passed to the provider. NanthAI retains the original
recording and transcript in the canonical chat and records transcription usage once.
A missing key is detected before file downloads or provider calls. Telegram receives
a standard message explaining that OpenRouter is needed for voice and where to connect
it; the retained input can then be retried explicitly. Local text and supported file
work remain available.

Spoken assistant replies reuse the existing NanthAI automatic audio preference,
per-chat override, speech model, voice and output format. Telegram does not enable
audio automatically or choose a different speech default. Text is committed first;
audio is an independently owned result. MP3/M4A/OGG results use Telegram voice delivery;
other app formats are delivered as audio files without changing the user's format.
See [sendVoice](https://core.telegram.org/bots/api#sendvoice).

In NanthAI itself, a local-only user's recorded message can still receive a local text
reply. If automatic speech is enabled without an OpenRouter key, a shared message notice
explains the dependency and no speech run/loading flag is created. Manual read-aloud
and request-specific cloning also return actionable missing-key errors. Existing local
helpers continue to handle title/memory work through their established fallback.

## Durable admission and delivery

The verified private webhook deduplicates bot/update identity before acknowledging.
It captures immutable Telegram IDs, the account owner and the current binding revision.
Public wrappers resolve Clerk identity; internal channel admission delegates to the
same owned send/cancel services after validating the mapping. No public arbitrary-user
API or forged session is used.

File input reserves a pending canonical user message and active branch position on receipt. Preparation uses a
fenced maintenance Workflow, owned upload sessions and the operation journal. Later
app or Telegram turns wait for an earlier media input to finish preparing or fail.
When that input has committed replies, queued follow-ups inherit those replies as
parents before generation, preserving the media turn in their causal context.
Accepted turns use the shared channel Workflow queue in receipt order, across both
interfaces. A late transport update is accepted in arrival order and identified as late.
Response retries retain the original user message and recording but create a new queue
entry for the new generation job, ordered at the retry's creation time. Repeated dispatch
of the same generation job reuses its queue entry, including turns created before the
per-generation identity was introduced. Retry controls on web, iOS and Android use this
same backend path.
Cancellation closes the media writer before teardown; interrupted preparation terminalizes
the placeholder and wakes the existing queue. Retrying input resumes admission explicitly.

Final canonical output is published before an independent delivery outbox is scheduled.
Each delivery checks current identity/binding revision and source ownership. Audio delivery
also verifies that its storage object is the source message's current result. Confirmed
sends record Telegram message IDs. Rate-limit hints schedule delivery retries; ambiguous
sends are journaled as unknown and require the existing explicit resend choice. Repairing
delivery never reruns inference or tools. Telegram copies are independent third-party
copies; deleting NanthAI history cannot promise their universal erasure.

Chat/account deletion and disconnect reuse owned execution teardown. Local Persona turns
use the same paired Runtime Host, permissions, context receipts and capability matrix as
NanthAI. Approvals remain in signed-in NanthAI. The
[shared compaction contract](../architecture/conversation-compaction.md) preserves committed
summary plus complete uncovered tail for both interfaces; Telegram does not summarize
independently or export hidden native reasoning/local transcripts.

## Verification and operations

Test link claim ownership/expiry/replay, duplicate and reordered updates, full-roster
send, single/multi-AI formatting, media ordering and cancellation, transcription ownership
and usage, missing-key interception, audio defaults and delivery effects. Include composed
inbox → canonical send → outbox tests and actual DEV transport/provider checks. Fixture UI
screenshots prove rendering; they do not prove authenticated provider execution.

Set server-only `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_ID`, `TELEGRAM_BOT_USERNAME` and
`TELEGRAM_WEBHOOK_SECRET`, with `NANTHAI_WEB_ORIGIN` matching the app deployment. Configure
`/channels/telegram/webhook` on its Convex site with the same secret and supported message/
edited-message updates. Keep tokens and token-bearing request URLs out of logs, screenshots
and repository files. DEV and production use distinct configurations and release decisions.

When changing the managed DEV bot, verify its actual identity, detach the previous webhook,
configure the new webhook and relink the user's account. Never leave the normal connection
pointing at seeded memory/history QA. Retain test fixtures separately unless their owner
explicitly asks to delete them. Recover delivery through its outbox, input through retained
inbox retry, and generation through the canonical run controls. Disconnect stops new effects;
an already-dispatched external send may have reached Telegram.

Group chats, additional channel providers, private topics, historical Telegram imports
and purchases remain outside this release scope.

## Provider and browser qualification limits

The owner-approved `openai/whisper-large-v3` default transcribed a synthetic clip
with ZDR enabled. A fresh catalogue check on October 6, 2026 confirmed three ZDR
endpoints. It replaces `openai/whisper-1`, which had no matching ZDR endpoint.
Requests preserve the user's ZDR preference and retain input when the route fails;
there is no fallback that weakens that policy. Successful end-to-end delivery of the
owner's Sora voice reply remains unqualified following an upstream reply timeout.

Telegram Web K hides Start for an existing bot dialog. Its reconnect test therefore
used the one-time command for the existing authenticated confirmation flow. A proposed
optional copy-command fallback is awaiting approval; installed Telegram apps retain the
standard deep-link flow. Do not describe the proposed fallback as implemented.
