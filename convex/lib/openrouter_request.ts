import { ChatRequestParameters, OpenRouterMessage } from "./openrouter_types";
import { OPENROUTER_DEFAULT_PROVIDER_SORT } from "./model_constants";

function formatMessage(msg: OpenRouterMessage): Record<string, unknown> {
  const result: Record<string, unknown> = {
    role: msg.role,
    content: msg.content,
  };
  if (msg.name) result.name = msg.name;
  // Assistant messages that invoked tools carry the tool_calls array.
  if (msg.tool_calls && msg.tool_calls.length > 0) {
    result.tool_calls = msg.tool_calls;
  }
  // Tool-result messages reference the originating call via tool_call_id.
  if (msg.tool_call_id) {
    result.tool_call_id = msg.tool_call_id;
  }
  return result;
}

export function buildRequestBody(
  model: string,
  messages: OpenRouterMessage[],
  params: ChatRequestParameters,
  stream: boolean,
  /**
   * When `true`, skip the default provider-sort merge AND drop any
   * caller-supplied `provider` block. Used by the 404 "No endpoints found"
   * retry in `openrouter_stream.streamOnce` to strip all provider routing
   * hints on the retry attempt.
   */
  skipProviderRouting: boolean = false,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: messages.map(formatMessage),
    stream,
  };

  if (params.temperature != null) body.temperature = params.temperature;
  if (params.maxTokens != null) body.max_tokens = params.maxTokens;
  if (params.includeReasoning != null) {
    body.include_reasoning = params.includeReasoning;
  }
  if (params.reasoningEffort != null) {
    body.reasoning = { effort: params.reasoningEffort };
  }
  if (params.modalities != null) body.modalities = params.modalities;
  if (params.audio != null) body.audio = params.audio;
  if (params.imageConfig != null) {
    body.image_config = {
      ...(params.imageConfig.aspectRatio && {
        aspect_ratio: params.imageConfig.aspectRatio,
      }),
      ...(params.imageConfig.imageSize && {
        image_size: params.imageConfig.imageSize,
      }),
    };
  }

  // Tools — user-defined function tools only. We do NOT inject the
  // `openrouter:web_search` server tool here; web search is handled via the
  // `plugins` block below (see rationale).
  //
  // Models that don't support tools are signalled by gateParameters setting
  // params.tools to `null` (explicit strip).
  const allTools: unknown[] = [];
  if (params.tools != null && params.tools.length > 0) {
    allTools.push(...params.tools);
  }
  if (allTools.length > 0) body.tools = allTools;
  if (params.toolChoice != null) {
    body.tool_choice = params.toolChoice;
  }

  // Web search — plugin form (`plugins: [{id:"web"}]`), not the server tool.
  //
  // OpenRouter offers two ways to add web search:
  //  (1) `plugins: [{id:"web"}]` — the legacy plugin, documented as deprecated
  //      but fully supported.
  //  (2) `tools: [{type:"openrouter:web_search"}]` — the newer server-tool
  //      form, currently in beta.
  //
  // We use (1). Measured TTFB on an identical captured production body:
  //    model                    form         zdr   TTFB
  //    moonshotai/kimi-k2.6     server-tool  no    10.21s
  //    moonshotai/kimi-k2.6     plugin       no     3.93s   ← 6.3s faster
  //    moonshotai/kimi-k2.6     plugin       yes    7.87s
  //    openai/gpt-5.4           server-tool  no     0.50s
  //    openai/gpt-5.4           plugin       no     0.82s   (~0.3s slower, noise)
  //    openai/gpt-5.4           plugin       yes    2.60s   ← 7.6s faster vs server-tool+zdr
  //
  // The server tool adds a model round-trip (model emits a tool call → OR
  // executes search → results go back → model responds), which dominates TTFB
  // on non-native-search models and under ZDR (where native search is
  // disqualified for every model). The plugin searches once up-front and
  // injects results into the prompt, so the model streams the response in
  // one pass. See docs/ttft-web-search-finding.md.
  //
  // `max_results: 5` matches OpenRouter's plugin default and the server-tool
  // default. A head-to-head at identical max_results=5 (see
  // /tmp/ttft_fair.txt):
  //    kimi-k2.6   server-tool=10.22s   plugin=4.19s   (plugin 6s faster)
  //    gpt-5.4     server-tool= 0.78s   plugin=0.51s   (both fast, native search)
  // `max_results: 3` is ~1s faster than 5 on kimi but we keep the default to
  // avoid a tuned-magic-number surface area; the 10s → 4s win is what matters.
  //
  // `engine` is intentionally left unset so OR auto-selects: native for
  // OpenAI / Anthropic / xAI / Perplexity, Exa fallback for everything else.
  //
  // Migration risk: when OR sunsets the plugin we reintroduce the server-tool
  // code (see git blame of this file for the previous implementation).
  const plugins: Record<string, unknown>[] = [];
  if (params.plugins) plugins.push(...params.plugins);
  if (params.webSearchEnabled) {
    plugins.push({ id: "web", max_results: 5 });
  }
  if (plugins.length > 0) body.plugins = plugins;

  // Prompt caching — Anthropic requires explicit opt-in via top-level
  // cache_control. Other providers (OpenAI, DeepSeek, Gemini 2.5, Grok, Groq)
  // cache automatically. The "automatic" mode lets Anthropic place the cache
  // breakpoint at the last cacheable block and advance it as conversation grows.
  const isAnthropic = model.startsWith("anthropic/");
  if (isAnthropic) {
    body.cache_control = { type: "ephemeral" };
  }

  // Provider preferences — merge caller-supplied fields (e.g. ZDR) with the
  // global default provider-sort strategy. Caller-supplied `sort` always wins
  // over the default. If the default is `null`, provider sorting is fully
  // disabled (one-line revert).
  //
  // Anthropic exception: top-level `cache_control` restricts routing to the
  // Anthropic-native endpoint (Bedrock/Vertex don't support top-level
  // cache_control and are excluded by OpenRouter). For cached Anthropic
  // requests OpenRouter already does sticky routing — it pins the conversation
  // to the provider that holds the warm cache and falls back on outage. Our
  // `sort: "latency"` default adds no value on top of that single-endpoint +
  // sticky-routing setup and historically contributed to 404 "No endpoints
  // found" regressions when combined with hard latency caps, so we skip the
  // default here. Caller-supplied `provider` fields (e.g. ZDR) still pass
  // through untouched.
  const defaultProviderSort = isAnthropic
    ? {}
    : (OPENROUTER_DEFAULT_PROVIDER_SORT ?? {});
  const mergedProvider: Record<string, unknown> = skipProviderRouting
    ? {}
    : {
      ...defaultProviderSort,
      ...(params.provider ?? {}),
    };
  if (Object.keys(mergedProvider).length > 0) {
    body.provider = mergedProvider;
  }

  // Transforms — default to ["middle-out"] unless explicitly disabled.
  if (params.transforms === null) {
    // Omit transforms entirely.
  } else if (params.transforms && params.transforms.length > 0) {
    body.transforms = params.transforms;
  } else {
    body.transforms = ["middle-out"];
  }

  return body;
}
