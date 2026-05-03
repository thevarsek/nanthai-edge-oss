import type { Id } from "@convex/_generated/dataModel";

export interface SkillDoc {
  _id: Id<"skills">;
  name: string;
  summary?: string;
  ownerUserId?: string;
  scope?: string;
  status?: string;
  visibility?: string;
  isSystem?: boolean;
}

export type SkillDefaultState = "always" | "available" | "never" | undefined;

export function isSystemSkill(skill: SkillDoc): boolean {
  if (skill.scope === "system") return true;
  if (skill.scope === "user") return false;
  return skill.isSystem === true || !skill.ownerUserId;
}

export function defaultSkillState(skill: SkillDoc): Exclude<SkillDefaultState, undefined> {
  const isVisible = skill.visibility === undefined || skill.visibility === "visible";
  const isActive = skill.status === undefined || skill.status === "active";
  return isVisible && isActive ? "available" : "never";
}

export function effectiveDefaultState(
  skill: SkillDoc,
  override: SkillDefaultState,
): Exclude<SkillDefaultState, undefined> {
  return override ?? defaultSkillState(skill);
}

export function nextDefaultState(skill: SkillDoc, current: SkillDefaultState): SkillDefaultState {
  if (current === undefined) {
    return defaultSkillState(skill) === "available" ? "always" : "available";
  }
  if (current === "always") return "available";
  if (current === "available") return "never";
  return undefined;
}
