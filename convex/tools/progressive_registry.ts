"use node";

import type { SkillToolProfileId } from "../skills/tool_profiles";
import { ToolRegistry } from "./registry";
import { registerBaseTools, registerProfileTools } from "./progressive_registry_profiles";
export {
  availableProgressiveProfiles,
  buildRegistryParams,
  extractProfilesFromConversation,
  extractProfilesFromLoadSkillResults,
  patchSameRoundProgressiveToolErrors,
  retrySameRoundProgressiveToolCalls,
} from "./progressive_registry_shared";

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
