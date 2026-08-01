# Remote MCP support and troubleshooting

## Compatibility

NanthAI Edge supports remote servers with all of these properties:

- public `https://` endpoint on port 443;
- stateless MCP protocol revision `2026-07-28`;
- `server/discover` and self-contained requests;
- no initialize handshake, protocol session, or `Mcp-Session-Id` requirement.

Supported server content includes tools, prompts, resources, resource templates, protocol-native form and URL input requests, and the Tasks extension. MCP Apps, local stdio servers, unsolicited notifications, resource subscriptions, sampling, roots, and older/session-based transports are not included in M49.

Authentication options are no authentication, end-user OAuth discovered from the server, user-supplied OAuth client credentials, bearer token, or an API key in a restricted custom `X-` header. NanthAI does not support a server that requires the product itself to be manually registered unless the user can supply those client credentials.

## What users control

Connecting a server does not expose all of its content automatically. Each discovered tool, prompt, resource, and template begins disabled. The user can allow or disable each item and can disable or disconnect the entire server at any time. Allowed tools may run when the model decides they are relevant; NanthAI does not add a confirmation before every use. If the remote server itself requests input or confirmation through the protocol, the request pauses and appears in chat.

An enabled server can be selected for a chat and assigned to Personas or Skills. Prompts and resources are attached explicitly as Remote MCP context for a message. Tool traces show both the friendly server name and the published item name.

## Common errors

| Message or state | Meaning | What to do |
|---|---|---|
| Unsupported server | The endpoint did not negotiate stateless MCP `2026-07-28`, attempted a session, redirected, or returned an invalid discovery response. | Ask the server owner for its current v2 HTTPS endpoint. |
| Unsafe endpoint | The URL is not public HTTPS port 443, resolves to a private/special address, contains credentials, or uses a blocked hostname. | Use the provider's public remote endpoint. Localhost and LAN servers are intentionally unsupported. |
| Authentication required | The server returned an authentication challenge. | Choose OAuth, bearer token, or API key and reconnect. |
| Reconnect required | The token expired and could not be refreshed safely, or the issuer/resource binding changed. | Run the connection flow again; do not reuse an old callback. |
| Item disabled | The item is not allowed, was removed on refresh, or its schema exceeded safety limits. | Review the server catalog and enable a compatible item. |
| Waiting for input | The remote request returned protocol-native input requirements. | Open the pending request in chat and accept, decline, cancel, or provide the requested fields. |
| Task expired or failed | The remote Task reached a terminal error or exceeded its declared lifetime. | Review the safe error, then start a new request if appropriate. |

## Security boundary

Remote servers are third parties. Their names, descriptions, schemas, prompts, resources, errors, and URLs are untrusted. NanthAI bounds and attributes their content, prevents credentials from being forwarded to another origin, routes all arbitrary endpoint traffic through DNS-pinned public-network egress, and redacts provider bodies and secrets from user-facing errors and logs.

For the protocol background, see the [official MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/), [MCP architecture documentation](https://modelcontextprotocol.io/docs/learn/architecture), and [Tasks extension overview](https://modelcontextprotocol.io/extensions/tasks/overview).
