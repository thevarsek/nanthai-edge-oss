import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAudioRecorder } from "./useAudioRecorder";

class FakeMediaRecorder {
  static isTypeSupported = vi.fn(() => true);
  static instances: FakeMediaRecorder[] = [];
  state = "recording";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  constructor() {
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
  }
}

class FakeAudioContext {
  state = "running";

  createMediaStreamSource() {
    return { connect: vi.fn() };
  }

  createAnalyser() {
    return {
      fftSize: 64,
      frequencyBinCount: 16,
      getByteFrequencyData: vi.fn(),
    };
  }

  close = vi.fn(async () => {
    this.state = "closed";
  });
}

describe("useAudioRecorder", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeMediaRecorder.instances = [];
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.stubGlobal("AudioContext", FakeAudioContext);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [{ stop: vi.fn() }],
        })),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves a pending stop when the recording is cancelled", async () => {
    const { result } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current[1].start();
    });

    const stopPromise = result.current[1].stop();
    act(() => {
      result.current[1].cancel();
    });

    await expect(stopPromise).resolves.toBeNull();
  });

  it("resolves a pending stop when the hook unmounts", async () => {
    const { result, unmount } = renderHook(() => useAudioRecorder());

    await act(async () => {
      await result.current[1].start();
    });

    const stopPromise = result.current[1].stop();
    unmount();

    await expect(stopPromise).resolves.toBeNull();
  });

  it("does not start recording when cancelled before microphone permission resolves", async () => {
    let resolveStream: (stream: MediaStream) => void = () => {};
    const trackStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        })),
      },
    });
    const { result } = renderHook(() => useAudioRecorder());

    let startPromise: Promise<void> = Promise.resolve();
    act(() => {
      startPromise = result.current[1].start();
    });
    expect(result.current[0].isPreparing).toBe(true);

    act(() => {
      result.current[1].cancel();
    });

    await act(async () => {
      resolveStream({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream);
      await startPromise;
    });

    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
    expect(result.current[0].isPreparing).toBe(false);
    expect(result.current[0].isRecording).toBe(false);
  });

  it("does not start recording when unmounted before microphone permission resolves", async () => {
    let resolveStream: (stream: MediaStream) => void = () => {};
    const trackStop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => {
          resolveStream = resolve;
        })),
      },
    });
    const { result, unmount } = renderHook(() => useAudioRecorder());

    let startPromise: Promise<void> = Promise.resolve();
    act(() => {
      startPromise = result.current[1].start();
    });

    unmount();

    await act(async () => {
      resolveStream({ getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream);
      await startPromise;
    });

    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });
});
