import type { Doc, Id } from "../_generated/dataModel";
import { inferProfilesFromToolIds } from "../skills/tool_profiles";
import type { LoadedSkillState } from "../tools/progressive_registry_shared";
import { isSkillToolProfileId } from "../tools/progressive_registry_shared";
import { branchPathIds } from "./helpers_utils";
import type { ContextMessage } from "./helpers_types";

function loadedSkillSlug(call: NonNullable<ContextMessage["toolCalls"]>[number]): string | null {
  if (call.name !== "load_skill") return null;
  try {
    const parsed = JSON.parse(call.arguments) as { name?: unknown };
    return typeof parsed.name === "string" && parsed.name.trim()
      ? parsed.name.trim()
      : null;
  } catch {
    return null;
  }
}

/** Returns successful load_skill slugs from the exact ancestor branch only. */
export function successfulLoadedSkillSlugsForBranch(
  messages: ContextMessage[],
  excludeMessageId: Id<"messages">,
): string[] {
  const messagesById = new Map(messages.map((message) => [message._id, message]));
  if (!messagesById.has(excludeMessageId)) return [];
  const pathIds = branchPathIds(excludeMessageId, messagesById);
  pathIds.delete(excludeMessageId);
  const slugs = new Set<string>();

  for (const message of messages) {
    if (
      !pathIds.has(message._id) ||
      message.role !== "assistant" ||
      message.status === "failed" ||
      message.status === "cancelled"
    ) continue;
    const results = new Map(
      (message.toolResults ?? []).map((result) => [result.toolCallId, result]),
    );
    for (const call of message.toolCalls ?? []) {
      const slug = loadedSkillSlug(call);
      const result = results.get(call.id);
      if (slug && result && result.isError !== true) slugs.add(slug);
    }
  }

  return Array.from(slugs);
}

function stateFromSkill(skill: Doc<"skills">): LoadedSkillState {
  const requiredToolIds = skill.requiredToolIds ?? [];
  const requiredIntegrationIds = skill.requiredIntegrationIds ?? [];
  const requiredToolProfiles = Array.from(new Set([
    ...(skill.requiredToolProfiles ?? []).filter(isSkillToolProfileId),
    ...inferProfilesFromToolIds(requiredToolIds, requiredIntegrationIds),
  ]));
  return {
    skill: skill.slug,
    name: skill.name,
    runtimeMode: skill.runtimeMode,
    instructions: skill.instructionsRaw,
    requiredToolProfiles,
    requiredToolIds,
    requiredIntegrationIds,
    requiredCapabilities: skill.requiredCapabilities ?? [],
  };
}

/** Rehydrates current instructions only for skills still effective in this chat. */
export function restoredLoadedSkillsFromHistory(
  messages: ContextMessage[],
  excludeMessageId: Id<"messages">,
  effectiveSkills: Doc<"skills">[],
): LoadedSkillState[] {
  const effectiveBySlug = new Map(effectiveSkills.map((skill) => [skill.slug, skill]));
  return successfulLoadedSkillSlugsForBranch(messages, excludeMessageId)
    .map((slug) => effectiveBySlug.get(slug))
    .filter((skill): skill is Doc<"skills"> => skill !== undefined)
    .map(stateFromSkill);
}
