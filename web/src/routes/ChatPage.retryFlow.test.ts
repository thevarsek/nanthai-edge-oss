import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message, Participant } from "@/hooks/useChat";
import {
  buildRetryMessageArgs,
  retryGoogleIntegrationsAreActive,
  retryParticipantWithModel,
  retryParticipantWithPersona,
} from "./ChatPage.retryFlow";

const messageId = "msg_1" as Id<"messages">;
const participant: Participant = {
  modelId: "openai/gpt-5.2",
  personaId: "persona_1" as Id<"personas">,
  personaName: "Draft",
  personaEmoji: "D",
  personaAvatarImageUrl: "https://example.com/draft.png",
};

function message(overrides: Partial<Message> = {}): Message {
  return {
    _id: messageId,
    _creationTime: 1,
    chatId: "chat_1" as Id<"chats">,
    role: "assistant",
    content: "",
    status: "failed",
    createdAt: 1,
    ...overrides,
  };
}

describe("ChatPage retry flow helpers", () => {
  it("uses backend retryContract as authoritative when present", () => {
    expect(buildRetryMessageArgs({
      messageId,
      targetMessage: message({ retryContract: { participants: [participant], searchMode: "web" } }),
      convexSearchMode: "web",
      convexComplexity: 2,
      enabledIntegrations: new Set(["drive"]),
      turnSkillOverrideEntries: [{ skillId: "skill_1" as Id<"skills">, state: "always" }],
      turnIntegrationOverrideEntries: [{ integrationId: "calendar", enabled: true }],
      effectiveSubagentsEnabled: true,
    })).toEqual({ messageId });
  });

  it("builds legacy retry args from current overrides when no retryContract exists", () => {
    expect(buildRetryMessageArgs({
      messageId,
      targetMessage: message(),
      convexSearchMode: "normal",
      convexComplexity: 1,
      enabledIntegrations: new Set(["drive"]),
      turnSkillOverrideEntries: [{ skillId: "skill_1" as Id<"skills">, state: "available" }],
      turnIntegrationOverrideEntries: [{ integrationId: "calendar", enabled: true }],
      effectiveSubagentsEnabled: false,
    })).toEqual({
      messageId,
      searchMode: "normal",
      complexity: 1,
      enabledIntegrations: ["drive"],
      turnSkillOverrides: [{ skillId: "skill_1", state: "available" }],
      turnIntegrationOverrides: [{ integrationId: "calendar", enabled: true }],
      subagentsEnabled: false,
    });
  });

  it("detects Google integrations from retry contract or legacy message fields", () => {
    expect(retryGoogleIntegrationsAreActive(message({
      retryContract: { participants: [], searchMode: "none", enabledIntegrations: ["calendar"] },
    }))).toBe(true);
    expect(retryGoogleIntegrationsAreActive(message({
      retryContract: { participants: [], searchMode: "none", enabledIntegrations: ["gmail"] },
    }))).toBe(true);
    expect(retryGoogleIntegrationsAreActive(message({ enabledIntegrations: ["slack"] }))).toBe(false);
  });

  it("builds retry participants for selected model or persona", () => {
    expect(retryParticipantWithModel(participant, "anthropic/claude-sonnet-4")).toMatchObject({
      modelId: "anthropic/claude-sonnet-4",
      personaId: null,
      personaName: null,
      personaEmoji: null,
      personaAvatarImageUrl: null,
    });

    expect(retryParticipantWithPersona({
      baseParticipant: participant,
      personaId: "persona_2",
      personas: [{
        _id: "persona_2",
        modelId: "google/gemini-3-pro",
        displayName: "Analyst",
        avatarEmoji: "A",
        avatarImageUrl: "https://example.com/a.png",
      }],
    })).toMatchObject({
      modelId: "google/gemini-3-pro",
      personaId: "persona_2",
      personaName: "Analyst",
      personaEmoji: "A",
      personaAvatarImageUrl: "https://example.com/a.png",
    });
  });
});
