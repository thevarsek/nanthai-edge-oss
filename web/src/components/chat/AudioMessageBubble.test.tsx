import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AudioMessageBubble } from "./AudioMessageBubble";
import type { PlaybackState } from "@/hooks/useAudioPlayback";

vi.mock("convex/react", () => ({
  useQuery: vi.fn(() => null),
}));

const basePlayback: PlaybackState = {
  activeMessageId: null,
  isPlaying: false,
  isLoading: false,
  progress: 0,
  speed: 1,
  currentTime: 0,
  duration: 0,
};

describe("AudioMessageBubble", () => {
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    anchorClick.mockClear();
  });

  it("dispatches play, pause, speed, and seek interactions", () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();
    const onSeek = vi.fn();
    const onCycleSpeed = vi.fn();

    const { rerender } = render(
      <AudioMessageBubble
        messageId={"msg_audio_1" as never}
        durationMs={30_000}
        role="assistant"
        playbackState={basePlayback}
        onPlay={onPlay}
        onPause={onPause}
        onSeek={onSeek}
        onCycleSpeed={onCycleSpeed}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlay).toHaveBeenCalledTimes(1);

    rerender(
      <AudioMessageBubble
        messageId={"msg_audio_1" as never}
        durationMs={30_000}
        role="assistant"
        playbackState={{
          ...basePlayback,
          activeMessageId: "msg_audio_1" as never,
          isPlaying: true,
          progress: 0.5,
          currentTime: 15,
          duration: 30,
          speed: 1.5,
        }}
        onPlay={onPlay}
        onPause={onPause}
        onSeek={onSeek}
        onCycleSpeed={onCycleSpeed}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(onPause).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "1.5x" }));
    expect(onCycleSpeed).toHaveBeenCalledTimes(1);

    const bar = screen.getByTestId("audio-progress-bar");
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue({
      left: 10,
      width: 100,
      top: 0,
      right: 110,
      bottom: 0,
      height: 0,
      x: 10,
      y: 0,
      toJSON: () => ({}),
    });
    fireEvent.click(bar, { clientX: 60 });
    expect(onSeek).toHaveBeenCalledWith(0.5);
  });

  it("disables playback while audio is generating", () => {
    const onPlay = vi.fn();
    render(
      <AudioMessageBubble
        messageId={"msg_audio_1" as never}
        isGenerating
        role="assistant"
        playbackState={basePlayback}
        onPlay={onPlay}
        onPause={vi.fn()}
        onSeek={vi.fn()}
        onCycleSpeed={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "Generating audio..." });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it("renders transcript and Lyria download affordance when audio is available", async () => {
    const convexReact = await import("convex/react");
    vi.mocked(convexReact.useQuery).mockReturnValue("https://example.test/audio.mp3");

    render(
      <AudioMessageBubble
        messageId={"msg_audio_abcdef" as never}
        role="assistant"
        transcript="generated transcript"
        modelId="google/lyria-3-pro-preview"
        playbackState={basePlayback}
        onPlay={vi.fn()}
        onPause={vi.fn()}
        onSeek={vi.fn()}
        onCycleSpeed={vi.fn()}
      />,
    );

    expect(screen.getByText("Music")).toBeInTheDocument();
    expect(screen.getByText("generated transcript")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download MP3" })).toBeInTheDocument();
  });

  it("audio controls do not submit an enclosing form", async () => {
    const convexReact = await import("convex/react");
    vi.mocked(convexReact.useQuery).mockReturnValue("https://example.test/audio.mp3");
    const onSubmit = vi.fn((event: React.FormEvent<HTMLFormElement>) => event.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <AudioMessageBubble
          messageId={"msg_audio_abcdef" as never}
          role="assistant"
          modelId="google/lyria-3-pro-preview"
          playbackState={{
            ...basePlayback,
            activeMessageId: "msg_audio_abcdef" as never,
            isPlaying: true,
            speed: 1.5,
          }}
          onPlay={vi.fn()}
          onPause={vi.fn()}
          onSeek={vi.fn()}
          onCycleSpeed={vi.fn()}
        />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download MP3" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "1.5x" }));

    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
