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
});
