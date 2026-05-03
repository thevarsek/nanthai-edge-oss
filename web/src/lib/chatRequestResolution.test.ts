import { describe, expect, test } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import {
  buildBaseParticipants,
  resolveParameterDefaults,
  resolveParticipants,
  validateSendState,
  type ParameterOverrides,
} from "./chatRequestResolution";

const defaultOverrides: ParameterOverrides = {
  temperatureMode: "default",
  temperature: 1,
  maxTokensMode: "default",
  maxTokens: undefined,
  reasoningMode: "default",
  reasoningEffort: "medium",
};
const personaId = "persona_1" as Id<"personas">;

describe("chat request resolution", () => {
test("resolveParticipants uses persona before per-model and global defaults", () => {
  const participants = resolveParticipants({
    baseParticipants: [{
      modelId: "anthropic/claude-sonnet-4",
      personaId,
      personaName: "Research Analyst",
    }],
    personas: [{
      _id: personaId,
      temperature: 0.9,
      maxTokens: 4096,
      includeReasoning: true,
      reasoningEffort: "high",
    }],
    prefs: {
      defaultTemperature: 0.4,
      defaultMaxTokens: 2048,
      includeReasoning: false,
      reasoningEffort: "low",
    },
    modelSettings: [{
      openRouterId: "anthropic/claude-sonnet-4",
      temperature: 0.7,
      maxTokens: 3072,
      includeReasoning: true,
      reasoningEffort: "medium",
    }],
    overrides: defaultOverrides,
  });

  expect(participants[0]).toEqual({
    modelId: "anthropic/claude-sonnet-4",
    personaId: "persona_1",
    personaName: "Research Analyst",
    temperature: 0.9,
    maxTokens: 4096,
    includeReasoning: true,
    reasoningEffort: "high",
  });
});

test("resolveParticipants uses per-model defaults when persona is absent", () => {
  const participants = resolveParticipants({
    baseParticipants: [{ modelId: "openai/gpt-4.1", personaId: null }],
    personas: [],
    prefs: {
      defaultTemperature: 0.4,
      defaultMaxTokens: 2048,
      includeReasoning: false,
      reasoningEffort: "low",
    },
    modelSettings: [{
      openRouterId: "openai/gpt-4.1",
      temperature: 0.8,
      maxTokens: 8192,
      includeReasoning: true,
      reasoningEffort: "high",
    }],
    overrides: defaultOverrides,
  });

  expect(participants[0]?.temperature).toBe(0.8);
  expect(participants[0]?.maxTokens).toBe(8192);
  expect(participants[0]?.includeReasoning).toBe(true);
  expect(participants[0]?.reasoningEffort).toBe("high");
});

test("resolveParticipants applies explicit chat overrides and clears reasoning effort when disabled", () => {
  const participants = resolveParticipants({
    baseParticipants: [{ modelId: "openai/gpt-4.1", personaId: null }],
    personas: [],
    prefs: {
      defaultTemperature: 0.4,
      defaultMaxTokens: 2048,
      includeReasoning: true,
      reasoningEffort: "medium",
    },
    modelSettings: [],
    overrides: {
      temperatureMode: "override",
      temperature: 1.3,
      maxTokensMode: "override",
      maxTokens: 1024,
      reasoningMode: "off",
      reasoningEffort: "high",
    },
  });

  expect(participants[0]?.temperature).toBe(1.3);
  expect(participants[0]?.maxTokens).toBe(1024);
  expect(participants[0]?.includeReasoning).toBe(false);
  expect(participants[0]?.reasoningEffort).toBeNull();
});

test("resolveParameterDefaults falls back to true reasoning and medium effort", () => {
  const defaults = resolveParameterDefaults("openai/gpt-4.1", undefined, undefined);

  expect(defaults.includeReasoning).toBe(true);
  expect(defaults.reasoningEffort).toBe("medium");
});

test("buildBaseParticipants uses default persona model when creating a new chat", () => {
  const participants = buildBaseParticipants({
    convexParticipants: [],
    defaultPersona: {
      _id: personaId,
      modelId: "anthropic/claude-sonnet-4",
      displayName: "Research Analyst",
      avatarEmoji: "🔎",
    },
    selectedModelId: "openai/gpt-4.1",
  });

  expect(participants[0]?.modelId).toBe("anthropic/claude-sonnet-4");
  expect(participants[0]?.personaId).toBe(personaId);
  expect(participants[0]?.personaEmoji).toBe("🔎");
});

test("validateSendState blocks invalid research paper sends", () => {
  expect(validateSendState({
    participantCount: 2,
    isResearchPaper: true,
    attachmentCount: 0,
    complexity: 1,
  })).toBe("Research Paper requires a single participant.");

  expect(validateSendState({
    participantCount: 1,
    isResearchPaper: false,
    attachmentCount: 1,
    complexity: 3,
  })).toBe("Complexity 3 search does not support attachments.");

  expect(validateSendState({
    participantCount: 1,
    isResearchPaper: true,
    attachmentCount: 0,
    complexity: 2,
  })).toBeNull();
});
});
