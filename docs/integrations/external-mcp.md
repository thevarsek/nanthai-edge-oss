# External AI client access through MCP

This server lets a compatible external AI client work with the user's NanthAI
account. It is separate from [remote MCP connections](remote-mcp.md), where
NanthAI consumes another server's tools.

## Product capabilities

| Capability | Canonical behavior |
|---|---|
| Read context | Owned chats, messages, published artifacts and accessible memories |
| Send work | Start a conversation with a selected Persona or send to an existing chat |
| Publish output | Store external text or a supported file in normal chat history |
| Run a schedule | Run an existing saved job through ordinary Run Now behavior |
| Stop work | Cancel an owned run through centralized fencing and teardown |

Generation uses the selected Persona's normal route and costs. Published external
output does not invent NanthAI inference usage. Shared-memory writes and schedule
creation/editing are outside the current server scope. Access does not confer
arbitrary shell control or forward native provider tokens.

## Authorization and revocation

The client uses browser OAuth: sign in to NanthAI, select requested capabilities
independently and return to the external client. Read access covers owned account
data; per-chat grants are not part of this release. The single-use code expires
after ten minutes; access tokens last one hour and are refreshable until revocation.
These lifetimes govern the connection, not model execution.

Revocation prevents further reads and commands immediately. Previously accepted
work stays in normal history and continues; Stop is the separate cancellation
operation. Retried side effects use stable receipts so a repeated client request
does not start another paid turn or duplicate a published artifact.

## Qualification and distribution

DEV qualification covers authorization, discovery, scope enforcement, refresh,
revocation, duplicate publication/turns/Run Now, active Stop and accepted-work
continuation after revocation. Reports use existing artifact cards across clients.
This is not certification of every MCP client or a public production endpoint.
Release status belongs to [runtime productization](../../milestones/M54-runtime-host-productization.md).

Implementation owners are under `convex/external_mcp/`; chats, schedules,
artifacts and cancellation delegate to existing product owners.
