import { describe, expect, it } from "vitest";
import { cycleSkillOverride } from "./PersonaEditorForm";

describe("PersonaEditorForm helpers", () => {
  it("cycles skill overrides through always, available, blocked, inherited", () => {
    expect(cycleSkillOverride(undefined)).toBe("always");
    expect(cycleSkillOverride("always")).toBe("available");
    expect(cycleSkillOverride("available")).toBe("never");
    expect(cycleSkillOverride("never")).toBeUndefined();
  });
});
