import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAudioRecorder, type RecordingResult } from "./useAudioRecorder";

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
  static instances: FakeAudioContext[] = [];
  state = "suspended";
  constructor() { FakeAudioContext.instances.push(this); }
  resume = vi.fn(async () => { this.state = "running"; });

  createMediaStreamSource() {
    return { connect: vi.fn() };
  }

  createAnalyser() {
    return {
      fftSize: 64,
      frequencyBinCount: 16,
      getByteFrequencyData: vi.fn((bytes: Uint8Array) => bytes.fill(128)),
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
    FakeAudioContext.instances = [];
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
  it("records voice references without starting optional speech recognition", async () => {
    const recognition = vi.fn();
    vi.stubGlobal("SpeechRecognition", recognition);
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => { await result.current[1].start({ transcribe: false }); });
    expect(result.current[0].isRecording).toBe(true);
    expect(recognition).not.toHaveBeenCalled();
    act(() => { result.current[1].cancel(); });
  });

  it("survives root StrictMode replay, resumes the waveform and returns the recorded reference", async () => {
    const { result } = renderHook(() => useAudioRecorder(), { reactStrictMode: true });
    await act(async () => { await result.current[1].start({ transcribe: false }); });
    expect(result.current[0].isRecording).toBe(true);
    expect(result.current[0].isPreparing).toBe(false);
    expect(FakeAudioContext.instances[0].resume).toHaveBeenCalledOnce();
    act(() => { vi.advanceTimersByTime(250); });
    expect(result.current[0].levels.every(value => value > 0)).toBe(true);
    const recorder = FakeMediaRecorder.instances[0];
    recorder.ondataavailable?.({ data: new Blob(["recorded-audio"]) });
    const stopped = result.current[1].stop();
    act(() => { recorder.onstop?.(); });
    const recording = await stopped;
    expect(recording?.blob.size).toBeGreaterThan(0);
    expect(recording?.durationMs).toBe(250);
    expect(recording?.transcript).toBe("");
  });

  it("retains an automatically stopped clip until the user uses the recording", async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => { await result.current[1].start({ transcribe: false }); });
    const recorder = FakeMediaRecorder.instances[0];
    recorder.ondataavailable?.({ data: new Blob(["recorded-reference"]) });
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(recorder.state).toBe("inactive");
    act(() => { recorder.onstop?.(); });
    expect(result.current[0].isRecording).toBe(false);
    expect(result.current[0].hasRecording).toBe(true);
    expect(result.current[0].elapsedMs).toBe(120_000);
    expect(FakeAudioContext.instances[0].state).toBe("closed");
    const recordings: Array<RecordingResult | null> = [];
    await act(async () => { recordings.push(await result.current[1].stop()); });
    const recording = recordings[0];
    expect(recording).toMatchObject({ durationMs: 120_000, transcript: "" });
    expect(recording?.blob.size).toBeGreaterThan(0);
    expect(result.current[0].hasRecording).toBe(false);
    await expect(result.current[1].stop()).resolves.toBeNull();
  });

  it("discards an automatically stopped clip only when cancelled", async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => { await result.current[1].start({ transcribe: false }); });
    const recorder = FakeMediaRecorder.instances[0];
    recorder.ondataavailable?.({ data: new Blob(["recorded-reference"]) });
    act(() => { vi.advanceTimersByTime(120_000); recorder.onstop?.(); });
    expect(result.current[0].hasRecording).toBe(true);
    act(() => { result.current[1].cancel(); });
    expect(result.current[0].hasRecording).toBe(false);
    await expect(result.current[1].stop()).resolves.toBeNull();
  });

  it("does not restore a cancelled clip when automatic-stop events arrive late", async () => {
    const { result } = renderHook(() => useAudioRecorder());
    await act(async () => { await result.current[1].start({ transcribe: false }); });
    const recorder = FakeMediaRecorder.instances[0];
    act(() => { vi.advanceTimersByTime(120_000); result.current[1].cancel(); });
    act(() => { recorder.ondataavailable?.({ data: new Blob(["late-reference"]) }); recorder.onstop?.(); });
    expect(result.current[0].hasRecording).toBe(false);
    await expect(result.current[1].stop()).resolves.toBeNull();
  });

});
