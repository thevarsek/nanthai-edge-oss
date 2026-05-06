import { describe, expect, test } from "vitest";
import type { Chat } from "@/hooks/useChat";
import {
  buildOverrideBadges,
  chatOverridesFromChat,
  cycleSkillState,
  enabledIntegrationKeysFromOverrides,
  enabledSkillIdsFromOverrides,
  integrationOverridesFromChat,
  mapEquals,
  personaIntegrationDefaults,
  personaSkillDefaults,
  skillOverridesFromChat,
} from "@/hooks/useChatOverrides.resolution";

describe("useChatOverrides resolution", () => {
  test("maps chat parameter overrides from persisted chat fields", () => {
    expect(chatOverridesFromChat({
      temperatureOverride: 0.7,
      maxTokensOverride: 2048,
      includeReasoningOverride: true,
      reasoningEffortOverride: "high",
      autoAudioResponseOverride: "disabled",
    } as Chat)).toEqual({
      temperatureMode: "override",
      temperature: 0.7,
      maxTokensMode: "override",
      maxTokens: 2048,
      reasoningMode: "on",
      reasoningEffort: "high",
      autoAudioResponseMode: "off",
    });
  });

  test("layers chat skill overrides over persona defaults", () => {
    const personaDefaults = new Map([
      ["persona-skill", "always" as const],
      ["shared-skill", "available" as const],
    ]);
    const result = skillOverridesFromChat({
      skillOverrides: [
        { skillId: "chat-skill", state: "never" },
        { skillId: "shared-skill", state: "always" },
      ],
    } as Chat, personaDefaults);

    expect(Array.from(result.entries())).toEqual([
      ["persona-skill", "always"],
      ["shared-skill", "always"],
      ["chat-skill", "never"],
    ]);
  });

  test("inherits persona integration defaults until chat has overrides", () => {
    const personaDefaults = new Map([["drive", true]]);

    expect(Array.from(integrationOverridesFromChat({} as Chat, personaDefaults).entries())).toEqual([
      ["drive", true],
    ]);
    expect(Array.from(integrationOverridesFromChat({
      integrationOverrides: [{ integrationId: "gmail", enabled: true }],
    } as Chat, personaDefaults).entries())).toEqual([
      ["drive", true],
      ["gmail", true],
    ]);
  });

  test("derives persona defaults and enabled compatibility sets", () => {
    const persona = {
      skillOverrides: [
        { skillId: "skill-a", state: "always" as const },
        { skillId: "skill-b", state: "never" as const },
      ],
      integrationOverrides: [
        { integrationId: "drive", enabled: true },
        { integrationId: "gmail", enabled: false },
      ],
    };

    expect(Array.from(personaSkillDefaults(persona).entries())).toEqual([
      ["skill-a", "always"],
      ["skill-b", "never"],
    ]);
    expect(Array.from(enabledSkillIdsFromOverrides(personaSkillDefaults(persona)))).toEqual(["skill-a"]);
    expect(Array.from(personaIntegrationDefaults(persona).entries())).toEqual([
      ["drive", true],
      ["gmail", false],
    ]);
    expect(Array.from(enabledIntegrationKeysFromOverrides(personaIntegrationDefaults(persona)))).toEqual(["drive"]);
  });

  test("cycles skill overrides through always, available, never, inherited", () => {
    expect(cycleSkillState(undefined)).toBe("always");
    expect(cycleSkillState("always")).toBe("available");
    expect(cycleSkillState("available")).toBe("never");
    expect(cycleSkillState("never")).toBeUndefined();
  });

  test("compares maps and builds badge counts", () => {
    expect(mapEquals(new Map([["a", true]]), new Map([["a", true]]))).toBe(true);
    expect(mapEquals(new Map([["a", true]]), new Map([["a", false]]))).toBe(false);

    expect(buildOverrideBadges({
      paramOverrides: {
        temperatureMode: "default",
        temperature: 1,
        maxTokensMode: "default",
        maxTokens: undefined,
        reasoningMode: "on",
        reasoningEffort: "medium",
        autoAudioResponseMode: "default",
      },
      enabledIntegrations: new Set(["drive"]),
      enabledSkillIds: new Set(["skill-a", "skill-b"]),
      selectedKBFileIds: new Set(["file-a"]),
    })).toEqual({
      parameters: 1,
      integrations: 1,
      skills: 2,
      knowledgeBase: 1,
    });
  });
});
