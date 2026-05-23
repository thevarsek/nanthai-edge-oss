import { expect, test } from "vitest";

import { buildPersonaMutationPayload, defaultForm } from "./PersonaEditorForm";

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
