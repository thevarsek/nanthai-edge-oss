# External AI client access through MCP

This server lets a compatible external AI client work with the user's NanthAI
account. It is separate from [remote MCP connections](remote-mcp.md), where
NanthAI consumes another server's tools.

## Product capabilities

| Capability | Canonical behavior |
|---|---|
| Read context | Owned chats, messages, published artifacts and accessible memories |
| Send work | Start a conversation with a selected Persona or send to an existing chat; tools and the paired computer need their own scopes |
| Publish output | Store external text or a supported file in normal chat history |
| Run a schedule | Run an existing saved job through ordinary Run Now behavior |
| Stop work | Cancel an owned run through centralized fencing and teardown |

Generation uses the selected Persona's normal route and costs. Published external
output does not invent NanthAI inference usage. Shared-memory writes and schedule
creation/editing are outside the current server scope. Access does not confer
arbitrary shell control or forward native provider tokens.

## Scopes

| Scope | Allows | Consent default |
|---|---|---|
| `history:read` | Read owned chats, messages, artifacts and memories | Ticked |
| `chat:write` | Send a text-only cloud turn: tools, connected apps and search are off | Ticked |
| `chat:tools` | Let that turn use tools and the user's connected apps | Unticked |
| `runtime:local` | Send to a Persona or chat routed to the paired computer; requires `chat:tools` | Unticked |
| `results:write` | Publish a result into chat history | Ticked |
| `jobs:run` | Run an existing saved schedule | Ticked |
| `runs:stop` | Stop owned work | Ticked |

The backend enforces the same rules as the consent page. A grant that includes
`runtime:local` without `chat:tools` is refused (`invalid_scope`). A send without
`chat:tools` runs with tools disabled. Collaboration and advanced research sends
need tools, so without `chat:tools` they are refused. If any participant resolves
to the paired computer and the grant lacks `runtime:local`, the send fails with
`SCOPE_REQUIRED` and asks the user to reconnect the client with that permission.
Connections authorized before `chat:tools` existed keep only the scopes they hold.
Their sends become text-only until the user reconnects. The connection list
payload is unchanged, so released apps show any new scope by its raw name.

## Authorization and revocation

The client uses browser OAuth: sign in to NanthAI, select requested capabilities
independently and return to the external client. Read access covers owned account
data; per-chat grants are not part of this release. The single-use code expires
after ten minutes and access tokens last one hour. Refresh tokens rotate on every
use and the server stores only their hashes. A connection can be refreshed for 90
days after authorization. It also ends after 30 days without a refresh. Grants made
before these limits were added count their 90 days from creation. These lifetimes
govern the connection, not model execution.

Replay revokes the whole connection. That covers two cases. The first is a rotated
refresh token presented more than 60 seconds after rotation; a retry inside that
window, after a lost response, rotates again. The second is an authorization code
presented a second time. Both return `invalid_grant`. Blocked or deleting accounts
fail authentication with `invalid_token` and refresh or code exchange with
`invalid_grant`. See [account access blocks](../operations/credential-security-rotation.md#account-access-blocks).

Dynamic client registration accepts a JSON body of at most 8 KB. The client name
can be up to 100 characters. A client can register up to five redirect URIs of at
most 512 characters each. An hourly cleanup removes expired authorization requests
and refresh-token history older than 90 days. It also removes registered clients
older than 24 hours that never obtained a grant.

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
