import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import {
  buildFlushPlan,
  nextCycledSkillOverrides,
  nextToggledIntegrationOverrides,
  nextToggledSkillOverrides,
  pendingMapConverged,
  pendingParamOverridesConverged,
  serializeIntegrationOverrideEntries,
  serializeSkillOverrideEntries,
} from "./useChatOverrides.state";
import { DEFAULT_OVERRIDES } from "./useChatOverrides.resolution";

describe("useChatOverrides state helpers", () => {
  it("detects pending convergence for parameter and map state", () => {
    expect(pendingParamOverridesConverged(DEFAULT_OVERRIDES, { ...DEFAULT_OVERRIDES })).toBe(true);
    expect(pendingParamOverridesConverged(null, DEFAULT_OVERRIDES)).toBe(false);
    expect(pendingMapConverged(new Map([["drive", true]]), new Map([["drive", true]]))).toBe(true);
    expect(pendingMapConverged(new Map([["drive", true]]), new Map([["drive", false]]))).toBe(false);
  });

  it("updates skill and integration override domains independently", () => {
    const cycled = nextCycledSkillOverrides(new Map(), "skill_1");
    expect(Array.from(cycled.entries())).toEqual([["skill_1", "always"]]);
    expect(Array.from(nextToggledSkillOverrides(cycled, "skill_1").entries())).toEqual([]);
    expect(Array.from(nextToggledIntegrationOverrides(new Map(), "drive").entries())).toEqual([["drive", true]]);
  });

  it("serializes override entries for Convex mutations and turn send args", () => {
    expect(serializeSkillOverrideEntries(new Map([["skill_1", "available"]]))).toEqual([
      { skillId: "skill_1", state: "available" },
    ]);
    expect(serializeIntegrationOverrideEntries(new Map([["calendar", false]]))).toEqual([
      { integrationId: "calendar", enabled: false },
    ]);
  });

  it("builds first-send and pending flush plans", () => {
    expect(buildFlushPlan({
      chatId: undefined,
      draftParamDirty: true,
      draftSkillDirty: false,
      draftIntegrationDirty: true,
      pendingParamOverrides: null,
      pendingSkillOverrides: null,
      pendingIntegrationOverrides: null,
    })).toEqual({ parameters: true, skills: false, integrations: true });

    expect(buildFlushPlan({
      chatId: "chat_1" as Id<"chats">,
      draftParamDirty: false,
      draftSkillDirty: false,
      draftIntegrationDirty: false,
      pendingParamOverrides: DEFAULT_OVERRIDES,
      pendingSkillOverrides: null,
      pendingIntegrationOverrides: new Map(),
    })).toEqual({ parameters: true, skills: false, integrations: true });
  });
});
