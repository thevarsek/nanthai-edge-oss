import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@convex/_generated/dataModel";
import type { Message } from "@/hooks/useChat";
import { AudioPlaybackContext, type AudioPlaybackContextValue } from "./AudioPlaybackContext.hook";
import { AssistantMessage } from "./MessageBubble.AssistantMessage";

vi.mock("./VideoGenerationProgress", () => ({
  VideoGenerationProgress: () => <div data-testid="video-progress" />,
}));

let mockModelSummaries: Array<{ modelId: string; supportsVideo?: boolean }> = [];
vi.mock("@/hooks/useSharedData", () => ({
  useModelSummaries: () => mockModelSummaries,
}));

function message(overrides: Partial<Message> = {}): Message {
  return {
    _id: "message_1" as Id<"messages">,
    _creationTime: 1,
    chatId: "chat_1" as Id<"chats">,
    role: "assistant",
    content: "Hello",
    status: "completed",
    createdAt: 1,
    ...overrides,
  };
}

function renderAssistant(messageOverride: Partial<Message>) {
  const audio: AudioPlaybackContextValue = {
    state: {
      activeMessageId: null,
      isPlaying: false,
      isLoading: false,
      progress: 0,
      duration: 0,
      currentTime: 0,
      speed: 1,
    },
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    stop: vi.fn(),
    cycleSpeed: vi.fn(),
    seek: vi.fn(),
  };

  return render(
    <AudioPlaybackContext.Provider value={audio}>
      <AssistantMessage
        message={message(messageOverride)}
        isStreaming={false}
        participants={[]}
        onRetry={vi.fn()}
        onFork={vi.fn()}
      />
    </AudioPlaybackContext.Provider>,
  );
}

describe("AssistantMessage", () => {
  beforeEach(() => {
    mockModelSummaries = [];
  });

  it("copies generated image URLs instead of hidden placeholder text", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderAssistant({
      content: "[Generated image]",
      imageUrls: ["https://example.com/image.png"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://example.com/image.png");
    });
  });

  it("copies generated video URLs instead of hidden placeholder text", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    renderAssistant({
      content: "[Generated video]",
      videoUrls: ["https://example.com/video.mp4"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://example.com/video.mp4");
    });
  });

  it("shows a video placeholder for pending video generations", () => {
    mockModelSummaries = [{ modelId: "x-ai/grok-imagine-video", supportsVideo: true }];

    renderAssistant({
      content: "",
      status: "pending",
      modelId: "x-ai/grok-imagine-video",
    });

    expect(screen.getByText("Generating video...")).toBeInTheDocument();
  });

  it("does not render unsafe generated media URLs", () => {
    renderAssistant({
      content: "[Generated image]",
      imageUrls: ["javascript:alert(1)"],
      videoUrls: ["javascript:alert(2)"],
    });

    expect(screen.queryByAltText("Generated image")).not.toBeInTheDocument();
    expect(document.querySelector("video")).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="javascript:"]')).not.toBeInTheDocument();
  });
});
