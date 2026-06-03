import { expect, test } from "vitest";

import { buildPersonaMutationPayload, defaultForm, parsePersonaMaxTokens } from "./PersonaEditorForm";

test("persona update payload sends explicit nulls for cleared optional fields", () => {
  const form = {
    ...defaultForm(),
    displayName: " Researcher ",
    systemPrompt: " Be precise ",
    modelId: "openai/gpt-5",
    personaDescription: "",
    avatarEmoji: "",
    temperatureEnabled: false,
    temperature: "0.4",
    maxTokensEnabled: false,
    maxTokens: "4096",
    includeReasoningEnabled: false,
    includeReasoning: true,
    reasoningEffortEnabled: true,
    reasoningEffort: "high" as const,
  };

  expect(buildPersonaMutationPayload(form, undefined, false)).toMatchObject({
    displayName: "Researcher",
    systemPrompt: "Be precise",
    personaDescription: null,
    avatarEmoji: null,
    temperature: null,
    maxTokens: null,
    includeReasoning: null,
    reasoningEffort: null,
  });
});

test("persona max tokens parser accepts only positive safe integers", () => {
  expect(parsePersonaMaxTokens("4096")).toBe(4096);
  expect(parsePersonaMaxTokens(" 1200 ")).toBe(1200);
  expect(parsePersonaMaxTokens("abc")).toBeNull();
  expect(parsePersonaMaxTokens("12abc")).toBeNull();
  expect(parsePersonaMaxTokens("1.5")).toBeNull();
  expect(parsePersonaMaxTokens("0")).toBeNull();
});

test("persona payload serializes valid max token overrides exactly and rejects invalid overrides", () => {
  const form = {
    ...defaultForm(),
    displayName: "Researcher",
    systemPrompt: "Be precise",
    modelId: "openai/gpt-5",
    maxTokensEnabled: true,
    maxTokens: "4096",
  };

  expect(buildPersonaMutationPayload(form, undefined, false)).toMatchObject({
    maxTokens: 4096,
  });

  expect(() => buildPersonaMutationPayload({ ...form, maxTokens: "abc" }, undefined, false))
    .toThrow("Invalid persona max tokens");
  expect(() => buildPersonaMutationPayload({ ...form, maxTokens: "1.5" }, undefined, false))
    .toThrow("Invalid persona max tokens");
});
