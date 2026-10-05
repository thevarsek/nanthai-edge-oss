# Conversation compaction

## Current behavior

The tool loop can compact context while handling an overlong generation. Durable
tool memories and artifact summaries reduce retained tool output; exact authorized
artifacts can be rehydrated. These mechanisms do not persist one canonical
summary-plus-tail covering future conversation turns.

Codex may compact its own private native session. That does not advance a NanthAI
coverage cursor or prove that a shared summary covers the same public messages.
Pi/native session state also remains executor-owned cache state.

## Shared context boundary

Convex owns public branch history, source access and preparation. Native reuse
checks compatibility and the acknowledged delivered frontier. If context cannot
be safely replaced, a new native session uses the canonical prepared turn.
A retained private native summary cannot authorize access to a revoked source.

Persistent cross-turn summaries, explicit coverage identity, invalidation after
branch edits and summary-aware native compatibility are planned in
[Telegram and persistent compaction](../../milestones/M59-telegram-persona-conversations.md).
They are not implemented merely by describing that future contract.

See [context assembly](context-assembly.md) and
[runtime session ownership](../runtime/architecture.md).
