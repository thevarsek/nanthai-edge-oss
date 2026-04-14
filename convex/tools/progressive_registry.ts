"use node";

import type { SkillToolProfileId } from "../skills/tool_profiles";
import { ToolExecutionContext, ToolRegistry, ToolResult } from "./registry";
import type { OpenRouterMessage, ToolCall } from "../lib/openrouter";
import { registerBaseTools, registerProfileTools } from "./progressive_registry_profiles";

export interface ProgressiveToolRegistryOptions {
  enabledIntegrations?: string[];
  isPro: boolean;
  allowSubagents?: boolean;
  activeProfiles?: SkillToolProfileId[];
  directToolNames?: string[];
}

export function buildProgressiveToolRegistry(
  options: ProgressiveToolRegistryOptions,
): ToolRegistry {
  const registry = new ToolRegistry();
  if (!options.isPro) {
    return registry;
  }

  registerBaseTools(
    registry,
    options.allowSubagents === true,
    options.directToolNames ?? [],
  );

  for (const profile of options.activeProfiles ?? []) {
    registerProfileTools(registry, profile, options);
  }

  return registry;
}

export function buildRegistryParams(
  registry: ToolRegistry,
): { tools?: ReturnType<ToolRegistry["getDefinitions"]>; toolChoice?: "auto" } {
  if (registry.isEmpty) {
    return {};
  }
  return {
    tools: registry.getDefinitions(),
    toolChoice: "auto",
  };
}

export function extractProfilesFromLoadSkillResults(
  toolCalls: Array<{ function: { name: string } }>,
  results: Array<{ toolCallId: string; result: ToolResult }>,
): SkillToolProfileId[] {
  const profiles = new Set<SkillToolProfileId>();

  for (let index = 0; index < results.length; index += 1) {
    const toolName = toolCalls[index]?.function.name;
    if (toolName !== "load_skill") continue;

    const data = results[index]?.result?.data as
      | { requiredToolProfiles?: string[] }
      | null
      | undefined;
    if (!results[index]?.result?.success || !data?.requiredToolProfiles) continue;

    for (const profile of data.requiredToolProfiles) {
      if (isSkillToolProfileId(profile)) {
        profiles.add(profile);
      }
    }
  }

  return Array.from(profiles);
}

export function extractProfilesFromConversation(
  messages: OpenRouterMessage[],
): SkillToolProfileId[] {
  const loadSkillCallIds = new Set<string>();
  const profiles = new Set<SkillToolProfileId>();

  for (const message of messages) {
    if (message.role === "assistant" && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.function.name === "load_skill") {
          loadSkillCallIds.add(toolCall.id);
        }
      }
      continue;
    }

    if (
      message.role === "tool" &&
      message.tool_call_id &&
      loadSkillCallIds.has(message.tool_call_id) &&
      typeof message.content === "string"
    ) {
      try {
        const parsed = JSON.parse(message.content) as { requiredToolProfiles?: string[] };
        for (const profile of parsed.requiredToolProfiles ?? []) {
          if (isSkillToolProfileId(profile)) {
            profiles.add(profile);
          }
        }
      } catch {
        // Ignore malformed historical tool payloads and continue.
      }
    }
  }

  return Array.from(profiles);
}

export function patchSameRoundProgressiveToolErrors(
  toolCalls: Array<{ function: { name: string } }>,
  results: Array<{ toolCallId: string; result: ToolResult }>,
  nextRegistry: ToolRegistry,
): void {
  const loadedProfiles = extractProfilesFromLoadSkillResults(toolCalls, results);
  if (loadedProfiles.length === 0) return;

  for (let index = 0; index < results.length; index += 1) {
    const toolName = toolCalls[index]?.function.name;
    const result = results[index]?.result;
    if (!toolName || !result || result.success) continue;
    if (!result.error?.startsWith("Unknown tool:")) continue;
    if (!nextRegistry.get(toolName)) continue;

    results[index] = {
      ...results[index],
      result: {
        success: false,
        data: {
          retryNextTurn: true,
          tool: toolName,
          message:
            `Tool "${toolName}" was requested in the same step as skill loading. ` +
            `The matching skill/profile is now loaded, so re-plan and call "${toolName}" again in your next response.`,
        },
        error:
          `Tool "${toolName}" was requested too early. The required skill/profile is now loaded. ` +
          `Do not conclude the tool is unavailable; call it again in the next turn.`,
      },
    };
  }
}

export async function retrySameRoundProgressiveToolCalls(
  toolCalls: ToolCall[],
  results: Array<{ toolCallId: string; result: ToolResult }>,
  nextRegistry: ToolRegistry,
  toolCtx: ToolExecutionContext,
): Promise<void> {
  const loadedProfiles = extractProfilesFromLoadSkillResults(toolCalls, results);
  if (loadedProfiles.length === 0) return;

  const retryIndexes: number[] = [];
  const retryCalls: ToolCall[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const toolName = toolCalls[index]?.function.name;
    const result = results[index]?.result;
    if (!toolName || !result || result.success) continue;
    if (!result.error?.startsWith("Unknown tool:")) continue;
    if (!nextRegistry.get(toolName)) continue;

    retryIndexes.push(index);
    retryCalls.push(toolCalls[index]);
  }

  if (retryCalls.length === 0) return;

  const retriedResults = await nextRegistry.executeAllToolCalls(retryCalls, toolCtx);
  for (let index = 0; index < retriedResults.length; index += 1) {
    const targetIndex = retryIndexes[index];
    if (targetIndex === undefined) continue;
    results[targetIndex] = retriedResults[index];
  }
}

export function availableProgressiveProfiles(
  options: ProgressiveToolRegistryOptions,
): SkillToolProfileId[] {
  if (!options.isPro) return [];

  const profiles = new Set<SkillToolProfileId>([
    "docs",
    "analytics",
    "workspace",
    "persistentRuntime",
    "scheduledJobs",
    "skillsManagement",
  ]);
  const enabled = new Set(options.enabledIntegrations ?? []);
  if (options.allowSubagents) {
    profiles.add("subagents");
  }
  if (enabled.has("gmail") || enabled.has("drive") || enabled.has("calendar")) {
    profiles.add("google");
  }
  if (enabled.has("outlook") || enabled.has("onedrive") || enabled.has("ms_calendar")) {
    profiles.add("microsoft");
  }
  if (enabled.has("notion")) {
    profiles.add("notion");
  }
  if (enabled.has("apple_calendar")) {
    profiles.add("appleCalendar");
  }

  return Array.from(profiles);
}

function isSkillToolProfileId(value: string): value is SkillToolProfileId {
  return [
    "docs",
    "analytics",
    "workspace",
    "persistentRuntime",
    "subagents",
    "google",
    "microsoft",
    "notion",
    "appleCalendar",
    "scheduledJobs",
    "skillsManagement",
  ].includes(value);
}
