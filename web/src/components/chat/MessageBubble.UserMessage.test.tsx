import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioPlaybackContext } from "./AudioPlaybackContext.hook";
import { UserMessage } from "./MessageBubble.UserMessage";
import type { AudioPlaybackContextValue } from "./AudioPlaybackContext.hook";
import type { Message } from "@/hooks/useChat";
import type { Id } from "@convex/_generated/dataModel";
import { MessageBubble } from "./MessageBubble";
import type { GeneratedFileOpenRequest } from "./GeneratedFilesCard";

vi.mock("./MessageAttachments", () => ({
  MessageAttachments: () => <div data-testid="attachments" />,
}));
vi.mock("./GeneratedFilesCard", () => ({
  GeneratedFilesCard: ({ messageId, onOpenFile }: { messageId: string; onOpenFile?: (request: GeneratedFileOpenRequest) => void }) =>
    <button onClick={() => onOpenFile?.({ file: { _id: "report", filename: "qa.md", mimeType: "text/markdown" } })}>{messageId} report</button>,
}));
vi.mock("./MessageBubble.AssistantMessage", () => ({ AssistantMessage: () => null }));

const playback: AudioPlaybackContextValue = {
  state: {
    activeMessageId: null,
    isPlaying: false,
    isLoading: false,
    progress: 0,
    speed: 1,
    currentTime: 0,
    duration: 0,
  },
  play: vi.fn(),
  pause: vi.fn(),
  stop: vi.fn(),
  cycleSpeed: vi.fn(),
  seek: vi.fn(),
};

const baseMessage = {
  _id: "msg_user_1",
  _creationTime: 1_700_000_000_000,
  role: "user",
  content: "hello",
} as Message;

function renderUserMessage(message: Message = baseMessage) {
  return render(
    <AudioPlaybackContext.Provider value={playback}>
      <UserMessage message={message} />
    </AudioPlaybackContext.Provider>,
  );
}

describe("UserMessage", () => {
  it("opens a published user report through the normal chat callback with its attribution intact", () => {
    const message = { ...baseMessage, content: "QA MCP client · qa.md", generatedFileIds: ["report"] } as Message;
    const onOpen = vi.fn();
    render(<AudioPlaybackContext.Provider value={playback}>
      <MessageBubble message={message} isStreaming={false} participants={[]} onRetry={vi.fn()} onFork={vi.fn()} onOpenGeneratedFile={onOpen} />
    </AudioPlaybackContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "msg_user_1 report" }));
    expect(screen.getByTestId("user-message")).toHaveTextContent("QA MCP client · qa.md");
    expect(onOpen).toHaveBeenCalledWith({ file: { _id: "report", filename: "qa.md", mimeType: "text/markdown" }, message });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps copied feedback visible for two seconds after the latest copy", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderUserMessage();

    const copyButton = screen.getByRole("button", { name: "Copy" });
    await act(async () => {
      fireEvent.click(copyButton);
      await Promise.resolve();
    });
    expect(screen.getByTestId("copy-success-icon")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(copyButton);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(screen.getByTestId("copy-success-icon")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId("copy-icon")).toBeInTheDocument();
  });

  it("falls back when browser clipboard writes are blocked", async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    const execCommand = vi.fn(() => true);
    Object.assign(navigator, { clipboard: { writeText } });
    Object.assign(document, { execCommand });
    renderUserMessage();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith("hello");
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(screen.getByTestId("copy-success-icon")).toBeInTheDocument();
  });

  it("does not render copy for attachment-only user messages", () => {
    renderUserMessage({
      ...baseMessage,
      content: "  ",
      attachments: [{
        type: "image",
        storageId: "storage_1" as Id<"_storage">,
        name: "image.png",
        mimeType: "image/png",
      }],
    } as Message);

    expect(screen.queryByRole("button", { name: "Copy" })).not.toBeInTheDocument();
  });

  it("keeps a persisted presentation target visible after sending", () => {
    renderUserMessage({
      ...baseMessage,
      content: "Make this headline shorter",
      presentationContext: {
        projectId: "project_private",
        projectRevision: 4,
        slideId: "slide-2",
        slideRevision: 3,
        elementId: "hero_headline",
      },
    } as Message);

    expect(screen.getByTestId("presentation-message-target"))
      .toHaveTextContent("Presentation target · #2 · Hero headline");
    expect(screen.queryByText(/project_private/)).not.toBeInTheDocument();
  });
});
