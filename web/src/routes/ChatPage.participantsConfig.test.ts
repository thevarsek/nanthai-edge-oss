import { describe, expect, it } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { ParticipantEntry } from "@/hooks/useParticipants";
import {
  chatParticipantsConfigSnapshot,
  googleIntegrationsBlockedForParticipants,
  participantsSupportFrameImages,
  participantsSupportTools,
  participantsUseVideo,
} from "@/routes/ChatPage.participantsConfig";
import { DEFAULT_PARAMETER_OVERRIDES } from "@/lib/chatRequestResolution";

const personaId = "persona_1" as Id<"personas">;

function participant(overrides: Partial<ParticipantEntry> = {}): ParticipantEntry {
  return {
    id: "participant_1" as Id<"chatParticipants">,
    modelId: "openai/gpt-5.2",
    personaId: null,
    personaName: null,
    personaEmoji: null,
    personaAvatarImageUrl: null,
    sortOrder: 0,
    ...overrides,
  };
}

describe("ChatPage participant config", () => {
  it("uses the default persona for new-chat participants and parameter preview", () => {
    const snapshot = chatParticipantsConfigSnapshot({
      convexParticipants: [],
      personas: [{
        _id: personaId,
        modelId: "anthropic/claude-sonnet-4",
        displayName: "Researcher",
        avatarEmoji: "R",
        temperature: 0.3,
        includeReasoning: true,
        reasoningEffort: "high",
      }],
      prefs: {
        defaultModelId: "openai/gpt-5.2",
        defaultPersonaId: personaId,
        autoAudioResponse: true,
      },
      modelSettings: undefined,
      modelSummaries: undefined,
      selectedModelId: "openai/gpt-5.2",
      parameterOverrides: DEFAULT_PARAMETER_OVERRIDES,
    });

    expect(snapshot.effectiveDefaultModelId).toBe("anthropic/claude-sonnet-4");
    expect(snapshot.participants).toMatchObject([{
      modelId: "anthropic/claude-sonnet-4",
      personaId,
      personaName: "Researcher",
      temperature: 0.3,
      reasoningEffort: "high",
    }]);
    expect(snapshot.paramDefaults).toMatchObject({
      temperature: 0.3,
      includeReasoning: true,
      reasoningEffort: "high",
      autoAudioResponse: true,
    });
  });

  it("prefers Convex participants for existing chats", () => {
    const snapshot = chatParticipantsConfigSnapshot({
      convexParticipants: [participant({
        modelId: "google/gemini-3-pro",
        personaId,
        personaName: "Analyst",
      })],
      personas: [{
        _id: personaId,
        displayName: "Analyst",
        temperature: 0.4,
      }],
      prefs: { defaultModelId: "openai/gpt-5.2" },
      modelSettings: undefined,
      modelSummaries: undefined,
      selectedModelId: "openai/gpt-5.2",
      parameterOverrides: {
        ...DEFAULT_PARAMETER_OVERRIDES,
        temperatureMode: "override",
        temperature: 0.9,
      },
    });

    expect(snapshot.baseParticipants).toMatchObject([{ modelId: "google/gemini-3-pro", personaId }]);
    expect(snapshot.participants[0]).toMatchObject({
      modelId: "google/gemini-3-pro",
      personaName: "Analyst",
      temperature: 0.9,
    });
  });

  it("projects model capability gates from resolved participants", () => {
    const participants = [
      { modelId: "openai/gpt-5.2" },
      { modelId: "video/model" },
    ];
    const summaries = [
      { modelId: "openai/gpt-5.2", supportsTools: true, hasZdrEndpoint: true, provider: "openai" },
      {
        modelId: "video/model",
        supportsTools: false,
        supportsVideo: true,
        supportedFrameImages: ["first", "last"],
        hasZdrEndpoint: false,
        provider: "other",
      },
    ];

    expect(participantsSupportTools(participants, summaries)).toBe(false);
    expect(participantsUseVideo(participants, summaries)).toBe(true);
    expect(participantsSupportFrameImages(participants, summaries)).toBe(true);
    expect(googleIntegrationsBlockedForParticipants(participants, summaries)).toBe(true);
  });
});
