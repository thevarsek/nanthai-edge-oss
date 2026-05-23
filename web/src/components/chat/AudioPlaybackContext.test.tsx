import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AudioPlaybackProvider } from "./AudioPlaybackContext";
import { useAudioPlaybackContext } from "./AudioPlaybackContext.hook";

vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: () => null,
}));

function SpeedReader() {
  const playback = useAudioPlaybackContext();
  return <span>{playback.state.speed}x</span>;
}

describe("AudioPlaybackProvider", () => {
  it("applies a default speed that arrives after mount", () => {
    const { rerender } = render(
      <AudioPlaybackProvider defaultAudioSpeed={undefined}>
        <SpeedReader />
      </AudioPlaybackProvider>,
    );

    expect(screen.getByText("1x")).toBeInTheDocument();

    rerender(
      <AudioPlaybackProvider defaultAudioSpeed={1.5}>
        <SpeedReader />
      </AudioPlaybackProvider>,
    );

    expect(screen.getByText("1.5x")).toBeInTheDocument();
  });
});
