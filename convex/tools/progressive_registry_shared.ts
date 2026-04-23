import type { SkillToolProfileId } from "../skills/tool_profiles";
import { ToolRegistry, ToolResult } from "./registry";
import type { OpenRouterMessage, ToolCall } from "../lib/openrouter";
import type { ToolExecutionContext } from "./registry";

const progressiveRegistryDebugEnabled = process.env.PROGRESSIVE_REGISTRY_DEBUG === "1";

export interface LoadedSkillState {
  skill: string;
  name?: string;
  runtimeMode?: string;
  instructions: string;
  requiredToolProfiles: SkillToolProfileId[];
  requiredToolIds: string[];
  requiredIntegrationIds: string[];
  requiredCapabilities: string[];
}

function normalizeLoadedSkillState(
  value: unknown,
): LoadedSkillState | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (
    typeof data.skill !== "string" ||
    typeof data.instructions !== "string"
  ) {
    return null;
  }

  const rawRequiredToolProfiles = Array.isArray(data.requiredToolProfiles)
    ? data.requiredToolProfiles.filter((profile): profile is string =>
      typeof profile === "string")
    : [];
  const requiredToolProfiles = rawRequiredToolProfiles.filter((profile): profile is SkillToolProfileId =>
    isSkillToolProfileId(profile));
  if (
    progressiveRegistryDebugEnabled &&
    requiredToolProfiles.length !== rawRequiredToolProfiles.length
  ) {
    const droppedProfiles = rawRequiredToolProfiles.filter(
      (profile) => !isSkillToolProfileId(profile),
    );
    if (droppedProfiles.length > 0) {
      console.info("[progressiveRegistry] dropped unknown requiredToolProfiles", {
        skill: data.skill,
        droppedProfiles,
      });
    }
  }

  return {
    skill: data.skill,
    name: typeof data.name === "string" ? data.name : undefined,
    runtimeMode: typeof data.runtimeMode === "string" ? data.runtimeMode : undefined,
    instructions: data.instructions,
    requiredToolProfiles,
    requiredToolIds: Array.isArray(data.requiredToolIds)
      ? data.requiredToolIds.filter((toolId): toolId is string => typeof toolId === "string")
      : [],
    requiredIntegrationIds: Array.isArray(data.requiredIntegrationIds)
      ? data.requiredIntegrationIds.filter((integrationId): integrationId is string => typeof integrationId === "string")
      : [],
    requiredCapabilities: Array.isArray(data.requiredCapabilities)
      ? data.requiredCapabilities.filter((capability): capability is string => typeof capability === "string")
      : [],
  };
}

/** Merges loaded-skill snapshots by `skill`, with later entries overwriting earlier ones. */
export function mergeLoadedSkills(
  ...lists: Array<LoadedSkillState[] | undefined>
): LoadedSkillState[] {
  const merged = new Map<string, LoadedSkillState>();
  for (const list of lists) {
    for (const skill of list ?? []) {
      merged.set(skill.skill, skill);
    }
  }
  return Array.from(merged.values());
}

function textContentFromMessageContent(
  content: OpenRouterMessage["content"],
): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const text = content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");

  return text.length > 0 ? text : null;
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

export function extractLoadedSkillsFromLoadSkillResults(
  toolCalls: Array<{ function: { name: string } }>,
  results: Array<{ toolCallId: string; result: ToolResult }>,
): LoadedSkillState[] {
  const loadedSkills: LoadedSkillState[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const toolName = toolCalls[index]?.function.name;
    if (toolName !== "load_skill") continue;

    const skill = normalizeLoadedSkillState(results[index]?.result?.data);
    if (!results[index]?.result?.success || !skill) continue;
    loadedSkills.push(skill);
  }

  return mergeLoadedSkills(loadedSkills);
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

export function extractLoadedSkillsFromConversation(
  messages: OpenRouterMessage[],
): LoadedSkillState[] {
  const loadSkillCallIds = new Set<string>();
  const loadedSkills: LoadedSkillState[] = [];

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
      loadSkillCallIds.has(message.tool_call_id)
    ) {
      const content = textContentFromMessageContent(message.content);
      if (!content) continue;
      try {
        const parsed = JSON.parse(content);
        const skill = normalizeLoadedSkillState(parsed);
        if (skill) {
          loadedSkills.push(skill);
        }
      } catch {
        if (progressiveRegistryDebugEnabled) {
          console.info("[progressiveRegistry] failed to parse historical load_skill payload", {
            toolCallId: message.tool_call_id,
          });
        }
      }
    }
  }

  return mergeLoadedSkills(loadedSkills);
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

export function patchDeferredProgressiveToolErrors(
  toolCalls: Array<{ function: { name: string } }>,
  results: Array<{ toolCallId: string; result: ToolResult }>,
): void {
  const loadedProfiles = extractProfilesFromLoadSkillResults(toolCalls, results);
  if (loadedProfiles.length === 0) return;

  for (let index = 0; index < results.length; index += 1) {
    const toolName = toolCalls[index]?.function.name;
    const result = results[index]?.result;
    if (!toolName || !result || result.success) continue;
    if (!result.error?.startsWith("Unknown tool:")) continue;

    results[index] = {
      ...results[index],
      result: {
        success: false,
        data: {
          retryNextTurn: true,
          tool: toolName,
          message:
            `Tool "${toolName}" requires capabilities that were loaded during this step. ` +
            `The next generation turn will run with the expanded tool registry.`,
        },
        error:
          `Tool "${toolName}" requires a newly loaded skill/profile. ` +
          `Call it again in the next turn after the expanded registry is available.`,
      },
    };
  }
}

export function availableProgressiveProfiles(options: {
  enabledIntegrations?: string[];
  isPro: boolean;
  allowSubagents?: boolean;
}): SkillToolProfileId[] {
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
  if (enabled.has("cloze")) {
    profiles.add("cloze");
  }
  if (enabled.has("slack")) {
    profiles.add("slack");
  }

  return Array.from(profiles);
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
    "cloze",
    "slack",
    "scheduledJobs",
    "skillsManagement",
  ].includes(value);
}
