import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => upsert,
}));

describe("usePreferenceBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    upsert.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes pending debounced preferences on unmount", async () => {
    const { usePreferenceBuffer } = await import("./usePreferenceBuffer");
    const { result, unmount } = renderHook(() => usePreferenceBuffer());

    act(() => {
      result.current.updatePreference({ defaultModelId: "model_a" });
    });

    expect(upsert).not.toHaveBeenCalled();

    unmount();

    expect(upsert).toHaveBeenCalledWith({ defaultModelId: "model_a" });
  });

  it("requeues debounced preferences when the backend write fails", async () => {
    upsert.mockRejectedValueOnce(new Error("offline"));
    const { usePreferenceBuffer } = await import("./usePreferenceBuffer");
    const { result, unmount } = renderHook(() => usePreferenceBuffer());

    act(() => {
      result.current.updatePreference({ defaultModelId: "model_a" });
      vi.advanceTimersByTime(500);
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(upsert).toHaveBeenNthCalledWith(1, { defaultModelId: "model_a" });
    expect(upsert).toHaveBeenNthCalledWith(2, { defaultModelId: "model_a" });

    unmount();
  });

  it("keeps newer pending values when requeueing a failed immediate write", async () => {
    upsert.mockRejectedValueOnce(new Error("offline"));
    const { usePreferenceBuffer } = await import("./usePreferenceBuffer");
    const { result, unmount } = renderHook(() => usePreferenceBuffer());

    act(() => {
      result.current.updatePreferenceImmediate({ defaultModelId: "model_a" });
    });
    act(() => {
      result.current.updatePreference({ defaultModelId: "model_b", defaultPersonaId: "persona_1" });
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(upsert).toHaveBeenNthCalledWith(2, {
      defaultModelId: "model_b",
      defaultPersonaId: "persona_1",
    });

    unmount();
  });

  it("does not schedule retries after an unmount flush fails", async () => {
    upsert.mockRejectedValue(new Error("offline"));
    const { usePreferenceBuffer } = await import("./usePreferenceBuffer");
    const { result, unmount } = renderHook(() => usePreferenceBuffer());

    act(() => {
      result.current.updatePreference({ defaultModelId: "model_a" });
    });

    unmount();
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
