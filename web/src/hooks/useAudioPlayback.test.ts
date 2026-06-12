import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let audioUrl: string | null | undefined;
const requestAudioGeneration = vi.fn();

vi.mock("@convex/_generated/api", () => ({
  api: {
    chat: {
      mutations: { requestAudioGeneration: "requestAudioGeneration" },
      queries: { getMessageAudioUrl: "getMessageAudioUrl" },
    },
  },
}));

vi.mock("convex/react", () => ({
  useMutation: () => requestAudioGeneration,
  useQuery: () => audioUrl,
}));

describe("useAudioPlayback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    audioUrl = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears loading when an existing audio URL resolves to null", async () => {
    const { useAudioPlayback } = await import("./useAudioPlayback");
    const { result, rerender } = renderHook(() => useAudioPlayback());

    await act(async () => {
      await result.current.play("msg_1" as never, "storage_1" as never);
    });

    expect(result.current.state.activeMessageId).toBe("msg_1");
    expect(result.current.state.isLoading).toBe(true);

    audioUrl = null;
    rerender();

    await waitFor(() => {
      expect(result.current.state.activeMessageId).toBeNull();
      expect(result.current.state.isLoading).toBe(false);
    });
  });

  it("fires generation callbacks only after the request succeeds", async () => {
    const { useAudioPlayback } = await import("./useAudioPlayback");
    const { result } = renderHook(() => useAudioPlayback());
    const onGenerationRequested = vi.fn();

    requestAudioGeneration.mockResolvedValueOnce(undefined);

    await act(async () => {
      await result.current.play("msg_1" as never, undefined, { onGenerationRequested });
    });

    expect(onGenerationRequested).toHaveBeenCalledTimes(1);
  });

  it("does not let stale generation requests fire or clear the newer request callback", async () => {
    const { useAudioPlayback } = await import("./useAudioPlayback");
    const { result } = renderHook(() => useAudioPlayback());
    const onFirstGenerationRequested = vi.fn();
    const onSecondGenerationRequested = vi.fn();
    let resolveFirstRequest: (() => void) | undefined;
    let resolveSecondRequest: (() => void) | undefined;

    requestAudioGeneration
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirstRequest = resolve;
      }))
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveSecondRequest = resolve;
      }));

    act(() => {
      void result.current.play("msg_1" as never, undefined, {
        onGenerationRequested: onFirstGenerationRequested,
      });
    });
    await waitFor(() => {
      expect(requestAudioGeneration).toHaveBeenCalledTimes(1);
    });

    act(() => {
      void result.current.play("msg_2" as never, undefined, {
        onGenerationRequested: onSecondGenerationRequested,
      });
    });
    await waitFor(() => {
      expect(requestAudioGeneration).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      resolveFirstRequest?.();
      await Promise.resolve();
    });

    expect(onFirstGenerationRequested).not.toHaveBeenCalled();
    expect(onSecondGenerationRequested).not.toHaveBeenCalled();
    expect(result.current.state.activeMessageId).toBe("msg_2");
    expect(result.current.state.isLoading).toBe(true);

    await act(async () => {
      resolveSecondRequest?.();
      await Promise.resolve();
    });

    expect(onSecondGenerationRequested).toHaveBeenCalledTimes(1);
  });

  it("does not fire generation callbacks when the request fails", async () => {
    const { useAudioPlayback } = await import("./useAudioPlayback");
    const { result } = renderHook(() => useAudioPlayback());
    const onGenerationRequested = vi.fn();

    requestAudioGeneration.mockRejectedValueOnce(new Error("request failed"));

    await act(async () => {
      await result.current.play("msg_1" as never, undefined, { onGenerationRequested });
    });

    expect(onGenerationRequested).not.toHaveBeenCalled();
  });

  it("fires playback callbacks after an existing audio URL starts", async () => {
    class FakeAudio {
      currentTime = 0;
      duration = 0;
      paused = true;
      playbackRate = 1;

      addEventListener = vi.fn();
      pause = vi.fn();
      removeAttribute = vi.fn();
      load = vi.fn();
      play = vi.fn(() => Promise.resolve());
    }

    vi.stubGlobal("Audio", FakeAudio);
    const { useAudioPlayback } = await import("./useAudioPlayback");
    const { result, rerender } = renderHook(() => useAudioPlayback());
    const onPlaybackStarted = vi.fn();

    await act(async () => {
      await result.current.play("msg_1" as never, "storage_1" as never, {
        onPlaybackStarted,
      });
    });

    audioUrl = "https://audio.example/msg_1.mp3";
    rerender();

    await waitFor(() => {
      expect(onPlaybackStarted).toHaveBeenCalledTimes(1);
    });
  });
});
