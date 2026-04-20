import { fetchImage } from "./fetch_image";
import { loadSkill } from "./load_skill";
import { searchChats } from "./search_chats";
import { listSkills } from "./skill_management";
import { ToolRegistry } from "./registry";

export interface RuntimeBaseToolRegistryOptions {
  isPro: boolean;
}

const RUNTIME_BASE_TOOLS = [
  fetchImage,
  searchChats,
  loadSkill,
  listSkills,
];

export function buildRuntimeBaseToolRegistry(
  options: RuntimeBaseToolRegistryOptions,
): ToolRegistry {
  const registry = new ToolRegistry();
  if (!options.isPro) {
    return registry;
  }

  registry.register(...RUNTIME_BASE_TOOLS);
  return registry;
}
