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
    const analytics = {
      platform: "web" as const,
      surface: "web_app",
      routeOrScreen: "/app/chat/session_1",
      clientEventId: "event_1",
      clientSentAt: 123,
    };

    expect(buildRegeneratePaperArgs({
      sessionId: "session_1",
      participant,
      enabledIntegrations: new Set(["gmail", "drive"]),
      analytics,
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
      analytics,
    });
  });

  it("omits optional regenerate paper args when participant metadata is absent", () => {
    expect(buildRegeneratePaperArgs({
      sessionId: "session_2",
      participant: {
        modelId: "anthropic/claude-sonnet-4",
        personaId: null,
        personaName: "",
        personaEmoji: null,
        personaAvatarImageUrl: null,
        temperature: undefined,
        maxTokens: undefined,
        includeReasoning: undefined,
        reasoningEffort: "",
      },
      enabledIntegrations: new Set(),
    })).toEqual({
      sessionId: "session_2",
      modelId: "anthropic/claude-sonnet-4",
    });
  });
});
