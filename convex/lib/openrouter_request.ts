import { ChatRequestParameters, OpenRouterMessage } from "./openrouter_types";

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

  // Tools
  if (params.tools && params.tools.length > 0) {
    body.tools = params.tools;
  }
  if (params.toolChoice != null) {
    body.tool_choice = params.toolChoice;
  }

  // Plugins
  const plugins: { id: string }[] = [];
  if (params.plugins) plugins.push(...params.plugins);
  if (params.webSearchEnabled) plugins.push({ id: "web" });
  if (plugins.length > 0) body.plugins = plugins;

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
