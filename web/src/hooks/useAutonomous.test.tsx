import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_AUTONOMOUS_SETTINGS,
  estimateAutonomousCost,
  useAutonomous,
  type AutonomousSettings,
} from "./useAutonomous";
import type { Id } from "@convex/_generated/dataModel";
import type { Participant } from "./useChat";

const mockState = vi.hoisted(() => ({
  activeSessions: undefined as unknown,
  session: undefined as unknown,
  mutationIndex: 0,
  start: vi.fn(async () => "session_1"),
  pause: vi.fn(async () => null),
  resume: vi.fn(async () => null),
  stop: vi.fn(async () => null),
  intervene: vi.fn(async () => null),
}));

vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => {
    if (args && typeof args === "object" && "sessionId" in args) return mockState.session;
    return mockState.activeSessions;
  },
  useMutation: () => {
    const mutations = [mockState.start, mockState.pause, mockState.resume, mockState.stop, mockState.intervene];
    const mutation = mutations[mockState.mutationIndex % mutations.length]!;
    mockState.mutationIndex += 1;
    return mutation;
  },
}));

const chatId = "chat_1" as Id<"chats">;
const participants: Participant[] = [
  {
    id: "writer",
    modelId: "openai/gpt-4.1",
    personaId: "persona_writer" as Id<"personas">,
    personaName: "Writer",
    systemPrompt: "Write clearly.",
    temperature: 0.4,
    maxTokens: 800,
    includeReasoning: true,
    reasoningEffort: "medium",
  },
  { id: "critic", modelId: "anthropic/claude-sonnet-4.5", personaName: "Critic" },
  { id: "mod", modelId: "google/gemini-3-pro", personaName: "Moderator", personaId: "persona_mod" as Id<"personas"> },
];

function renderAutonomous(overrides: Partial<Parameters<typeof useAutonomous>[0]> = {}) {
  mockState.mutationIndex = 0;
  return renderHook(() =>
    useAutonomous({
      chatId,
      participants,
      hasMessages: true,
      isPro: true,
      ...overrides,
    }),
  );
}

describe("useAutonomous", () => {
  beforeEach(() => {
    mockState.activeSessions = undefined;
    mockState.session = undefined;
    mockState.mutationIndex = 0;
    mockState.start.mockReset().mockResolvedValue("session_1");
    mockState.pause.mockReset().mockResolvedValue(null);
    mockState.resume.mockReset().mockResolvedValue(null);
    mockState.stop.mockReset().mockResolvedValue(null);
    mockState.intervene.mockReset().mockResolvedValue(null);
  });

  it("estimates turns and warning levels with moderator exclusion", () => {
    expect(estimateAutonomousCost(DEFAULT_AUTONOMOUS_SETTINGS, 2)).toEqual({ cost: 0.03, warning: "low" });
    expect(estimateAutonomousCost({ ...DEFAULT_AUTONOMOUS_SETTINGS, maxCycles: 30 }, 3).warning).toBe("medium");
    expect(estimateAutonomousCost({ ...DEFAULT_AUTONOMOUS_SETTINGS, maxCycles: 100, moderatorParticipantId: "mod" }, 4)).toEqual({
      cost: 0.9,
      warning: "high",
    });
  });

  it("gates configuration and start behind pro, participants, messages, and chat id", async () => {
    const { result, rerender } = renderAutonomous({ isPro: false });

    expect(result.current.canConfigure).toBe(false);
    act(() => result.current.showSettings());
    expect(result.current.state).toEqual({ status: "inactive" });
    await act(async () => result.current.start());
    expect(mockState.start).not.toHaveBeenCalled();

    rerender();
    const withoutChat = renderAutonomous({ chatId: undefined }).result;
    await act(async () => withoutChat.current.start());
    expect(mockState.start).not.toHaveBeenCalled();
  });

  it("starts a session with stable turn order, participant configs, and moderator config", async () => {
    const settings: AutonomousSettings = {
      maxCycles: 7,
      pauseBetweenTurns: 2,
      autoStopOnConsensus: true,
      moderatorParticipantId: "mod",
    };
    const { result } = renderAutonomous();

    act(() => {
      result.current.setSettings(settings);
      result.current.showSettings();
    });
    expect(result.current.state).toEqual({ status: "configuring" });

    await act(async () => result.current.start());

    expect(mockState.start).toHaveBeenCalledWith({
      chatId,
      turnOrder: ["writer", "critic"],
      maxCycles: 7,
      pauseBetweenTurns: 2,
      autoStopOnConsensus: true,
      moderatorParticipantId: "mod",
      moderatorConfig: {
        modelId: "google/gemini-3-pro",
        displayName: "Moderator",
        personaId: "persona_mod",
      },
      participantConfigs: [
        {
          participantId: "writer",
          modelId: "openai/gpt-4.1",
          displayName: "Writer",
          personaId: "persona_writer",
          systemPrompt: "Write clearly.",
          temperature: 0.4,
          maxTokens: 800,
          includeReasoning: true,
          reasoningEffort: "medium",
        },
        {
          participantId: "critic",
          modelId: "anthropic/claude-sonnet-4.5",
          displayName: "Critic",
        },
      ],
    });
    expect(result.current.state).toEqual({ status: "active", cycle: 0, maxCycles: 7, currentParticipant: "Starting..." });
  });

  it("maps watched session states into UI state and resumes with current participant configs", async () => {
    mockState.session = {
      _id: "session_1",
      status: "running",
      currentCycle: 2,
      maxCycles: 5,
      currentParticipantIndex: 1,
      turnOrder: ["writer", "critic"],
    };
    const { result } = renderAutonomous();

    await act(async () => result.current.start());
    await waitFor(() => expect(result.current.state).toEqual({
      status: "active",
      cycle: 2,
      maxCycles: 5,
      currentParticipant: "Critic",
    }));

    await act(async () => result.current.resume());
    expect(mockState.resume).toHaveBeenCalledWith({
      sessionId: "session_1",
      participantConfigs: [
        {
          participantId: "writer",
          modelId: "openai/gpt-4.1",
          displayName: "Writer",
          personaId: "persona_writer",
          temperature: 0.4,
          maxTokens: 800,
          includeReasoning: true,
          reasoningEffort: "medium",
        },
        {
          participantId: "critic",
          modelId: "anthropic/claude-sonnet-4.5",
          displayName: "Critic",
        },
      ],
    });
  });

  it("pauses, stops, intervenes, handles start errors, and resets ended state", async () => {
    const { result } = renderAutonomous();
    await act(async () => result.current.start());

    await act(async () => result.current.pause());
    expect(mockState.pause).toHaveBeenCalledWith({ sessionId: "session_1" });

    await act(async () => result.current.stop());
    expect(mockState.stop).toHaveBeenCalledWith({ sessionId: "session_1" });
    expect(result.current.state).toEqual({ status: "ended", reason: "Stopped by user" });

    act(() => result.current.dismissEnded());
    expect(result.current.state).toEqual({ status: "inactive" });
    expect(result.current.settings).toEqual(DEFAULT_AUTONOMOUS_SETTINGS);

    await act(async () => result.current.start());
    await act(async () => result.current.intervene("need a human"));
    expect(mockState.intervene).toHaveBeenCalledWith({ sessionId: "session_1", forceSendNow: true });
    expect(result.current.state).toEqual({ status: "ended", reason: "User intervened: need a human" });

    mockState.start.mockRejectedValueOnce(new Error("quota exceeded"));
    act(() => result.current.dismissEnded());
    await act(async () => result.current.start());
    expect(result.current.state).toEqual({ status: "ended", reason: "Failed to start: quota exceeded" });
  });
});
