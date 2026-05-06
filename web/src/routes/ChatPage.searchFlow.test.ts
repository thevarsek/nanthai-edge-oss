import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Participant } from "@/hooks/useChat";
import { buildRegeneratePaperArgs } from "./ChatPage.searchFlow";

describe("ChatPage search flow helpers", () => {
  it("builds regenerate paper args from the active participant", () => {
    const participant: Participant = {
      modelId: "openai/gpt-5.2",
      personaId: "persona_1" as Id<"personas">,
      personaName: "Researcher",
      personaEmoji: "R",
      personaAvatarImageUrl: "https://example.com/avatar.png",
      temperature: 0.2,
      maxTokens: 4000,
      includeReasoning: true,
      reasoningEffort: "high",
    };

    expect(buildRegeneratePaperArgs({
      sessionId: "session_1",
      participant,
      enabledIntegrations: new Set(["gmail", "drive"]),
    })).toEqual({
      sessionId: "session_1",
      modelId: "openai/gpt-5.2",
      personaId: "persona_1",
      personaName: "Researcher",
      personaEmoji: "R",
      personaAvatarImageUrl: "https://example.com/avatar.png",
      temperature: 0.2,
      maxTokens: 4000,
      includeReasoning: true,
      reasoningEffort: "high",
      enabledIntegrations: ["gmail", "drive"],
    });
  });
});
