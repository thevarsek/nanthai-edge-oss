import type { ChatRequestParameters, ToolCall } from "../lib/openrouter";
import type { ToolExecutionContext, ToolRegistry, ToolResult } from "./registry";

function loadSkillSlug(toolCall: ToolCall): string | null {
  if (toolCall.function.name !== "load_skill") return null;
  try {
    const parsed = JSON.parse(toolCall.function.arguments) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.trim()
      ? parsed.name.trim()
      : null;
  } catch {
    return null;
  }
}

export async function executeWithLoadedSkillGuard(
  registry: ToolRegistry,
  toolCalls: ToolCall[],
  toolCtx: ToolExecutionContext,
  loadedSkillSlugs: Set<string>,
): Promise<{
  results: Array<{ toolCallId: string; result: ToolResult }>;
  onlyRedundantSkillLoads: boolean;
}> {
  const results = new Array<{ toolCallId: string; result: ToolResult }>(toolCalls.length);
  const executableCalls: ToolCall[] = [];
  const executableIndexes: number[] = [];
  let redundantSkillLoads = 0;

  for (const [index, toolCall] of toolCalls.entries()) {
    const slug = loadSkillSlug(toolCall);
    if (slug && loadedSkillSlugs.has(slug)) {
      redundantSkillLoads += 1;
      results[index] = {
        toolCallId: toolCall.id,
        result: {
          success: true,
          data: {
            skill: slug,
            alreadyLoaded: true,
            message:
              `Skill "${slug}" is already loaded. Do not call load_skill for it again; ` +
              "use its currently available tools or instructions now.",
          },
        },
      };
      continue;
    }
    executableCalls.push(toolCall);
    executableIndexes.push(index);
  }

  const executed = await registry.executeAllToolCalls(executableCalls, toolCtx);
  for (const [index, executedResult] of executed.entries()) {
    const targetIndex = executableIndexes[index];
    if (targetIndex === undefined) continue;
    results[targetIndex] = executedResult;
    const slug = loadSkillSlug(executableCalls[index]);
    if (slug && executedResult.result.success) loadedSkillSlugs.add(slug);
  }

  return {
    results,
    onlyRedundantSkillLoads:
      redundantSkillLoads > 0 && redundantSkillLoads === toolCalls.length,
  };
}

export function withoutLoadSkillDefinition(
  params: ChatRequestParameters,
): ChatRequestParameters {
  if (!params.tools) return params;
  return {
    ...params,
    tools: params.tools.filter((tool) =>
      !("function" in tool) || tool.function.name !== "load_skill"
    ),
  };
}
