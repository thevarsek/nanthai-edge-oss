# Web Search TTFT Finding (Apr 2026)

> OpenRouter executes `openrouter:web_search` synchronously before streaming any model output. TTFB is dominated by **which search backend OR chooses**, and that choice depends on (a) the model provider's native-search support and (b) whether `provider.zdr: true` is set. The fast path is gpt-5.4 / Anthropic / xAI with native search and no ZDR (≤1.3 s). The slow path is anything routed to Exa, which includes every search request under ZDR, regardless of model (~10 s).

## Decision (Apr 2026) — switched to `plugins: [{id:"web"}]` form

We migrated the universal web-search path from `tools: [{type:"openrouter:web_search"}]` (server-tool form) to `plugins: [{id:"web", max_results: 5}]` (plugin form).

**Why:** the two forms use the same engine pool (native / Exa / Firecrawl / Parallel) with the same native-search allowlist, but they differ in **how results reach the model**:

- **Server-tool form**: adds a model round-trip — the model emits a tool call, OR runs the search, results go back, the model generates a second response. TTFB includes two model passes.
- **Plugin form**: OR fetches search results up-front from the query and injects them into the prompt before the single model pass. TTFB includes one model pass.

**Fair head-to-head at identical `max_results: 5`** (OR's default on both forms; see `/tmp/ttft_fair.txt`):

| Model | no web search | server tool | plugin |
| ----- | ------------- | ----------- | ------ |
| `moonshotai/kimi-k2.6` | 1.67 s | **10.22 s** | **4.19 s** (6.0 s faster) |
| `openai/gpt-5.4` (native search) | 1.11 s | 0.78 s | 0.51 s |

The 6 s win on kimi (and on any other non-native-search model routing to Exa) is the whole point. gpt-5.4 uses native search either way and is fast on both.

**Why `max_results: 5` and not 3?** `max_results: 3` measured ~1 s faster than 5 on kimi in an earlier probe, but we kept OR's default (5) to avoid a tuned magic number. The 10 s → 4 s win is what matters; shaving another 1 s is not worth the explanation surface area.

**`engine` is intentionally unset** so OR auto-selects: native for OpenAI / Anthropic / xAI / Perplexity, Exa for everything else.

**Deprecation risk:** OR's plugin docs say "deprecated, use the server tool instead." No sunset date announced. When that changes, we revert to the server-tool code in git history (see git blame of `convex/lib/openrouter_request.ts` — `openrouter:web_search` was last present before the Apr 2026 plugin migration commit).

The regression test in `convex/tests/openrouter_helper_edges.test.ts` now **forbids** `openrouter:web_search` from appearing on the wire under any code path.

## Symptom

iOS / web chat with the globe toggled on: first token takes ~10 s for some model/config combinations, ~1 s for others. The original report was kimi-k2.6 always hitting 10 s; follow-up was gpt-5.4 hitting 10 s only when Google Workspace integrations were attached to the chat.

## Investigation timeline

1. **Disproven:** Convex outbound network (baseline `GET /api/v1/auth/key` from the same isolate = 14–36 ms).
2. **Disproven:** prompt-cache miss. Two consecutive production bodies were byte-identical on `messages[0]`; OR's generation record confirmed `native_tokens_cached` hits and upstream provider latency of ~2.6 s.
3. **Disproven:** `provider.sort`, `provider.order`, `transforms`, `reasoning` — stripping any of these individually did not move TTFB.
4. **Found:** the `openrouter:web_search` server tool is the cause. Even `tool_choice: "none"` doesn't bypass it — OR reacts to the tool's presence in the array.
5. **Found (follow-up):** adding `provider.zdr: true` makes the slow path universal — gpt-5.4 with web search drops from 1.3 s to 10.1 s, identical to kimi-k2.6. ZDR alone (no search) is fast. The interaction is the problem.

## Full grid (fresh Apr 22, single run)

All measurements: curl `%{time_starttransfer}` against `POST /api/v1/chat/completions` with `stream: true`, identical prompt (system 17 KB, 5 messages), identical function tools. Only the indicated fields vary.

### Model × ZDR × web search

| Model | ZDR | Web search | TTFB |
| ----- | --- | ---------- | ---- |
| `moonshotai/kimi-k2.6` | no  | no  | 5.28 s |
| `moonshotai/kimi-k2.6` | no  | yes | **10.13 s** |
| `moonshotai/kimi-k2.6` | yes | no  | 5.69 s |
| `moonshotai/kimi-k2.6` | yes | yes | **10.17 s** |
| `openai/gpt-5.4`       | no  | no  | **0.64 s** ⚡ |
| `openai/gpt-5.4`       | no  | yes | **1.29 s** ⚡ |
| `openai/gpt-5.4`       | yes | no  | 1.64 s |
| `openai/gpt-5.4`       | yes | yes | **10.12 s** |

### Server-tool form vs plugin form

Same prompt, web search enabled via either `tools: [{type:"openrouter:web_search",...}]` or `plugins: [{id:"web"}]`.

| Model | Form | ZDR | TTFB |
| ----- | ---- | --- | ---- |
| `moonshotai/kimi-k2.6` | server-tool | no  | 10.21 s |
| `moonshotai/kimi-k2.6` | plugin      | no  | **3.93 s** |
| `moonshotai/kimi-k2.6` | server-tool | yes | 10.25 s |
| `moonshotai/kimi-k2.6` | plugin      | yes | **7.87 s** |
| `openai/gpt-5.4`       | server-tool | no  | 0.50 s |
| `openai/gpt-5.4`       | plugin      | no  | 0.82 s |
| `openai/gpt-5.4`       | server-tool | yes | 10.17 s |
| `openai/gpt-5.4`       | plugin      | yes | **2.60 s** |

### Original parameter bisect (kimi-k2.6, server-tool form, no ZDR)

| Variant | TTFB |
| ------- | ---- |
| full body (4 fn tools + `openrouter:web_search`) | 10.19 s |
| remove web-search entry, keep 4 fn tools | 4.39 s |
| strip all tools + `tool_choice` | 4.33 s |
| only `openrouter:web_search`, no fn tools | 10.14 s |
| `plugins: [{id:"web"}]` + 4 fn tools | **3.94 s** |
| full tools + `tool_choice: "none"` | 10.14 s |

## What this means

OpenRouter's [web-search docs](https://openrouter.ai/docs/guides/features/server-tools/web-search) state native search is used for OpenAI / Anthropic / xAI models and Exa is the fallback. The data matches that claim:

- **gpt-5.4 + server-tool + no ZDR = 1.29 s** → OpenAI native search.
- **kimi-k2.6 + server-tool + no ZDR = 10.13 s** → Exa fallback.
- **Any model + server-tool + ZDR = ~10 s** → ZDR downgrades all models to the Exa-equivalent ZDR-compliant search pool. Native OpenAI search is not ZDR-compliant and is excluded.
- **Plugin form bypasses the ZDR penalty partially**: gpt-5.4 under ZDR drops from 10.17 s → 2.60 s with `plugins: [{id:"web"}]`. For kimi-k2.6 under ZDR, plugin form is 7.87 s — still slow but ~2.3 s faster than server-tool.
- `tool_choice: "none"` does **not** skip execution — OR runs the search just for the tool being in the array.

## Live measurements (app, not curl)

Session-by-session numbers recorded via temporary `[ttft:shape]` and `openrouterHeadersMs` instrumentation (reverted after capture).

**Web search off, warm conversation, kimi-k2.6** — confirms the non-search baseline is healthy:

| Stage | Duration |
| ----- | -------- |
| OR headers | **1,736 ms** (was 10,055 ms with web search on) |
| First SSE delta (content) | 3,875 ms |
| Total stream | 4,585 ms |

The ~2.1 s gap from OR headers → first delta is reasoning-token emission (`reasoning.effort: "medium"`).

**gpt-5.4 + web search, with vs without ZDR** — persona chat had Google Workspace integrations enabled (auto-triggers ZDR), bare chat did not:

| Variant | OR headers | First content delta |
| ------- | ---------- | ------------------- |
| Persona + Google integrations on (ZDR + search) | **10,029 ms** | ~10,040 ms |
| Persona + Google integrations off (no ZDR + search) | 676 ms | 4,811 ms |
| Bare model (no ZDR + search) | 1,080 ms | 3,647 ms |

## Product implications

- **Web search is opt-in per message** via the globe toggle (`params.webSearchEnabled`). See `convex/lib/openrouter_request.ts:81–88`. That part is correct.
- **ZDR is auto-enabled** per-request when either `userPrefs.zdrEnabled === true` or the chat has Google integrations attached. See `convex/chat/actions_run_generation_participant.ts:522–537`. Removing the integration (or unsetting the pref) drops ZDR on the next turn — no persistence.
- **Users with Google integrations + web search will always hit ~10 s TTFT**, regardless of model. Currently unavoidable without a backend mitigation.
- **Users without ZDR on gpt-5.4 / Claude / Grok get fast grounded answers (~1 s).** The web-search cost is only painful on Exa-routed models.

## What we could do next (not done)

1. **Switch to `plugins: [{ id: "web" }]` form when ZDR is active.** ~7.6 s saved for OpenAI models under ZDR, ~2.4 s saved for kimi under ZDR. Zero savings (slight regression) when ZDR is off. Low-risk: the plugin path is the older, stable API.
2. **Warn in UI when web search is toggled on a ZDR-required chat.** Set expectation (~10 s), or offer to disable search for speed.
3. **Auto-strip web search for ZDR chats.** Aggressive, but honest — grounded answers are broken under ZDR today, and a non-grounded fast answer may be preferable.
4. **Query classifier to skip search when the model won't need it.** Code / local-context / rewrite questions don't need grounding. Harder to get right.
5. **Report upstream.** OR's ZDR search pool is the bottleneck; they may have a faster ZDR-compliant backend or be open to fixing native-search + ZDR compatibility for OpenAI models.

No mitigation is shipped with this finding.

## Reproduction

Full fresh grid script: `/tmp/ttft_full_grid.sh`, output in `/tmp/ttft_full_grid.txt`. Key body variants are derivable from a captured production body:

```bash
# Strip web-search server tool (keep fn tools)
jq '.tools = [.tools[] | select(.type != "openrouter:web_search")]' body.json

# Convert to plugin form
jq '.tools = [.tools[] | select(.type != "openrouter:web_search")]
    | .plugins = ((.plugins // []) + [{id: "web"}])' body.json

# Add ZDR
jq '.provider = (.provider // {}) + {zdr: true}' body.json

# Swap model
jq '.model = "openai/gpt-5.4"' body.json
```
