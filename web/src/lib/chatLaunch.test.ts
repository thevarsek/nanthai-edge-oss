import { describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import {
  buildDefaultParticipants,
  buildFavoriteParticipants,
  buildPersonaParticipants,
  launchChat,
} from "./chatLaunch";

const personaId = "persona_1" as Id<"personas">;

describe("chatLaunch", () => {
  it("builds default participants from persona preferences without losing persona generation settings", () => {
    const participants = buildDefaultParticipants({
      prefs: { defaultModelId: "openai/gpt-5", defaultPersonaId: personaId },
      personas: [{
        _id: personaId,
        modelId: "anthropic/claude-sonnet-4",
        displayName: "Researcher",
        avatarEmoji: "R",
        temperature: 0.3,
        maxTokens: 2048,
        includeReasoning: true,
        reasoningEffort: "high",
      }],
      fallbackModelId: "openai/gpt-4.1",
    });

    expect(participants).toEqual([{
      modelId: "anthropic/claude-sonnet-4",
      personaId,
      personaName: "Researcher",
      personaEmoji: "R",
      personaAvatarImageUrl: null,
      temperature: 0.3,
      maxTokens: 2048,
      includeReasoning: true,
      reasoningEffort: "high",
    }]);
  });

  it("limits favorite launches to three participants and preserves per-participant overrides", () => {
    const favorite = {
      _id: "favorite_1" as Id<"favorites">,
      modelIds: [],
      participants: [
        { modelId: "a", temperature: 0.1 },
        { modelId: "b", maxTokens: 1000 },
        { modelId: "c", includeReasoning: false },
        { modelId: "d", reasoningEffort: "high" },
      ],
    };

    expect(buildFavoriteParticipants(favorite)).toEqual([
      {
        modelId: "a",
        personaId: null,
        personaName: null,
        personaEmoji: null,
        personaAvatarImageUrl: null,
        temperature: 0.1,
        maxTokens: undefined,
        includeReasoning: undefined,
        reasoningEffort: undefined,
      },
      {
        modelId: "b",
        personaId: null,
        personaName: null,
        personaEmoji: null,
        personaAvatarImageUrl: null,
        temperature: undefined,
        maxTokens: 1000,
        includeReasoning: undefined,
        reasoningEffort: undefined,
      },
      {
        modelId: "c",
        personaId: null,
        personaName: null,
        personaEmoji: null,
        personaAvatarImageUrl: null,
        temperature: undefined,
        maxTokens: undefined,
        includeReasoning: false,
        reasoningEffort: undefined,
      },
    ]);
  });

  it("uses persona and folder context when creating a new chat", async () => {
    const createChat = vi.fn(async () => "chat_1" as Id<"chats">);
    const participants = buildPersonaParticipants({
      _id: personaId,
      modelId: "",
      displayName: "Writer",
      avatarImageUrl: "https://example.test/avatar.png",
    }, "openai/gpt-4.1");

    await expect(launchChat({
      createChat,
      participants,
      folderId: "folder_1",
    })).resolves.toBe("chat_1");

    expect(createChat).toHaveBeenCalledWith({
      mode: "chat",
      folderId: "folder_1",
      participants: [{
        modelId: "openai/gpt-4.1",
        personaId,
        personaName: "Writer",
        personaEmoji: null,
        personaAvatarImageUrl: "https://example.test/avatar.png",
        temperature: undefined,
        maxTokens: undefined,
        includeReasoning: undefined,
        reasoningEffort: undefined,
      }],
    });
  });
});
