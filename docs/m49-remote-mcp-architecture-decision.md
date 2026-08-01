# M49 Remote MCP architecture decision

Status: accepted for release candidate
Protocol target: MCP `2026-07-28`
Last verified: 1 August 2026

## Decision

NanthAI accepts user-configured remote MCP servers only when they expose a public HTTPS endpoint on the default TLS port and negotiate the stateless `2026-07-28` protocol. Local stdio servers, the initialize-era session protocol, `Mcp-Session-Id`, private-network endpoints, redirects, and protocol downgrade are outside M49.

Convex remains the product API and source of truth. The official TypeScript v2 client runs only in narrow Node actions. Every outbound request crosses the Netlify egress function, which resolves and validates all DNS answers, rejects non-public addresses, pins the selected address into the TLS connection, preserves SNI/hostname verification, rejects redirects, forwards an allowlist of MCP headers, and bounds request size, response size, and time.

## P1 — final protocol and SDK wire behavior

- The client pins `2026-07-28`, requires the modern protocol era, rejects a transport session ID, and sends client capabilities on each request.
- `server/discover` replaces initialization. The SDK serializes `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, and declared `Mcp-Param-*` headers; the egress layer forwards those names but does not invent or rewrite them.
- Catalog list methods follow pagination with a hard maximum of 16 pages. Hitting the SDK cap is an error instead of accepting a partial, apparently complete catalog.
- Catalog reads always use `cacheMode: "refresh"`. SDK cache storage is partitioned by user and connection, missing TTL defaults to zero, and persisted catalog snapshots are private to their owner. NanthAI therefore never shares a server response cache between users or credentials.
- Authentication and server metadata are display input, not security decisions. Endpoint origin, discovered issuer, protected resource, and the OAuth transaction are validated and bound independently.

Evidence: `convex/mcp/sdk_client.ts`, `convex/mcp/gateway_fetch.ts`, `web/netlify/functions/_shared/mcpEgress.ts`, and their focused contract/conformance tests.

## P2 — egress and SSRF boundary

The egress function is the only arbitrary-endpoint network caller. It permits `GET` and `POST` to public HTTPS port 443, rejects URL credentials and fragments, validates ASCII host canonicalization, rejects private/special/reserved address ranges including mapped IPv6, rejects a hostname if any DNS answer is non-public, and pins DNS for the socket lifetime. It does not follow redirects. Ambient cookies, proxy headers, host overrides, forwarding headers, and undeclared custom headers are rejected.

Limits are 1 MiB request body, 4 MiB streamed response, 30 seconds at the egress boundary, 20–25 seconds for connection/discovery, and 55 seconds for an invocation. Convex persistence applies a tighter 256 KiB result ceiling.

## P3 — controlled conformance fixture

`web/netlify/functions/mcp-conformance.mts` is a deterministic v2-only server. It covers discovery; tools; prompts; resources; resource templates; bearer and API-key authentication; text, image, audio, embedded, binary, mixed, and oversized results; form and URL multi-round-trip input; Tasks get/update/cancel and terminal/input states; and strict request/header mismatch rejection. Older protocol traffic is rejected.

The fixture is authoritative in CI. Live public servers are compatibility evidence, never a deterministic test dependency or a source of provider-specific product logic.

## P4 — primitive-to-product mapping

| MCP primitive | NanthAI product surface | Standing control | Durable state |
|---|---|---|---|
| Tool | Model tool registry and visible chat trace | Allowed or disabled per item | Invocation, operation journal, run/attempt/fence, artifacts |
| Prompt | Explicit Remote MCP context picker | Allowed or disabled per item | Invocation plus attributed content blocks |
| Resource | Explicit context picker and attachment | Allowed or disabled per item | Invocation, storage-backed binary content, attributed context |
| Resource template | URI form followed by resource read | Allowed or disabled per item | Same as resource, with the resolved URI recorded |
| MRTR input | Pending request panel in chat | Protocol request, not a new standing grant | Invocation request state and input responses |
| Task | Progress/pending panel with update/cancel | Original item permission remains authoritative | M46/M47-owned Workflow, journal, teardown |

Content is bounded to 24 mapped items and 48,000 context characters. Binary payloads are stored in Convex storage, not embedded in model context. Catalog schemas are limited to 64 KiB, depth 24, and 4,096 nodes. A connection admits at most 500 total items and 128 tools. The runtime registry has 128 total slots, so first-party tools keep their existing slots and Remote MCP receives only the remainder.

## P5 — credential integration review

MCP credentials use the deployed `enc:v2` keyring and active `k2` key. AAD binds user, connection, issuer or endpoint origin, and credential purpose. OAuth state is high-entropy, hash-only, expiring, and transactionally single-use. PKCE verifiers, client secrets, access tokens, refresh tokens, and recoverable API credentials are encrypted. Refresh writes use revision compare-and-swap; disconnect and account deletion fence work and remove credential rows. Existing rotation, error redaction, and safe logging rules apply unchanged.

MCP credentials remain in their own tables. There are no per-user encryption keys, no plaintext fallback, no ciphertext in public queries, and no change to first-party connector APIs.

## P6 — provider budget and context measurements

The binding limits above were selected from the actual NanthAI execution path, not a single model vendor's advertised maximum. The model sees a maximum of 128 registered tools across first-party and Remote MCP sources; Remote MCP definitions are added only after existing registry entries. Descriptions are capped at 2,000 characters, names at 256, aliases at 64, and each schema at 64 KiB with structural complexity limits. Explicit prompt/resource context is capped separately from catalog definitions.

This makes provider changes fail predictably: an over-cap catalog item is disabled with a reason, an over-cap registry is truncated deterministically, and an oversized response fails before it can become a message or artifact. Provider-specific exceptions are not permitted.

## Release invariants

- Pro, ownership, connection enabled state, and item permission are checked in Convex at invocation time.
- There is no NanthAI confirmation before every tool call. Protocol-native MRTR input and Task input still pause and ask.
- Every new catalog item defaults to disabled, including items discovered after refresh.
- Released clients can ignore all new optional fields and continue decoding existing chats.
- Existing first-party connectors and the OpenRouter compatibility mutation remain unchanged.

## Client adapter ownership note

The iOS and Android product behavior is split into dedicated Remote MCP DTO, state-owner, settings, chat-context,
and pending-input files. The existing Android `ConvexGateway`, `RealConvexGateway`, and navigation owners remain broad
legacy composition roots; M49 adds only thin typed interface/default/transport calls and route registration there.
Extracting those existing roots in this release would change every gateway fake and unrelated navigation surface, so
that mechanical refactor is deliberately outside M49. Permission, entitlement, catalog, invocation, and Task rules
remain in Convex rather than those client adapters.
