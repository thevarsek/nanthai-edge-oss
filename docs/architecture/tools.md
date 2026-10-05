# Tools, skills and connected applications


### Execution pipeline

The app's hand-rolled `convex/lib/openrouter_*` streaming pipeline is extended with tool-call support rather than migrating to `@convex-dev/agent`. Rationale: fundamental data model mismatch (tree-branched messages vs. linear threads), multi-model fan-out incompatibility, and ~20 OpenRouter-specific features that would be lost.

### Skill-led progressive tool loading

The current architecture now uses additive, skill-led profile expansion during the tool loop:

1. start with a small base registry
2. inject a NanthAI prelude, runtime guard, and lightweight skill catalog
3. when the model calls `load_skill`, read `requiredToolProfiles`
4. rebuild the next-turn `tools` array from the expanded active profile set
5. continue the loop with the newly available domain tools

This keeps ordinary requests lightweight while still allowing specialized workflows to unlock docs, integrations, analytics, or workspace capabilities on demand.

For a product-facing summary of which tiers expose which skills and tool families, see [../product/tool-skill-access.md](../product/tool-skill-access.md).

### Tool Infrastructure

Current tool registration is progressive rather than always-on:

| Layer | Role |
|---|---|
| Base registry | `load_skill`, `list_skills`, `search_chats`, `fetch_image`, plus direct document tools only when attachments require them. |
| Profile registries | Add docs, scheduled jobs, personas, skill-management mutators, connected apps, analytics, workspace/runtime, and subagents after loaded skills or explicit context require those profiles. |
| Lightweight proxies | Provider and analyzer-fragile document tools expose stable names/descriptions/schemas without importing their real implementation modules into ordinary chat action initialization. |
| Internal action dispatchers | Provider/document action modules reconstruct a serializable `ToolExecutionContext`, validate the requested tool name, dynamically import the real implementation, and return the existing `ToolResult` shape. |
| Dedicated Node participant path | Runtime/workspace tools stay direct on the Node generation path so same-generation `workspaceSandbox` state remains in memory; ordinary `chat/actions` stays free of `just-bash`, Vercel sandbox, PDF runtime, and provider SDK imports. |

M43 restored the previously disabled heavy tool families with this boundary:

- Gmail manual tools: `gmail_*` proxies -> `tools/google/gmail_actions:executeGmailTool`
- Google Drive/Calendar: `drive_*` and `google_calendar_*` proxies -> `tools/google/actions:executeGoogleTool`
- Microsoft 365, Notion, Slack, and Cloze: provider proxy barrels -> provider `actions.ts` dispatchers
- PPTX generate/edit and DOCX tracked-change proposals: document authoring proxies -> `tools/pptx_actions.ts` / `tools/docx_edit_actions.ts`
- Uncached PDF extraction from `read_document`: isolated through `documents/pdf_extraction_actions.ts`

### Tool Execution Flow

1. `buildProgressiveToolRegistry(...)` creates a small base registry, then later turns expand it with profile-specific tools after `load_skill`
2. Registry's `getDefinitions()` produces OpenAI-format `tools` array injected into OpenRouter request
3. If OpenRouter responds with `finish_reason: "tool_calls"`, `runToolCallLoop()` takes over
4. Loop: parse tool calls → execute via `registry.executeTool()` → append `{role: "tool", tool_call_id, content}` → re-stream with all messages + tools
5. Workflow continues completed rounds until the generation finishes, fails or is cancelled; journal chunks are not a product round quota
6. Each loop iteration streams content to the user via `StreamWriter`

### Tool Gating Strategy

- **Base tools**: Minimal shared registry for normal tool-capable chats (`load_skill`, `list_skills`, `search_chats`, `fetch_image`).
- **Profile-expanded tools**: Documents, scheduled jobs, personas, skill-management mutators, connected apps, runtime/analytics, and subagents are added on later turns after a loaded skill unlocks the corresponding `requiredToolProfiles`.
- **Connection-gated tools**: Google Workspace, Microsoft 365, Notion, Apple Calendar, Slack, and Cloze profiles only register tools when the relevant integrations are both requested and actually connected.
- **Subagent tool**: `spawn_subagents` now lives behind the `subagents` profile, so it is only exposed after a loaded skill calls for delegated parallel work. Child runs never receive this tool.

### Subagent Execution Flow

1. Parent request starts without `spawn_subagents` in the base registry.
2. If a loaded skill unlocks the `subagents` profile, the next parent turn includes `spawn_subagents`.
3. Parent model emits a `spawn_subagents` tool call with 1-3 focused tasks.
4. Convex persists the parent tool-call round, creates a `subagentBatch`, and exits the parent action cleanly.
5. Each child run streams independently using the same participant/model/settings/integrations as the parent, minus `spawn_subagents`.
6. Each child advances through fenced Workflow-owned rounds, retaining domain checkpoints and chaining bounded journals.
7. When all children are terminal, Convex reconstructs the parent tool round and injects a synthetic tool result containing all child summaries and statuses.
8. A fresh OpenRouter request resumes the parent into the same visible assistant message.

Terminal child states:

- `completed`
- `failed`
- `cancelled`
- `timedOut`

### Integration Toggle Flow

```
Settings defaults (`integrationDefaults`)
    ↓
Persona overrides (`integrationOverrides`)
    ↓
Chat overrides (`integrationOverrides`)
    ↓
Turn-level overrides (slash chips / per-message request)
    ↓
Effective integrations sent as `enabledIntegrations` in sendMessage args
    ↓
Backend: parallel check Google + Microsoft + Notion + Apple Calendar + Slack + Cloze connection status
    ↓
Intersection: only integrations with active connections are passed as `enabledIntegrations` to `buildProgressiveToolRegistry(...)`
    ↓
Tool registry includes only relevant tool groups
```

Per-chat overrides are persisted to the `chats` table for: temperature, max tokens, reasoning (include + effort), subagent toggle, search settings (web search on/off, search mode, search complexity), and M30 skill/integration overrides. All follow the same pattern — `nil`/absent = inherit from the broader layer above.

### External Integration Connection Flows

Google, Microsoft, Notion, and Slack follow the same general iOS → Convex token exchange pattern (with provider-specific differences). Cloze uses API key auth instead of OAuth:

1. iOS opens `ASWebAuthenticationSession` with provider's consent screen
2. User authorizes → callback with authorization code
3. iOS calls Convex action (`exchangeGoogleCode` / `exchangeMicrosoftCode` / `exchangeNotionCode` / `exchangeSlackCode`) with code + verifier/state
4. Convex exchanges code for tokens via provider's token endpoint
5. Tokens encrypted into user/provider/field-bound `enc:v2` envelopes in `oauthConnections`; metadata such as expiry, scopes and email remains queryable
6. Auto-refresh: tool auth helpers check expiry before each API call, refresh transparently

**Key differences:**
- **Google** uses PKCE + `client_secret` in token exchange (iOS client type)
- **Microsoft** uses PKCE. Native/custom-scheme callbacks use the public client without a secret; HTTPS web callbacks use the confidential web client and a server-held client secret. The chosen client type is retained for refresh.
- **Notion** uses HTTP Basic Auth (`base64(client_id:client_secret)`) for token exchange — no PKCE. JSON request body (not form-encoded). OAuth redirect goes through an HTTPS callback because Notion requires `https://` redirect URIs. No scopes — access is page-level (user chooses during OAuth consent).
- **Apple Calendar** is not OAuth-based in the current design. iOS collects the Apple Account email that owns the iCloud calendar plus an Apple app-specific password. Convex encrypts those credentials, discovers the user's CalDAV calendars, and executes server-side event CRUD through a direct CalDAV client isolated behind the Apple action boundary.
- **Slack** uses OAuth 2.0 with `client_secret` in token exchange. Workspace-level authorization — user selects channels during OAuth consent. User token (`xoxp-`) stored in `oauthConnections`. Slack tool calls go through Slack's hosted **Model Context Protocol endpoint** (`https://mcp.slack.com/mcp`), not the Web API — a weekly `checkSlackMcpDrift` cron diffs Slack's live `tools/list` against a committed snapshot (`convex/tools/slack/mcp_tools_snapshot.ts`) to detect upstream schema changes. See [`tool-skill-access.md`](../product/tool-skill-access.md#slack-mcp-tools--hosted-mcp-and-drift-detection) for details.
- **Cloze** uses API key authentication (no OAuth). User provides their Cloze API key directly; Convex encrypts it in `oauthConnections` (reusing the same table with `provider: "cloze"`).

**API call pattern:** Google, Microsoft, Notion, and Cloze API calls use raw `fetch()` against provider REST APIs — no Node.js SDKs (`googleapis`, `@microsoft/microsoft-graph-client`). Slack uses raw `fetch()` against Slack's hosted MCP JSON-RPC endpoint instead of the Web API. Apple Calendar uses the repo's direct CalDAV client. Provider implementations load through internal action dispatchers instead of through the progressive registry import graph.

### File Storage & Download

- Tools store generated files via `ctx.storage.store(blob)` → returns `storageId`
- `convex/http.ts` exposes a `/download?storageId=X&filename=Y` HTTP endpoint for named file downloads
- Security: no auth on download endpoint — relies on unguessability of 128-bit random storage IDs (same as Convex's built-in `storage.getUrl()` signed URLs)

### OpenRouter Tool-Call Protocol

- Request: `tools` array of `{type: "function", function: {name, description, parameters}}`, optional `tool_choice`
- `tools` param must be included in EVERY request (initial + follow-up with tool results)
- SSE streaming: `choices[0].delta.tool_calls` arrives incrementally (index-based merging)
- Finish: `finish_reason: "tool_calls"` triggers execution loop
- Tool results: `{role: "tool", tool_call_id, content}` messages fed back with full `tools` array

---
