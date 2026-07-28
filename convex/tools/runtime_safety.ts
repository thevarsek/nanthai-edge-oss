import type { SkillToolProfileId } from "../skills/tool_profiles";

export type RuntimeSafety = "runtime-safe" | "node-required";

export const RUNTIME_SAFE_TOOL_NAMES = new Set<string>([
  "fetch_image",
  "search_chats",
  "load_skill",
  "list_skills",
  "spawn_subagents",
  "web_search",
]);

// `spawn_subagents` only validates a bounded task list and returns a durable
// deferred handoff. The V8 participant owns the fenced batch/checkpoint writes
// after that result, so merely making subagents available must not force an
// otherwise ordinary turn through Node before the model chooses the tool.
const RUNTIME_SAFE_PROFILE_IDS = new Set<SkillToolProfileId>([
  "subagents",
]);

export function classifyToolRuntimeSafety(toolName: string): RuntimeSafety {
  return RUNTIME_SAFE_TOOL_NAMES.has(toolName) ? "runtime-safe" : "node-required";
}

export function classifyProfileRuntimeSafety(
  profile: SkillToolProfileId,
): RuntimeSafety {
  return RUNTIME_SAFE_PROFILE_IDS.has(profile) ? "runtime-safe" : "node-required";
}

export function hasNodeRequiredDirectTools(
  directToolNames: string[],
): boolean {
  return directToolNames.some(
    (toolName) => classifyToolRuntimeSafety(toolName) === "node-required",
  );
}

export function hasNodeRequiredProfiles(
  profiles: SkillToolProfileId[],
): boolean {
  return profiles.some(
    (profile) => classifyProfileRuntimeSafety(profile) === "node-required",
  );
}

export function splitProfilesByRuntimeSafety(
  profiles: SkillToolProfileId[],
): {
  runtimeSafe: SkillToolProfileId[];
  nodeRequired: SkillToolProfileId[];
} {
  const runtimeSafe: SkillToolProfileId[] = [];
  const nodeRequired: SkillToolProfileId[] = [];

  for (const profile of profiles) {
    if (classifyProfileRuntimeSafety(profile) === "runtime-safe") {
      runtimeSafe.push(profile);
    } else {
      nodeRequired.push(profile);
    }
  }

  return { runtimeSafe, nodeRequired };
}
