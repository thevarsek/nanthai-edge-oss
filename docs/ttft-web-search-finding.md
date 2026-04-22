# Web Search TTFT Finding (Apr 2026)

> When `openrouter:web_search` is attached to a chat completions request, OpenRouter executes the search synchronously **before streaming any model output**. First-byte latency is pinned at 6–10 seconds regardless of model, provider, or prompt cache state. This is load-bearing cost (the search produces real citations), not overhead — but it means "fast TTFT" is only achievable when web search is disabled on the request.

## Symptom

iOS / web chat feels slow on the first token whenever the globe icon is toggled on. Measured time-to-first-SSE-delta from Convex fetch dispatch to first content chunk: **~10,000 ms**, consistent across repeated messages.

The same user toggling the globe off produces first content in **1–2 seconds**.

## Investigation timeline

1. **Suspected: Convex isolate cold-start / outbound network.**
   Added instrumentation to `convex/lib/openrouter_stream.ts` (reverted after) that measured (a) `JSON.stringify` time, (b) actual `fetch()` time-to-headers, (c) a parallel trivial GET to `openrouter.ai/api/v1/auth/key` from the same isolate.
   Result: stringify 0 ms, body 24–25 KB, baseline GET **14–36 ms**. Convex outbound is healthy. Disproven.

2. **Suspected: prompt-cache miss due to volatile system prompt.**
   Dumped two consecutive production request bodies via chunked logging, reassembled them, and diff'd. `messages[0]` (static app preamble + skill catalog, 17 KB / ~4.3K tokens) was byte-identical between turns. `messages[1]` (memory context) varied slightly but not enough to explain 10 s — OR's own `generation` record confirmed `native_tokens_cached: 2816` and upstream `latency: 2623 ms` on turn 2. The 7 s gap was **not** inside the provider. Disproven.

3. **Suspected: `provider.sort: "latency"` introducing probe overhead.**
   Bisected the Convex body by stripping one field at a time and replaying via curl from a different origin. Result: removing `provider.sort`, pinning `provider.order` to Moonshot / Parasail / Novita, removing `transforms`, removing `reasoning` — all still ~10 s. Disproven.

4. **Found: `tools[]` is the cause — specifically the web-search server tool.**
   Removing `tools` + `tool_choice` dropped TTFB from 10.1 s → 2.5 s. Removing the web-search entry alone dropped TTFB to 1.1–1.8 s. Removing the four function tools (keeping only web-search) left TTFB at 10.1 s.

## Measurements

All curl replays of the exact Convex-constructed body against `https://openrouter.ai/api/v1/chat/completions` with `stream: true`, `model: moonshotai/kimi-k2.6`, prompt ~5.1K tokens. TTFB = `curl %{time_starttransfer}`.

| Variant                                              | TTFB        |
| ---------------------------------------------------- | ----------- |
| Full body (4 function tools + web-search)            | **10.12 s** |
| Full body minus web-search, keep 4 function tools    | **1.13 s** ✅ |
| Empty `tools: []`, no `tool_choice`                  | 2.02 s      |
| Only `openrouter:web_search`, no function tools      | 10.12 s     |
| `plugins: [{ id: "web" }]` + 4 function tools        | 6.40 s      |
| `tool_choice: "none"` with full tools                | 10.28 s     |

Curl control (identical prompt, no tools, raw kimi via `provider.order: ["Moonshot AI"]`, warm cache): **2.2 s**.

## Conclusion

- `type: "openrouter:web_search"` is synchronous. OR emits `: OPENROUTER PROCESSING` SSE keepalive comments while the search runs and only begins streaming model tokens after the search completes.
- The older `plugins: [{ id: "web" }]` form is ~4 s faster (6.4 s vs 10.1 s) but still blocks streaming.
- Even `tool_choice: "none"` does not bypass the cost — OR reacts to the mere presence of the server tool in the array.
- The cost is upstream search execution, not Convex or network. Honest latency for a grounded response.

## Product implications

- **Opt-in is correct and already implemented.** Web search attaches only when the user toggles the globe on for that message (`params.webSearchEnabled`). See `convex/lib/openrouter_request.ts:81–88`. Default chats are fast (~2 s TTFB); grounded chats are slow (~10 s) by necessity.
- Any UX that implies "fast" should not auto-attach web search.
- A future optimization would be to stream a "searching the web…" status chunk to the client while OR is running the search, so the 10 s feels intentional rather than broken. The server-side code can't do that (OR owns the connection during the stall), but the client can show a spinner keyed on `webSearchEnabled` until the first content chunk arrives.

## What we could do next (not done)

1. **Switch to `plugins: [{ id: "web" }]` for all web-search requests** — ~4 s faster for free, zero product change. Still slow.
2. **Run our own search (Perplexity/Brave/Tavily) in parallel with the model request and stitch results into the system prompt** — recovers ~2 s TTFT with citations, but multi-day work and duplicates what OR already does.
3. **Lightweight query classifier** that skips web-search attachment when the model is unlikely to need it (code questions, local context, rewriting) — smaller lift, requires taste in deciding when to skip.

No change to backend code is being shipped with this finding. Opt-in behavior is already correct.

## Post-fix measurements (web search off, live dev logs Apr 22 04:43)

With the globe toggled off on the same warm kimi-k2.6 conversation:

| Stage                                    | Duration   |
| ---------------------------------------- | ---------- |
| OpenRouter headers (fetch → response)    | **1,736 ms** (was 10,055 ms) ✅ |
| First SSE delta (content)                | 3,875 ms   |
| Total stream `durationMs`                | 4,585 ms   |

The ~2.1 s gap between OR headers and first content delta is reasoning-token emission (`reasoning.effort: "medium"`). Memory base query + cache hit run in parallel pre-dispatch (~991 ms + ~936 ms).

Remaining TTFT wins identified but not shipped:

- Memory base query / cache hit (~1 s) runs before body construction on every turn.
- `reasoning.effort` auto-tune for short messages (~2 s win when reasoning isn't needed).
- `plugins: [{ id: "web" }]` form for web-search requests (~4 s win when search IS on).

## Reproduction

See bisect script `/tmp/bisect.sh` (ephemeral) for the parameter matrix used above. Key body variants are derivable from a captured production body:

```bash
# Strip web-search server tool (keep 4 function tools)
jq '.tools = [.tools[] | select(.type != "openrouter:web_search")]' body.json
```
