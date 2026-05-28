import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Chat, UseChatReturn } from "@/hooks/useChat";
import { useChatOverrides } from "@/hooks/useChatOverrides";

const convexMocks = vi.hoisted(() => ({
  mutationIndex: 0,
  mutations: [vi.fn(async (args: unknown) => args), vi.fn(async (args: unknown) => args)],
}));

vi.mock("convex/react", () => ({
  useMutation: () => convexMocks.mutations[convexMocks.mutationIndex++ % convexMocks.mutations.length],
}));

const chatId = "chat_1" as Id<"chats">;

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    _id: chatId,
    mode: "chat",
    createdAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  convexMocks.mutationIndex = 0;
  for (const mutation of convexMocks.mutations) {
    mutation.mockClear();
    mutation.mockImplementation(async (args: unknown) => args);
  }
});

describe("useChatOverrides", () => {
  it("keeps new-chat drafts local, derives badges, and flushes dirty state to the created chat", async () => {
    const updateChat = vi.fn(async (args: unknown) => args);
    const activePersona = {
      skillOverrides: [{ skillId: "skill_research", state: "available" as const }],
      integrationOverrides: [{ integrationId: "drive", enabled: true }],
    };
    const { result } = renderHook(() => useChatOverrides({
      chat: null,
      chatId: undefined,
      activePersona,
      updateChat: updateChat as UseChatReturn["updateChat"],
    }));

    await waitFor(() => {
      expect(result.current.enabledSkillIds.has("skill_research")).toBe(true);
      expect(result.current.enabledIntegrations.has("drive")).toBe(true);
    });
    expect(result.current.badges).toMatchObject({ skills: 1, integrations: 1, parameters: 0 });

    act(() => {
      result.current.setParamOverrides({
        temperatureMode: "override",
        temperature: 0.2,
        maxTokensMode: "override",
        maxTokens: 512,
        reasoningMode: "on",
        reasoningEffort: "high",
        autoAudioResponseMode: "off",
      });
      result.current.cycleSkill("skill_research" as Id<"skills">);
      result.current.toggleIntegration("drive");
    });

    expect(result.current.skillOverrides.get("skill_research")).toBe("never");
    expect(result.current.integrationOverrides.get("drive")).toBe(false);
    expect(result.current.badges).toMatchObject({ skills: 0, integrations: 0, parameters: 1 });

    await act(async () => {
      await result.current.flushPendingState("chat_created" as Id<"chats">);
    });

    expect(updateChat).toHaveBeenCalledWith(expect.objectContaining({
      chatId: "chat_created",
      temperatureOverride: 0.2,
      maxTokensOverride: 512,
      includeReasoningOverride: true,
      reasoningEffortOverride: "high",
      autoAudioResponseOverride: "disabled",
    }));
    expect(convexMocks.mutations[0]).toHaveBeenCalledWith({
      chatId: "chat_created",
      skillOverrides: [{ skillId: "skill_research", state: "never" }],
    });
    expect(convexMocks.mutations[1]).toHaveBeenCalledWith({
      chatId: "chat_created",
      integrationOverrides: [{ integrationId: "drive", enabled: false }],
    });
  });

  it("persists existing-chat optimistic parameter, skill, and integration overrides", async () => {
    const updateChat = vi.fn(async (args: unknown) => args);
    const { result } = renderHook(() => useChatOverrides({
      chat: chat({
        temperatureOverride: 0.7,
        skillOverrides: [{ skillId: "skill_research", state: "always" }],
        integrationOverrides: [{ integrationId: "drive", enabled: false }],
      }),
      chatId,
      activePersona: null,
      updateChat: updateChat as UseChatReturn["updateChat"],
    }));

    expect(result.current.paramOverrides.temperature).toBe(0.7);
    expect(result.current.enabledSkillIds.has("skill_research")).toBe(true);
    expect(result.current.enabledIntegrations.has("drive")).toBe(false);

    act(() => {
      result.current.setParamOverrides({
        temperatureMode: "default",
        temperature: 1,
        maxTokensMode: "default",
        maxTokens: undefined,
        reasoningMode: "off",
        reasoningEffort: "medium",
        autoAudioResponseMode: "on",
      });
      result.current.toggleSkill("skill_research" as Id<"skills">);
      result.current.toggleIntegration("drive");
      result.current.toggleKBFile("file_1" as Id<"fileAttachments">);
      result.current.handlePlusMenuSelect("skills");
    });

    expect(result.current.paramOverrides.reasoningMode).toBe("off");
    expect(result.current.enabledSkillIds.has("skill_research")).toBe(false);
    expect(result.current.enabledIntegrations.has("drive")).toBe(true);
    expect(result.current.selectedKBFileIds.has("file_1")).toBe(true);
    expect(result.current.activePanel).toBe("skills");

    await waitFor(() => {
      expect(updateChat).toHaveBeenCalledWith(expect.objectContaining({
        chatId,
        temperatureOverride: null,
        maxTokensOverride: null,
        includeReasoningOverride: false,
        reasoningEffortOverride: null,
        autoAudioResponseOverride: "enabled",
      }));
      expect(convexMocks.mutations[0]).toHaveBeenCalledWith({
        chatId,
        skillOverrides: [],
      });
      expect(convexMocks.mutations[1]).toHaveBeenCalledWith({
        chatId,
        integrationOverrides: [{ integrationId: "drive", enabled: true }],
      });
    });

    act(() => {
      result.current.closePanel();
      result.current.clearKBFiles();
    });

    expect(result.current.activePanel).toBeNull();
    expect(result.current.selectedKBFileIds.size).toBe(0);
  });
});
