import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message, Participant } from "@/hooks/useChat";
import { getAssistantDisplayIdentity } from "./MessageBubble.assistantIdentity";

function message(overrides: Partial<Message> = {}): Pick<Message, "modelId" | "participantId" | "participantName" | "participantEmoji" | "participantAvatarImageUrl"> {
  return {
    modelId: "openai/gpt-4o",
    ...overrides,
  };
}

describe("getAssistantDisplayIdentity", () => {
  it("uses provider identity for bare-model messages", () => {
    expect(getAssistantDisplayIdentity({
      message: message(),
      participants: [{ modelId: "openai/gpt-4o" }],
      modelDisplayName: "OpenAI: GPT-4o",
    })).toEqual({
      personaId: undefined,
      personaName: undefined,
      personaEmoji: undefined,
      personaAvatarImageUrl: undefined,
      label: "OpenAI: GPT-4o",
      hasPersonaDisplay: false,
    });
  });

  it("prefers persisted message identity over duplicate model participants", () => {
    const participants: Participant[] = [
      {
        modelId: "openai/gpt-4o",
        personaId: "planner" as Id<"personas">,
        personaName: "Planner",
        personaEmoji: "P",
        personaAvatarImageUrl: "https://example.com/planner.png",
      },
      {
        modelId: "openai/gpt-4o",
        personaId: "reviewer" as Id<"personas">,
        personaName: "Reviewer",
        personaEmoji: "R",
        personaAvatarImageUrl: "https://example.com/reviewer.png",
      },
    ];

    expect(getAssistantDisplayIdentity({
      message: message({
        participantId: "reviewer",
        participantName: "Reviewer",
        participantEmoji: "✅",
        participantAvatarImageUrl: "https://example.com/snapshot.png",
      }),
      participants,
      modelDisplayName: "GPT-4o",
    })).toEqual({
      personaId: "reviewer",
      personaName: "Reviewer",
      personaEmoji: "✅",
      personaAvatarImageUrl: "https://example.com/snapshot.png",
      label: "Reviewer",
      hasPersonaDisplay: true,
    });
  });

  it("does not enrich persisted names from the first matching model", () => {
    const participants: Participant[] = [{
      modelId: "openai/gpt-4o",
      personaName: "Planner",
      personaEmoji: "P",
      personaAvatarImageUrl: "https://example.com/planner.png",
    }];

    expect(getAssistantDisplayIdentity({
      message: message({ participantName: "Reviewer" }),
      participants,
      modelDisplayName: "GPT-4o",
    })).toMatchObject({
      personaName: "Reviewer",
      personaEmoji: undefined,
      personaAvatarImageUrl: undefined,
      label: "Reviewer",
    });
  });
});
