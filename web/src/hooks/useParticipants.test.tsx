import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import { useParticipants, type ChatParticipantDoc } from "./useParticipants";

const convexState = vi.hoisted(() => ({
  queryResult: undefined as ChatParticipantDoc[] | undefined,
  queryCalls: [] as unknown[],
  mutationCallIndex: 0,
  addParticipant: vi.fn(async () => "participant_new" as Id<"chatParticipants">),
  removeParticipant: vi.fn(async () => null),
  setParticipants: vi.fn(async () => null),
}));

vi.mock("convex/react", () => ({
  useQuery: (query: unknown, args: unknown) => {
    convexState.queryCalls.push({ query, args });
    return convexState.queryResult;
  },
  useMutation: (mutation: unknown) => {
    const name = (mutation as { functionName?: unknown })?.functionName;
    if (typeof name !== "string") {
      const index = convexState.mutationCallIndex % 3;
      convexState.mutationCallIndex += 1;
      if (index === 1) return convexState.removeParticipant;
      if (index === 2) return convexState.setParticipants;
      return convexState.addParticipant;
    }
    if (name.includes("removeParticipant")) return convexState.removeParticipant;
    if (name.includes("setParticipants")) return convexState.setParticipants;
    return convexState.addParticipant;
  },
}));

function participantDoc(overrides: Partial<ChatParticipantDoc> = {}): ChatParticipantDoc {
  return {
    _id: "participant_1" as Id<"chatParticipants">,
    _creationTime: 1,
    chatId: "chat_1" as Id<"chats">,
    userId: "user_1",
    modelId: "openai/gpt-5.2",
    personaId: "persona_1" as Id<"personas">,
    personaName: "Analyst",
    personaEmoji: "A",
    personaAvatarImageUrl: "https://example.com/a.png",
    temperature: 0.4,
    maxTokens: 1024,
    includeReasoning: true,
    reasoningEffort: "medium",
    sortOrder: 2,
    createdAt: 1,
    ...overrides,
  };
}

describe("useParticipants", () => {
  beforeEach(() => {
    convexState.queryResult = undefined;
    convexState.queryCalls = [];
    convexState.mutationCallIndex = 0;
    convexState.addParticipant.mockClear();
    convexState.removeParticipant.mockClear();
    convexState.setParticipants.mockClear();
  });

  it("skips Convex when no chat is selected and reports an empty ready state", () => {
    const { result } = renderHook(() => useParticipants(null));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.rawDocs).toEqual([]);
    expect(result.current.participants).toEqual([]);
    expect(convexState.queryCalls[0]).toMatchObject({ args: "skip" });
  });

  it("maps nullable Convex participant docs into picker and send-message shapes", () => {
    convexState.queryResult = [
      participantDoc(),
      participantDoc({
        _id: "participant_2" as Id<"chatParticipants">,
        modelId: "anthropic/claude-sonnet-4",
        personaId: undefined,
        personaName: undefined,
        personaEmoji: undefined,
        personaAvatarImageUrl: undefined,
        temperature: null,
        maxTokens: null,
        includeReasoning: null,
        reasoningEffort: null,
        sortOrder: 1,
      }),
    ];

    const { result } = renderHook(() => useParticipants("chat_1" as Id<"chats">));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.participants).toEqual([
      expect.objectContaining({
        id: "participant_1",
        personaId: "persona_1",
        personaName: "Analyst",
        temperature: 0.4,
        includeReasoning: true,
      }),
      expect.objectContaining({
        id: "participant_2",
        personaId: null,
        personaName: null,
        temperature: null,
        includeReasoning: null,
      }),
    ]);
    expect(result.current.asMessageParticipants[0]).toMatchObject({
      id: "participant_1",
      modelId: "openai/gpt-5.2",
      personaName: "Analyst",
      temperature: 0.4,
      maxTokens: 1024,
    });
    expect(result.current.asMessageParticipants[1]).toMatchObject({
      temperature: undefined,
      maxTokens: undefined,
      includeReasoning: undefined,
      reasoningEffort: undefined,
    });
    expect(convexState.queryCalls[0]).toMatchObject({ args: { chatId: "chat_1" } });
  });

  it("wraps participant mutations in the Convex wire shape", async () => {
    const { result } = renderHook(() => useParticipants("chat_1" as Id<"chats">));

    await expect(result.current.addParticipant({
      chatId: "chat_1" as Id<"chats">,
      modelId: "openai/gpt-5.2",
      sortOrder: 3,
    })).resolves.toBe("participant_new");

    await act(async () => {
      await result.current.removeParticipant("participant_1" as Id<"chatParticipants">);
      await result.current.setParticipants("chat_1" as Id<"chats">, [{
        modelId: "anthropic/claude-sonnet-4",
        personaName: "Reviewer",
      }]);
    });

    expect(convexState.addParticipant).toHaveBeenCalledWith({
      chatId: "chat_1",
      modelId: "openai/gpt-5.2",
      sortOrder: 3,
    });
    expect(convexState.removeParticipant).toHaveBeenCalledWith({ participantId: "participant_1" });
    expect(convexState.setParticipants).toHaveBeenCalledWith({
      chatId: "chat_1",
      participants: [{ modelId: "anthropic/claude-sonnet-4", personaName: "Reviewer" }],
    });
  });
});
