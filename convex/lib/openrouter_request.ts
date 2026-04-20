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

  // Tools — combine user-defined function tools with server tools.
  // Server tools (e.g. openrouter:web_search) are injected here when enabled;
  // they are executed by OpenRouter transparently (the model decides when to
  // search, and OpenRouter handles execution server-side).
  //
  // Models that don't support tools are signalled by gateParameters setting
  // params.tools to `null` (explicit strip). For those models, web search
  // falls back to the legacy plugin API which works independently of tool
  // support. When tools is `undefined` (no integrations active) the model
  // may still support tools, so the server tool is safe to inject.
  const toolsExplicitlyStripped = params.tools === null;
  const allTools: unknown[] = [];
  if (params.tools != null && params.tools.length > 0) {
    allTools.push(...params.tools);
  }
  // Skip injecting web search server tool when toolChoice is "none" — the
  // intent is a forced text-only response (compaction cap or final tool round),
  // and OpenRouter may still execute server tools if they appear in the array.
  // Also skip when gateParameters explicitly stripped tools (model can't
  // accept a `tools` array at all).
  if (params.webSearchEnabled && !toolsExplicitlyStripped && params.toolChoice !== "none") {
    const maxResults = 5;
    const maxTotalResults = params.webSearchMaxTotalResults ?? 15;
    allTools.push({
      type: "openrouter:web_search",
      parameters: { max_results: maxResults, max_total_results: maxTotalResults },
    });
  }
  if (allTools.length > 0) body.tools = allTools;
  if (params.toolChoice != null) {
    body.tool_choice = params.toolChoice;
  }

  // Plugins — legacy web search fallback for models that don't support tools.
  // The old plugin API searches once unconditionally (no budget control), but
  // it's the only option for models like ERNIE that reject the `tools` param.
  const plugins: { id: string }[] = [];
  if (params.plugins) plugins.push(...params.plugins);
  if (params.webSearchEnabled && toolsExplicitlyStripped) {
    plugins.push({ id: "web" });
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
