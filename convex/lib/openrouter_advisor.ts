import type { ServerToolDefinition } from "./openrouter_types";

export interface PersonaAdvisorToolOptions {
  instanceName: string;
  model: string;
  instructions: string;
  maxCompletionTokens: number;
  temperature?: number;
  reasoningEffort?: string;
  allowWebSearch: boolean;
}

/** Build the single Persona-scoped Advisor tool used by a Responses request. */
export function buildPersonaAdvisorTool(
  options: PersonaAdvisorToolOptions,
): ServerToolDefinition {
  const parameters: Record<string, unknown> = {
    name: options.instanceName,
    model: options.model,
    instructions: options.instructions,
    forward_transcript: true,
    stream: true,
    max_completion_tokens: options.maxCompletionTokens,
  };
  if (options.temperature != null) parameters.temperature = options.temperature;
  if (options.reasoningEffort) {
    parameters.reasoning = { effort: options.reasoningEffort };
  }
  if (options.allowWebSearch) {
    parameters.tools = [{
      type: "openrouter:web_search",
      parameters: {
        engine: "auto",
        max_results: 5,
        max_total_results: 15,
        search_context_size: "medium",
      },
    }];
    parameters.max_tool_calls = 5;
  }
  return { type: "openrouter:advisor", parameters };
}
