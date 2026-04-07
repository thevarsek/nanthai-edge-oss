# OpenRouter API Reference

> API endpoints, OAuth PKCE flow, request/response formats, SSE streaming, and required headers for NanthAI Edge's OpenRouter integration.

## Endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| `GET` | `https://openrouter.ai/api/v1/models` | List available models |
| `POST` | `https://openrouter.ai/api/v1/chat/completions` | Chat completions (streaming) |
| `GET` | `https://openrouter.ai/api/v1/credits` | Check user credits/balance |
| `POST` | `https://openrouter.ai/api/v1/auth/keys` | Exchange OAuth code for API key |
| `GET` | `https://openrouter.ai/auth` | OAuth authorization page |

## OAuth PKCE Flow

```
 1. Generate random 64-char verifier string (a-zA-Z0-9-._~)
 2. SHA-256 hash the verifier → base64url encode → code_challenge
 3. Generate cryptographically random OAuth `state` string
 4. Open in browser/ASWebAuth:
    https://openrouter.ai/auth
      ?callback_url=nanthai-edge://auth/callback
      &code_challenge={challenge}
      &code_challenge_method=S256
      &state={state}
 5. User authorizes on OpenRouter
 6. Redirect to: nanthai-edge://auth/callback?code={authorization_code}&state={state}
 7. Verify callback `state` exactly matches originally generated state
 8. POST https://openrouter.ai/api/v1/auth/keys
    Body: { "code": "{code}", "code_verifier": "{verifier}", "code_challenge_method": "S256" }
 9. Response: { "key": "<your-openrouter-api-key>" }
10. Store key in Keychain and clear temporary verifier/state
```

## Chat Completion Request

```json
POST /api/v1/chat/completions
{
  "model": "anthropic/claude-3.5-sonnet",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello!" }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 4096
}
```

## Tool / Function Calling

OpenRouter uses the OpenAI-compatible `tools` parameter for tool calling. The LLM does **not** execute tools — it responds with `tool_calls` indicating which tool to call and with what arguments. The client executes the tool, then sends results back for continued generation.

**Supported models**: Filter at `https://openrouter.ai/models?supported_parameters=tools`.

### Tool Definition Format

Tools are defined using JSON Schema in the `tools` array:

```json
{
  "type": "function",
  "function": {
    "name": "GITHUB_CREATE_ISSUE",
    "description": "Create a new issue in a GitHub repository",
    "parameters": {
      "type": "object",
      "properties": {
        "owner": { "type": "string", "description": "Repository owner" },
        "repo": { "type": "string", "description": "Repository name" },
        "title": { "type": "string", "description": "Issue title" }
      },
      "required": ["owner", "repo", "title"]
    }
  }
}
```

### Step 1: Chat Completion Request with Tools

Include `tools` array alongside `messages`. The `tools` array must be included in **every** request (both initial and follow-up) so the router can validate the schema on each call.

```json
POST /api/v1/chat/completions
{
  "model": "anthropic/claude-sonnet-4.5",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Create an issue on my repo about the login bug" }
  ],
  "tools": [ /* tool definitions */ ],
  "stream": true
}
```

Optional parameters:
- `tool_choice`: `"auto"` (default), `"none"`, or `{ "type": "function", "function": { "name": "specific_tool" } }`
- `parallel_tool_calls`: `true` (default) or `false` — controls whether model can request multiple tool calls at once

### Step 2: Model Responds with `tool_calls`

The response message has `finish_reason: "tool_calls"` and a `tool_calls` array:

```json
{
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "GITHUB_CREATE_ISSUE",
          "arguments": "{\"owner\": \"org\", \"repo\": \"app\", \"title\": \"Login bug\"}"
        }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

Key fields:
- `tool_calls[].id` — unique ID, must be echoed back in `tool_call_id`
- `tool_calls[].function.name` — tool to execute
- `tool_calls[].function.arguments` — JSON string of arguments

### Step 3: Send Tool Results Back

Append the assistant's message (with `tool_calls`) and tool results (as `role: "tool"` messages) to the conversation, then call the API again:

```json
POST /api/v1/chat/completions
{
  "model": "anthropic/claude-sonnet-4.5",
  "messages": [
    { "role": "user", "content": "Create an issue on my repo about the login bug" },
    {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "GITHUB_CREATE_ISSUE",
          "arguments": "{\"owner\": \"org\", \"repo\": \"app\", \"title\": \"Login bug\"}"
        }
      }]
    },
    {
      "role": "tool",
      "tool_call_id": "call_abc123",
      "content": "{\"id\": 42, \"html_url\": \"https://github.com/org/app/issues/42\"}"
    }
  ],
  "tools": [ /* same tool definitions */ ],
  "stream": true
}
```

The model then generates a final response incorporating the tool result.

### Agentic Loop

For multi-step tool use, repeat until the model responds without `tool_calls`:

```
1. Send messages + tools to OpenRouter
2. If response has tool_calls:
   a. Append assistant message (with tool_calls) to messages
   b. Execute each tool call
   c. Append each result as role: "tool" message
   d. Go to step 1
3. If response has no tool_calls (finish_reason: "stop"):
   → Final response, display to user
```

Safety: cap iterations (e.g. max 10) to prevent runaway loops.

### Streaming with Tool Calls

When `stream: true` and the model returns tool calls, the SSE stream delivers `tool_calls` via deltas:

```
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_abc123","type":"function","function":{"name":"GITHUB_CREATE_ISSUE","arguments":""}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"owner\":"}}]}}]}

data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":" \"org\"}"}}]}}]}

data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}

data: [DONE]
```

The client must accumulate `function.arguments` chunks across deltas for each tool call `index`, then parse the complete JSON string once `finish_reason: "tool_calls"` arrives.

### OpenRouter Does NOT Natively Proxy External Tool Servers

OpenRouter does **not** forward external tool server URLs to providers. NanthAI handles all tool execution server-side in Convex actions: the tool registry provides OpenAI-compatible `tools` definitions → OpenRouter returns `tool_calls` in assistant messages → Convex actions execute the tools and feed results back into the conversation loop.

## SSE Stream Format

### Standard text response:

```
data: {"id":"gen-...","model":"anthropic/claude-3.5-sonnet","choices":[{"index":0,"delta":{"role":"assistant","content":"Hello"},"finish_reason":null}]}

data: {"id":"gen-...","model":"anthropic/claude-3.5-sonnet","choices":[{"index":0,"delta":{"content":"!"},"finish_reason":null}]}

data: {"id":"gen-...","model":"anthropic/claude-3.5-sonnet","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}

data: [DONE]
```

### Tool call response:

See "Streaming with Tool Calls" above for the SSE delta format when the model returns `tool_calls`.

## Required Headers

```
Authorization: Bearer <your-openrouter-api-key>
HTTP-Referer: https://nanthai.tech
X-Title: NanthAI Edge
Content-Type: application/json
```

---

## Audio Model Responses (Lyria)

Google Lyria music generation models (`google/lyria-3-clip-preview`, `google/lyria-3-pro-preview`) use the standard `chat/completions` endpoint with no special request parameters — standard `model` + `messages` payload. The response arrives as three distinct SSE phases:

### Phase 1: Text Content
Standard `delta.content` (string) containing timestamped lyrics and a caption. Identical to any other model.

### Phase 2: Audio Data
A single event with `delta.audio.data` containing a base64-encoded MP3 chunk:

```
data: {"choices":[{"delta":{"audio":{"data":"SUQzBAAAAAAAI1RTU0UAAAAP..."}}}]}
```

Key differences from OpenAI GPT audio:
- No special request parameters needed (no `modalities`, no `audio` config)
- `delta.content` is always a string (never an array of content parts)
- Audio lives in `delta.audio.data`, not `delta.content`
- Format is MP3 (ID3v2.3.0 + MPEG frames) — must be inferred, no MIME type in response
- One single audio chunk per response (not interleaved)

### Phase 3: Stop
```
data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{...}}
data: [DONE]
```

### Pricing
| Model | Output | Price |
|-------|--------|-------|
| `google/lyria-3-clip-preview` | 30-second clips | $0.04/request |
| `google/lyria-3-pro-preview` | Full-length songs (~3 min) | $0.08/request |

Note: Lyria models report $0 token prices but charge per-request. The `:free` slug suffix is the reliable way to detect free models.

---

## Prompt Caching

Anthropic models require explicit opt-in for prompt caching via a top-level `cache_control` field:

```json
{
  "model": "anthropic/claude-sonnet-4",
  "messages": [...],
  "stream": true,
  "cache_control": { "type": "ephemeral" }
}
```

This lets Anthropic place cache breakpoints at the last cacheable block, reusing previous context as the conversation grows. Other providers (OpenAI, DeepSeek, Gemini 2.5, Grok, Groq) cache automatically — no special handling needed.

NanthAI adds `cache_control` automatically for all `anthropic/` model requests in `openrouter_request.ts`.

---

*Source: Extracted from `plan.md` §9 — OpenRouter API Reference. Last updated: 2026-04-07 — Lyria audio model SSE format, prompt caching.*
