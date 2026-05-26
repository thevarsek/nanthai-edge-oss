import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
