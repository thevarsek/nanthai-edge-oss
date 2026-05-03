import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import {
  defaultSkillState,
  effectiveDefaultState,
  isSystemSkill,
  nextDefaultState,
  type SkillDoc,
} from "./SkillsPage.helpers";

function skill(overrides: Partial<SkillDoc>): SkillDoc {
  return {
    _id: "skill_1" as Id<"skills">,
    name: "Skill",
    scope: "system",
    status: "active",
    visibility: "visible",
    ...overrides,
  };
}

describe("SkillsPage helpers", () => {
  it("identifies system skills from Convex scope", () => {
    expect(isSystemSkill(skill({ scope: "system", ownerUserId: undefined }))).toBe(true);
    expect(isSystemSkill(skill({ scope: "user", ownerUserId: "user_1" }))).toBe(false);
  });

  it("defaults visible active system and user skills to available", () => {
    expect(defaultSkillState(skill({ scope: "system" }))).toBe("available");
    expect(defaultSkillState(skill({ scope: "user", ownerUserId: "user_1" }))).toBe("available");
  });

  it("does not default hidden or inactive skills to available", () => {
    expect(defaultSkillState(skill({ visibility: "hidden" }))).toBe("never");
    expect(defaultSkillState(skill({ status: "archived" }))).toBe("never");
  });

  it("uses explicit overrides over inherited defaults", () => {
    const userSkill = skill({ scope: "user", ownerUserId: "user_1" });
    expect(effectiveDefaultState(userSkill, undefined)).toBe("available");
    expect(effectiveDefaultState(userSkill, "never")).toBe("never");
  });

  it("cycles inherited visible skills through always, explicit available, blocked, default", () => {
    const userSkill = skill({ scope: "user", ownerUserId: "user_1" });
    expect(nextDefaultState(userSkill, undefined)).toBe("always");
    expect(nextDefaultState(userSkill, "always")).toBe("available");
    expect(nextDefaultState(userSkill, "available")).toBe("never");
    expect(nextDefaultState(userSkill, "never")).toBeUndefined();
  });
});
