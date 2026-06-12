import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { ActiveJob, Chat, Message, StreamingMessage } from "@/hooks/useChat";
import { useChat } from "@/hooks/useChat";

const analyticsMocks = vi.hoisted(() => ({
  analyticsErrorLabel: vi.fn((error: unknown) => error instanceof Error ? error.name.toLowerCase() : "unknown_error"),
  captureAnalytics: vi.fn(),
  createAnalyticsClientMetadata: vi.fn((event: string) => ({
    platform: "web",
    surface: "web_app",
    clientEventId: `${event}-test-event`,
    clientSentAt: 123,
  })),
}));

const featureAnalyticsMocks = vi.hoisted(() => ({
  captureSendFeatureUsage: vi.fn(),
}));

const convexMocks = vi.hoisted(() => ({
  queryResults: [] as unknown[],
  queryCalls: [] as Array<{ args: unknown }>,
  mutationIndex: 0,
  mutations: Array.from({ length: 6 }, () => vi.fn(async (args: unknown) => args)),
}));

vi.mock("@/lib/analytics", () => analyticsMocks);
vi.mock("@/lib/featureAnalytics", () => featureAnalyticsMocks);
vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) => {
    convexMocks.queryCalls.push({ args });
    if (args === "skip") return undefined;
    const resultIndex = (convexMocks.queryCalls.length - 1) % 4;
    return convexMocks.queryResults[resultIndex];
  },
  useMutation: () => convexMocks.mutations[convexMocks.mutationIndex++ % convexMocks.mutations.length],
}));

const chatId = "chat_1" as Id<"chats">;
const messageId = "message_1" as Id<"messages">;

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    _id: chatId,
    title: "Planning",
    mode: "chat",
    createdAt: 1,
    ...overrides,
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    _id: messageId,
    _creationTime: 1,
    chatId,
    role: "assistant",
    content: "base",
    status: "completed",
    createdAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  convexMocks.queryResults = [];
  convexMocks.queryCalls = [];
  convexMocks.mutationIndex = 0;
  for (const mutation of convexMocks.mutations) {
    mutation.mockClear();
    mutation.mockImplementation(async (args: unknown) => args);
  }
  analyticsMocks.analyticsErrorLabel.mockClear();
  analyticsMocks.captureAnalytics.mockClear();
  analyticsMocks.createAnalyticsClientMetadata.mockClear();
  featureAnalyticsMocks.captureSendFeatureUsage.mockClear();
});

describe("useChat", () => {
  it("skips Convex subscriptions without a chat id and exposes loading state", () => {
    const { result } = renderHook(() => useChat(null));

    expect(result.current.chat).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(result.current.activeJobs).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isGenerating).toBe(false);
    expect(convexMocks.queryCalls.map((call) => call.args)).toEqual(["skip", "skip", "skip", "skip"]);
  });

  it("subscribes with the shared Convex contract and merges streaming overlays", () => {
    const streaming: StreamingMessage = {
      messageId,
      content: "streamed answer",
      reasoning: "thinking",
      status: "streaming",
    };
    const activeJob: ActiveJob = { _id: "job_1" as Id<"generationJobs">, status: "queued", messageId };
    convexMocks.queryResults = [
      chat(),
      [message({ content: "", status: "pending" })],
      [streaming],
      [activeJob],
    ];

    const { result } = renderHook(() => useChat(chatId));

    expect(result.current.chat).toMatchObject({ _id: chatId, title: "Planning" });
    expect(result.current.messages[0]).toMatchObject({
      content: "streamed answer",
      reasoning: "thinking",
      status: "streaming",
    });
    expect(result.current.activeJobs).toEqual([activeJob]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isGenerating).toBe(true);
    expect(convexMocks.queryCalls.map((call) => call.args)).toEqual([
      { chatId },
      { chatId, limit: 500 },
      { chatId },
      { chatId },
    ]);
  });

  it("strips local-only participant ids when sending and retrying", async () => {
    convexMocks.queryResults = [chat(), [], [], []];
    convexMocks.mutations[0]!.mockResolvedValue({ userMessageId: "user_msg", assistantMessageIds: ["assistant_msg"] });
    convexMocks.mutations[2]!.mockResolvedValue({ assistantMessageIds: ["retry_msg"] });
    const { result } = renderHook(() => useChat(chatId));
    const participant = {
      id: "local-participant",
      modelId: "openai/gpt-4.1",
      personaId: "persona_1" as Id<"personas">,
      personaName: "Analyst",
      temperature: 0.4,
    };

    await act(async () => {
      await result.current.sendMessage({
        chatId,
        text: "hello",
        participants: [participant],
        searchMode: "web",
        complexity: 4,
      });
      await result.current.retryMessage({
        messageId,
        participants: [participant],
        enabledIntegrations: ["drive"],
      });
    });

    expect(convexMocks.mutations[0]).toHaveBeenCalledWith(expect.objectContaining({
      chatId,
      text: "hello",
      participants: [expect.not.objectContaining({ id: "local-participant" })],
      searchMode: "web",
      complexity: 4,
    }));
    expect(convexMocks.mutations[0]).toHaveBeenCalledWith(expect.objectContaining({
      participants: [expect.objectContaining({
        modelId: "openai/gpt-4.1",
        personaId: "persona_1",
        personaName: "Analyst",
        temperature: 0.4,
      })],
    }));
    expect(convexMocks.mutations[2]).toHaveBeenCalledWith(expect.objectContaining({
      messageId,
      participants: [expect.not.objectContaining({ id: "local-participant" })],
      enabledIntegrations: ["drive"],
    }));
    expect(analyticsMocks.captureAnalytics).toHaveBeenCalledWith(
      "message_sent",
      expect.objectContaining({
        assistant_message_id: "assistant_msg",
        assistant_message_ids: ["assistant_msg"],
        assistant_message_count: 1,
      }),
    );
  });

  it("marks audio attachments as audio send analytics", async () => {
    convexMocks.queryResults = [chat(), [], [], []];
    convexMocks.mutations[0]!.mockResolvedValue({ userMessageId: "user_msg", assistantMessageIds: [] });
    const { result } = renderHook(() => useChat(chatId));

    await act(async () => {
      await result.current.sendMessage({
        chatId,
        text: "listen to this",
        participants: [{ modelId: "openai/gpt-4.1" }],
        attachments: [{
          type: "file",
          name: "voice.m4a",
          mimeType: "audio/mp4",
          storageId: "storage_audio" as Id<"_storage">,
        }],
      });
    });

    expect(analyticsMocks.captureAnalytics).toHaveBeenCalledWith(
      "message_send_attempted",
      expect.objectContaining({
        has_audio: true,
        attachment_count: 1,
      }),
    );
    expect(featureAnalyticsMocks.captureSendFeatureUsage).toHaveBeenCalledWith(
      expect.objectContaining({ has_audio: true }),
    );
  });

  it("passes management mutation args through to Convex", async () => {
    convexMocks.queryResults = [chat(), [], [], []];
    const { result } = renderHook(() => useChat(chatId));

    await act(async () => {
      await result.current.cancelGeneration({ chatId });
      await result.current.deleteMessage({ messageId });
      await result.current.updateChat({
        chatId,
        title: "Renamed",
        activeBranchLeafExpectedCurrentId: null,
      });
      await result.current.switchBranchAtFork({
        chatId,
        currentSiblingMessageId: "message_a" as Id<"messages">,
        targetSiblingMessageId: "message_b" as Id<"messages">,
      });
    });

    expect(convexMocks.mutations[1]).toHaveBeenCalledWith({ chatId });
    expect(convexMocks.mutations[3]).toHaveBeenCalledWith({ messageId });
    expect(convexMocks.mutations[4]).toHaveBeenCalledWith({
      chatId,
      title: "Renamed",
      activeBranchLeafExpectedCurrentId: null,
    });
    expect(convexMocks.mutations[5]).toHaveBeenCalledWith({
      chatId,
      currentSiblingMessageId: "message_a",
      targetSiblingMessageId: "message_b",
    });
  });

  it("uses retry analytics snapshots without sending them to Convex", async () => {
    convexMocks.queryResults = [chat(), [], [], []];
    convexMocks.mutations[2]!.mockResolvedValue({ assistantMessageIds: ["retry_msg"] });
    const { result } = renderHook(() => useChat(chatId));

    await act(async () => {
      await result.current.retryMessage({
        messageId,
        analyticsSnapshot: {
          participantCount: 2,
          modelIds: "openai/gpt-5,anthropic/claude-sonnet-4.5",
          searchMode: "web",
          complexity: 2,
          integrationCount: 1,
          subagentsEnabled: true,
          hasVideoConfig: true,
        },
      });
    });

    expect(analyticsMocks.captureAnalytics).toHaveBeenCalledWith(
      "message_retry_requested",
      expect.objectContaining({
        participant_count: 2,
        participant_count_source: "retry_contract",
        model_ids: "openai/gpt-5,anthropic/claude-sonnet-4.5",
        search_mode: "web",
        complexity: 2,
        integration_count: 1,
        subagents_enabled: true,
        has_video_config: true,
      }),
    );
    expect(convexMocks.mutations[2]).toHaveBeenCalledWith(
      expect.not.objectContaining({ analyticsSnapshot: expect.anything() }),
    );
  });
});
